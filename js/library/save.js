/* ==========================================================
 * VRSave —— 统一下载落盘（FSA 直写优先，downloads 兜底）
 *
 * 为什么需要这一层（ADR-040）：
 *   Chrome 147 上 chrome.downloads.onDeterminingFilename 的 suggest() 已被忽略，
 *   blob 下载落成 UUID、http 下载退化成 URL 末段，靠 filename 保名字的路径全部
 *   静默失效。唯一还能自己定名字的通道是 File System Access：
 *   拿资源库根句柄 → 逐段 getDirectoryHandle → getFileHandle → createWritable 写。
 *
 * 设计约束：
 *   ① 必须保留 downloads 兜底：没有授权目录 / 不支持 FSA / 写失败时仍要能下，
 *      返回值里用 mode:'downloads' 明示「名字可能被浏览器改掉」，不假装成功；
 *   ② FSA 失败要能区分原因（无句柄 / 权限 / 磁盘满 / 文件占用），沿用项目
 *      SAVE_E_* 错误码风格，便于调用方与测试断言；
 *   ③ 纯逻辑（路径解析、模式决策、错误码映射）与浏览器 API 解耦，
 *      让 tools/test-save.js 能在 Node 里直接测；
 *   ④ 写入用分片（4MB）而不是整块 write(blob)：m3u8 合并产物动辄几百 MB，
 *      整块写会让内存峰值再翻一倍。
 *
 * 注意 FSA 直写不会产生 chrome.downloads 事件，所以写成功后这里主动调一次
 * vrLib.ingest（ADR-044），否则资源库永远等不到「下载完成」。
 *
 * 零依赖、ES5+Promise，挂 self.VRSave。
 * ========================================================== */
(function (root) {
    'use strict';

    /* ---------------- 错误码 ---------------- */

    var CODES = {
        BAD_PATH: 'SAVE_E_BAD_PATH',       // 相对路径为空 / 清洗后没有文件名
        NO_HANDLE: 'SAVE_E_NO_HANDLE',     // 没有授权目录句柄（最常见，回退 downloads）
        PERM: 'SAVE_E_PERM',               // 句柄在，但 readwrite 权限不是 granted
        QUOTA: 'SAVE_E_QUOTA',             // 磁盘满 / 配额超限
        BUSY: 'SAVE_E_BUSY',               // 同名被占用 / 同名是目录
        NO_DIR: 'SAVE_E_NO_DIR',           // 目录不存在且不允许创建
        FSA: 'SAVE_E_FSA',                 // 其它 FSA 写入异常
        DL: 'SAVE_E_DL',                   // downloads 通道发起失败
        CANCEL: 'SAVE_E_CANCEL',           // 用户在另存为对话框里取消
        NO_CHANNEL: 'SAVE_E_NO_CHANNEL'    // FSA 与 downloads 都不可用
    };

    var CHUNK = 4 * 1024 * 1024;           // 分片写盘大小
    var MAX_UNIQUE = 99;                   // 同名 _01…_99，再撞就用时间戳

    /* ==========================================================
     * 纯逻辑（Node 可测）
     * ========================================================== */

    /**
     * 单段清洗：与 js/library/path.js 的 cleanSeg 同口径（Windows 非法字符、
     * 首尾点/空格、保留设备名）。这里不 import 它，是为了让本模块不依赖
     * 加载顺序——SW 里 path.js 先加载，但测试与页面不一定。
     */
    function cleanSeg(seg) {
        var t = String(seg == null ? '' : seg)
            .replace(/[<>:"|?*\u0000-\u001F]/g, '_')
            .replace(/[\\/]/g, '_')
            .replace(/\s+/g, ' ')
            .trim();
        t = t.replace(/^[.\s]+|[.\s]+$/g, '');
        if (!t) { return ''; }
        if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(t)) { t = '_' + t; }
        return t.trim();
    }

    /**
     * 相对路径拆解。
     * @returns {{dirs:string[], fileName:string, relPath:string}|null}
     *          relPath 是清洗后的「含前缀」路径，与 VRDB 的 key 口径一致。
     */
    function splitRel(relPath) {
        var segs = String(relPath == null ? '' : relPath)
            .replace(/\\/g, '/')
            .split('/')
            .map(cleanSeg)
            .filter(Boolean);
        if (!segs.length) { return null; }
        var fileName = segs.pop();
        if (!fileName) { return null; }
        return {
            dirs: segs,
            fileName: fileName,
            relPath: segs.concat([fileName]).join('/')
        };
    }

    /**
     * 剥掉 FSA 根句柄已经到达的那一层前缀。
     *
     * 为什么必须剥：根句柄指向「资源库根」（A 模式 = <下载目录>/video-rod），
     * 里面没有 video-rod/ 这一层。不剥会落成 video-rod/video-rod/…，
     * 这个坑在 HANDOFF §6.6 记过一次，YT 又踩过一次（ADR-040 影响面）。
     *
     * prefix 支持多段（自定义目录模式下 rootPrefix 可能带层级），
     * 只有**完全匹配**才剥，避免把同名博主目录误当前缀。
     */
    function stripPrefix(dirs, prefix) {
        var list = Array.isArray(dirs) ? dirs.slice() : [];
        var p = String(prefix == null ? '' : prefix)
            .replace(/\\/g, '/')
            .split('/')
            .map(cleanSeg)
            .filter(Boolean);
        if (!p.length || list.length < p.length) { return list; }
        for (var i = 0; i < p.length; i++) {
            if (list[i] !== p[i]) { return list; }
        }
        return list.slice(p.length);
    }

    /**
     * 模式决策（纯函数，测试主要打这里）。
     *
     * @param {object} env
     *   prefer            'auto'（默认）| 'fsa' | 'downloads'
     *   fsa               浏览器/环境是否支持 FSA 目录句柄
     *   hasHandle         是否已拿到 readwrite 可用的根句柄
     *   downloads         chrome.downloads 是否可用
     * @returns {{mode:'fsa'|'downloads'|'none', code?:string, reason?:string}}
     *          code 只在「降级」时给出，供调用方如实告知用户。
     */
    function decideMode(env) {
        var e = env || {};
        var prefer = e.prefer || 'auto';

        if (prefer === 'downloads') {
            return e.downloads
                ? { mode: 'downloads', reason: 'forced' }
                : { mode: 'none', code: CODES.NO_CHANNEL, reason: 'no-downloads' };
        }
        if (prefer === 'fsa') {
            if (e.fsa && e.hasHandle) { return { mode: 'fsa', reason: 'forced' }; }
            return {
                mode: 'none',
                code: (e.fsa && !e.hasHandle) ? CODES.NO_HANDLE : CODES.NO_CHANNEL,
                reason: 'no-fsa'
            };
        }
        // auto：FSA 优先，不可用就降级，绝不因为「名字不完美」把下载整体废掉
        if (e.fsa && e.hasHandle) { return { mode: 'fsa', reason: 'auto' }; }
        if (e.downloads) {
            return {
                mode: 'downloads',
                code: (e.fsa && !e.hasHandle) ? CODES.NO_HANDLE : '',
                reason: 'fallback'
            };
        }
        return { mode: 'none', code: CODES.NO_CHANNEL, reason: 'no-channel' };
    }

    /**
     * FSA 异常 → 错误码。
     * 用 DOMException.name 判别，比 message 稳定（各语言版本 message 不同）。
     */
    function mapError(err) {
        var e = err || {};
        var name = String(e.name || '');
        var msg = String(e.message || e || '');
        if (name === 'NotAllowedError' || name === 'SecurityError') { return CODES.PERM; }
        if (name === 'QuotaExceededError') { return CODES.QUOTA; }
        if (name === 'NoModificationAllowedError' || name === 'InvalidStateError') { return CODES.BUSY; }
        if (name === 'TypeMismatchError') { return CODES.BUSY; }
        if (name === 'NotFoundError') { return CODES.NO_DIR; }
        if (name === 'AbortError') { return CODES.CANCEL; }
        // 部分实现把磁盘满报成普通 Error，只能看文案兜底
        if (/quota|disk|space|ENOSPC/i.test(msg)) { return CODES.QUOTA; }
        if (/locked|busy|EBUSY|占用/i.test(msg)) { return CODES.BUSY; }
        return CODES.FSA;
    }

    /** downloads 通道失败 → 错误码（chrome.runtime.lastError.message 是唯一线索） */
    function mapDownloadError(msg) {
        var s = String(msg || '');
        if (/cancel/i.test(s)) { return CODES.CANCEL; }
        return CODES.DL;
    }

    /** 第 n 个候选名：a.mp4 → a_01.mp4（n 从 1 起） */
    function uniqueName(name, n) {
        var s = String(name || '');
        var dot = s.lastIndexOf('.');
        var stem = dot > 0 ? s.slice(0, dot) : s;
        var ext = dot > 0 ? s.slice(dot) : '';
        if (!n || n < 1) { return s; }
        if (n > MAX_UNIQUE) { return stem + '_' + Date.now() + ext; }
        return stem + '_' + ('0' + n).slice(-2) + ext;
    }

    /* ==========================================================
     * 环境探测
     * ========================================================== */

    var prefixCache = null;

    /** 资源库根已经到达的那一层（subdir / rootPrefix）；拿不到就用默认 */
    function resolvePrefix() {
        if (prefixCache != null) { return Promise.resolve(prefixCache); }
        return new Promise(function (resolve) {
            var done = function (v) {
                prefixCache = String(v || 'video-rod').replace(/^\/+|\/+$/g, '') || 'video-rod';
                resolve(prefixCache);
            };
            try {
                var storage = root.chrome && root.chrome.storage && root.chrome.storage.local;
                if (!storage) { done('video-rod'); return; }
                storage.get('vrLibSettings', function (o) {
                    var sub = (o && o.vrLibSettings && o.vrLibSettings.subdir) || 'video-rod';
                    var db = root.VRDB;
                    if (db && typeof db.getSetting === 'function') {
                        // 自定义目录模式下索引首段可能不是 subdir，以 db 里的 rootPrefix 为准
                        db.getSetting('rootPrefix', '').then(function (pfx) {
                            done(pfx || sub);
                        }).catch(function () { done(sub); });
                        return;
                    }
                    done(sub);
                });
            } catch (e) {
                done('video-rod');
            }
        });
    }

    /**
     * 探测可用通道。
     *
     * 关键：**只 queryPermission，不 requestPermission**。
     * requestPermission 要求 user activation，Service Worker 里必然失败
     * （会抛「Must be handling a user gesture」）；popup/downloader 里异步链路
     * 也早把手势消耗完了。所以「没授权」一律当作不可用，静默回退 downloads，
     * 把「去设置页重新授权」留给用户主动操作。
     */
    function probeEnv() {
        var dl = !!(root.chrome && root.chrome.downloads && root.chrome.downloads.download);
        var db = root.VRDB;
        if (!db || typeof db.getHandle !== 'function') {
            return Promise.resolve({ fsa: false, root: null, downloads: dl });
        }
        return Promise.resolve().then(function () {
            return db.getHandle('root');
        }).then(function (h) {
            if (!h || typeof h.getDirectoryHandle !== 'function') {
                return { fsa: !!h, root: null, downloads: dl };
            }
            if (typeof h.queryPermission !== 'function') {
                return { fsa: true, root: h, downloads: dl };
            }
            return h.queryPermission({ mode: 'readwrite' }).then(function (st) {
                if (st === 'granted') { return { fsa: true, root: h, downloads: dl }; }
                return { fsa: true, root: null, perm: st, downloads: dl };
            }).catch(function () {
                return { fsa: true, root: null, downloads: dl };
            });
        }).catch(function () {
            return { fsa: false, root: null, downloads: dl };
        });
    }

    /* ==========================================================
     * FSA 写入
     * ========================================================== */

    /** 同名文件加 _01/_02…，绝不覆盖用户已有内容 */
    function freeName(dir, name) {
        function probe(cand) {
            return dir.getFileHandle(cand).then(function () {
                return false;      // 已存在
            }).catch(function () {
                return true;       // 不存在（或不是文件）→ 可用
            });
        }
        var i = 1;
        function next() {
            var cand = uniqueName(name, i);
            i++;
            return probe(cand).then(function (ok) {
                return ok ? cand : next();
            });
        }
        return probe(name).then(function (ok) {
            return ok ? name : next();
        });
    }

    /** Blob 分片写：避免大文件整块驻留内存 */
    function pumpBlob(w, blob, onProgress) {
        var total = blob.size || 0;
        var off = 0;
        function step() {
            if (off >= total) {
                if (onProgress) { onProgress(total, total); }
                return Promise.resolve();
            }
            var end = Math.min(off + CHUNK, total);
            var piece = blob.slice(off, end);
            return Promise.resolve().then(function () {
                return w.write(piece);
            }).then(function () {
                off = end;
                if (onProgress) { onProgress(off, total); }
                return step();
            });
        }
        return step();
    }

    /**
     * URL 写盘：自己 fetch 再流式写。
     *
     * 为什么不交给 downloads：ADR-040 之后 downloads 已经不认 filename，
     * 而 FSA 要拿到字节只能自己拉。credentials:'include' 是必须的——
     * SW 的 fetch 默认 same-origin，跨站图片/视频会丢登录态，直接 403。
     * Referer 不能靠 fetch 的 referrer 字段伪造（跨域会被忽略），
     * 仍由调用方的 DNR 会话规则补（background.js 的 vrImgRefererRule）。
     */
    function pumpUrl(w, url, onProgress, referrer) {
        var init = { method: 'GET', credentials: 'include', cache: 'no-store' };
        if (referrer) { init.referrer = referrer; }
        return root.fetch(url, init).then(function (r) {
            if (!r.ok) { throw new Error('HTTP ' + r.status); }
            var total = Number(r.headers.get('content-length') || 0);
            if (!r.body || typeof r.body.getReader !== 'function') {
                return r.blob().then(function (b) { return pumpBlob(w, b, onProgress); });
            }
            var reader = r.body.getReader();
            var got = 0;
            function step() {
                return reader.read().then(function (x) {
                    if (x.done) {
                        if (onProgress) { onProgress(got, total || got); }
                        return undefined;
                    }
                    return Promise.resolve().then(function () {
                        return w.write(x.value);
                    }).then(function () {
                        got += (x.value && x.value.byteLength) || 0;
                        if (onProgress) { onProgress(got, total); }
                        return step();
                    });
                });
            }
            return step();
        });
    }

    function pump(w, src, onProgress, referrer) {
        if (typeof src === 'string') { return pumpUrl(w, src, onProgress, referrer); }
        var blob = src;
        if (typeof Blob !== 'undefined' && !(src instanceof Blob)) {
            blob = new Blob([src]);
        }
        return pumpBlob(w, blob, onProgress);
    }

    /**
     * 真正写盘：建目录 → 找不冲突的名字 → createWritable → 分片写 → close。
     * 中途失败必须 abort + 删掉半成品，否则用户会在资源库里看到 0 字节的残片。
     */
    function writeFsa(rootHandle, dirs, fileName, src, onProgress, referrer) {
        var p = Promise.resolve(rootHandle);
        dirs.forEach(function (seg) {
            p = p.then(function (d) {
                return d.getDirectoryHandle(seg, { create: true });
            });
        });
        return p.then(function (dir) {
            return freeName(dir, fileName).then(function (name) {
                return dir.getFileHandle(name, { create: true }).then(function (fh) {
                    return fh.createWritable().then(function (w) {
                        return pump(w, src, onProgress, referrer).then(function () {
                            return w.close();
                        }).then(function () {
                            /* 写完从文件句柄读回真实大小。
                             * 原来上游返回的 size 对「URL 字符串」源一律是 0，
                             * 入库后就成了 size=0 的幽灵记录（2026-11-06 实测：
                             * 之后每次下载都被判重复跳过，用户永远下不到）。 */
                            return fh.getFile().then(function (f) {
                                return { dir: dir, name: name, size: f.size || 0 };
                            }, function () {
                                return { dir: dir, name: name, size: 0 };
                            });
                        }).catch(function (e) {
                            return Promise.resolve().then(function () { return w.abort(); })
                                .catch(function () { /* 已关闭则忽略 */ })
                                .then(function () {
                                    return Promise.resolve().then(function () {
                                        return dir.removeEntry(name);
                                    }).catch(function () { /* 删不掉也不阻断错误上报 */ });
                                })
                                .then(function () { throw e; });
                        });
                    });
                });
            });
        });
    }

    /* ==========================================================
     * downloads 兜底
     * ========================================================== */

    function saveDownloads(relPath, src, mime, opt) {
        return new Promise(function (resolve) {
            var api = root.chrome && root.chrome.downloads;
            if (!api || typeof api.download !== 'function') {
                resolve({ ok: false, mode: 'none', path: relPath, code: CODES.NO_CHANNEL });
                return;
            }
            var url = src;
            var tmpUrl = '';
            if (typeof src !== 'string') {
                var blob = src;
                if (typeof Blob !== 'undefined' && !(src instanceof Blob)) {
                    blob = new Blob([src], { type: mime || '' });
                }
                try { tmpUrl = URL.createObjectURL(blob); } catch (e) { tmpUrl = ''; }
                url = tmpUrl;
            }
            if (!url) {
                resolve({ ok: false, mode: 'none', path: relPath, code: CODES.DL });
                return;
            }
            var opts = {
                url: url,
                filename: relPath,
                saveAs: !!opt.saveAs,
                conflictAction: opt.conflictAction || 'uniquify'
            };
            var done = function (out) {
                // blob URL 要等下载器真正读过再撤，这里给 30s 余量
                if (tmpUrl) { setTimeout(function () { URL.revokeObjectURL(tmpUrl); }, 30000); }
                resolve(out);
            };
            /* 下载器通道同样要预登记 meta：下载完成事件里页面上下文早没了，
             * 不登记的话入库条目 platform/title/pageUrl 全空（详情页来源空白）。 */
            if (opt && opt.meta && root.VRLib && typeof root.VRLib.record === 'function') {
                try {
                    root.VRLib.record(url, Object.assign({ relPath: relPath }, opt.meta));
                } catch (e) { /* 入库失败不阻断下载 */ }
            }
            try {
                api.download(opts, function (id) {
                    var le = root.chrome.runtime && root.chrome.runtime.lastError;
                    if (le || id === undefined || id === null) {
                        done({
                            ok: false,
                            mode: 'none',
                            path: relPath,
                            code: mapDownloadError(le && le.message)
                        });
                        return;
                    }
                    done({ ok: true, mode: 'downloads', path: relPath, downloadId: id });
                });
            } catch (e) {
                done({ ok: false, mode: 'none', path: relPath, code: CODES.DL });
            }
        });
    }

    /* ==========================================================
     * 入库（FSA 直写没有下载事件，必须显式补）
     * ========================================================== */

    function ingest(relPath, size, mime, meta) {
        var m = meta || {};
        var info = {
            relPath: relPath,
            absPath: '',
            platform: m.platform || '',
            platformName: m.platformName || '',
            creatorFull: m.creatorFull || '',
            creatorId: m.creatorId || '',
            type: m.type || '',
            title: m.title || '',
            pageUrl: m.pageUrl || '',
            sourceUrl: m.sourceUrl || '',
            /* mediaUrl 必须一起搬：查重（vrFindExistingMedia）拿 sourceUrl/mediaUrl
             * 与候选 URL 比对，这里漏掉就永远查不到「下过同一张/同一个视频」，
             * 表现是同一素材反复下载、库里堆 (1)(2)(3) 副本。
             * 注意 mediaUrl 可能是签名直链（带 token/Expires），比对侧会先规范化。 */
            mediaUrl: m.mediaUrl || '',
            size: Number(size) || 0,
            mtime: Date.now(),
            mime: mime || ''
        };
        // SW 上下文可以直接调；页面上下文（downloader/popup）走消息回 SW
        if (root.VRLib && typeof root.VRLib.ingestDirect === 'function') {
            return Promise.resolve().then(function () {
                return root.VRLib.ingestDirect(info);
            }).catch(function () { return null; });
        }
        return new Promise(function (resolve) {
            try {
                root.chrome.runtime.sendMessage({ Message: 'vrLib.ingest', info: info }, function () {
                    void (root.chrome.runtime.lastError);
                    resolve(null);
                });
            } catch (e) { resolve(null); }
        });
    }

    /* ==========================================================
     * 主入口
     * ========================================================== */

    /**
     * 落盘。
     *
     * @param {object} opt
     *   relPath    {string} 相对资源库根（含 subdir 前缀，如 video-rod/B站/xxx/视频/a.mp4）
     *   blobOrUrl  {Blob|ArrayBuffer|string} Blob 或 http(s) 直链
     *   mime       {string} 可选，回退 downloads 时补 Blob type
     *   onProgress {function(got,total)} 可选
     *   prefer     {'auto'|'fsa'|'downloads'} 默认 auto
     *   prefix     {string} 可选，覆盖「根句柄已到达的那一层」；默认读 vrLibSettings
     *   saveAs     {boolean} 仅 downloads 通道有效
     *   meta       {object} 入库元数据（platform/creator/type/title/pageUrl…）
     *   ingest     {boolean} 默认 true：FSA 成功后主动入库
     *   referrer   {string} 可选，fetch 的 referrer（跨域无效，防盗链仍靠 DNR）
     *
     * @returns {Promise<{ok:boolean, path:string, mode:'fsa'|'downloads'|'none',
     *                    code?:string, fsaCode?:string, downloadId?:number, size?:number}>}
     *   - mode:'fsa' → path 是真实落盘相对路径（可能带 _01 后缀），可放心入库
     *   - mode:'downloads' → 名字可能被浏览器改成 UUID/URL 末段（ADR-040），
     *     调用方应如实告知用户，不能假装成功
     */
    function saveFile(opt) {
        var o = opt || {};
        var src = o.blobOrUrl;
        var mime = o.mime || '';
        var onProgress = typeof o.onProgress === 'function' ? o.onProgress : null;
        var parts = splitRel(o.relPath);
        if (!parts) {
            return Promise.resolve({ ok: false, mode: 'none', path: '', code: CODES.BAD_PATH });
        }
        if (src === undefined || src === null || src === '') {
            return Promise.resolve({ ok: false, mode: 'none', path: parts.relPath, code: CODES.BAD_PATH });
        }

        return probeEnv().then(function (env) {
            var d = decideMode({
                prefer: o.prefer,
                fsa: env.fsa,
                hasHandle: !!env.root,
                downloads: env.downloads
            });
            if (d.mode === 'none') {
                return { ok: false, mode: 'none', path: parts.relPath, code: d.code || CODES.NO_CHANNEL };
            }
            if (d.mode === 'downloads') {
                return saveDownloads(parts.relPath, src, mime, o).then(function (r) {
                    if (d.code && r.ok) { r.fsaCode = d.code; }   // 降级原因照样带出去
                    return r;
                });
            }
            // —— FSA 直写 ——
            return resolvePrefix().then(function (pfx) {
                var prefix = (o.prefix != null && o.prefix !== '') ? o.prefix : pfx;
                var dirs = stripPrefix(parts.dirs, prefix);
                return writeFsa(env.root, dirs, parts.fileName, src, onProgress, o.referrer)
                    .then(function (w) {
                        var relOut = dirs.concat([w.name]).join('/');
                        /* 优先用写盘后读回的真实大小；拿不到才退回源对象大小 */
                        var size = Number(w.size) || ((typeof src === 'string') ? 0 : (src.size || 0));
                        var out = { ok: true, mode: 'fsa', path: relOut, size: size };
                        if (o.ingest === false) { return out; }

                        /* 入库用的 relPath 必须把前缀补回来。
                         * relOut 是把根句柄那一层剥掉后的「磁盘相对路径」（如 微博/xxx/视频/a.mp4），
                         * 而 parseRelPath 期望首段是 subdir（video-rod/微博/xxx/视频/a.mp4）。
                         * 直接用 relOut 会让 parseRelPath 把「微博」当成 subdir，
                         * 从第二段开始找平台 —— 找不到就得到 platform/type 全空的条目
                         * （资源库不分组、查重也按 platform 预筛而失效）。
                         * 注意：这里**只影响入库元数据**，落盘路径仍用 relOut，不会多建目录。 */
                        var relForDb = (prefix ? prefix + '/' : '') + relOut;
                        return ingest(relForDb, size, mime, o.meta).then(function () { return out; });
                    }).catch(function (e) {
                        // 写失败不能让用户白等：回退下载器，但把 FSA 的真实原因带回去
                        var code = mapError(e);
                        return saveDownloads(parts.relPath, src, mime, o).then(function (r) {
                            if (r.ok) { r.fsaCode = code; }
                            else if (!r.code) { r.code = code; }
                            return r;
                        });
                    });
            });
        });
    }

    /* ---------------- 测试用 ---------------- */

    function _resetPrefixCache() { prefixCache = null; }

    root.VRSave = {
        CODES: CODES,
        CHUNK: CHUNK,
        // 主入口
        saveFile: saveFile,
        // 纯逻辑（tools/test-save.js）
        cleanSeg: cleanSeg,
        splitRel: splitRel,
        stripPrefix: stripPrefix,
        decideMode: decideMode,
        mapError: mapError,
        mapDownloadError: mapDownloadError,
        uniqueName: uniqueName,
        // 环境探测（暴露出来便于调试与页面上下文复用）
        probeEnv: probeEnv,
        resolvePrefix: resolvePrefix,
        _resetPrefixCache: _resetPrefixCache
    };
})(typeof self !== 'undefined' ? self : this);
