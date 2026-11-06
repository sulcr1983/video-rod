/**
 * 苏哥的钓鱼竿：YouTube 下载编排页
 *
 * 为什么这件事要在一个扩展页里做，而不是在 youtube 页面的内容脚本里：
 *   ① googlevideo 的响应要能直接读——扩展页有 host_permissions，不受 CORS 限制；
 *   ② 需要在内存里把两条轨合成一个 MP4，内容脚本没有这个执行环境；
 *   ③ 要用 chrome.downloads 落盘。
 *   这三条加起来，正好就是 Tubly 为什么要单开一个 600×260 小窗——同一个原因。
 *
 * 链路：SW 注入 MAIN world 取格式 → 沙箱解 n → 拉视频轨 → 拉音频轨 → 容器合并 → 落盘
 */
(function () {
    'use strict';

    var qs = new URLSearchParams(location.search);
    var videoId = qs.get('videoId') || '';
    var tabId = parseInt(qs.get('tabId') || '0', 10) || 0;
    var autoMode = qs.get('auto') === '1';   // 后台模式：不展示界面、自动最高画质
    var meta = {
        title: qs.get('title') || '',
        author: qs.get('author') || '',
        authorId: qs.get('authorId') || '',
        pageUrl: qs.get('pageUrl') || (videoId ? 'https://www.youtube.com/watch?v=' + videoId : '')
    };

    var el = {
        title: document.getElementById('title'),
        sub: document.getElementById('sub'),
        qc: document.getElementById('qc'),
        note: document.getElementById('note'),
        go: document.getElementById('go'),
        bar: document.getElementById('bar'),
        barI: document.querySelector('#bar i'),
        msg: document.getElementById('msg'),
        file: document.getElementById('file'),
        openDir: document.getElementById('openDir')
    };

    var state = {
        formats: [],
        video: [],          // [{height, fps, itag, url, size, codec}]
        audio: null,        // {itag, url, size, codec}
        muxed: null,        // itag 18 这种自带音轨的单文件
        playerId: '',
        chosen: null,
        busy: false,
        subdir: 'video-rod',
        prefix: 'video-rod',      // 资源库根已经到的那一层（FSA 写盘前要剥掉）
        durSec: 0,
        mergeError: '',
        via: ''
    };

    var sandbox = { frame: null, ready: null, seq: 0, wait: {} };

    // 诊断入口：自动化/现场排查可直接读当前格式与音轨；不参与业务逻辑。
    try { window.__vrYtState = state; } catch (e) { /* ignore */ }

    // ---------- 小工具 ----------
    /** 把进度广播回原 YouTube 标签，右下角浮层显示 */
    function broadcast(text, pct, done, kind) {
        try {
            chrome.runtime.sendMessage({
                Message: 'vrYtProgress', tabId: tabId,
                text: text || '', pct: (pct === null || pct === undefined) ? null : pct,
                done: !!done, kind: kind || ''
            }, function () { void chrome.runtime.lastError; });
        } catch (e) { /* 广播失败不影响下载 */ }
    }

    function setMsg(text, kind) {
        el.msg.textContent = text || '';
        el.msg.className = 'msg' + (kind ? ' ' + kind : '');
        el.msg.style.whiteSpace = 'pre-line';
        broadcast(text, null, false, kind);
    }

    function setBar(pct) {
        if (pct !== null && pct !== undefined) { broadcast(null, pct, false); }
        if (pct == null) { el.bar.classList.remove('on'); return; }
        el.bar.classList.add('on');
        el.barI.style.width = Math.max(0, Math.min(100, pct)) + '%';
    }

    function mb(n) {
        if (!n) { return ''; }
        return (n / 1048576 >= 1024)
            ? (n / 1073741824).toFixed(2) + ' GB'
            : Math.round(n / 1048576) + ' MB';
    }

    function safe(name) {
        return String(name || '')
            .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
            .replace(/[\s\u3000]+/g, ' ')
            .replace(/^\.+|\.+$/g, '')
            .trim()
            .slice(0, 120) || 'video';
    }

    function fmtDur(s) {
        s = Math.round(s);
        var m = Math.floor(s / 60), h = Math.floor(m / 60);
        if (h) {
            return h + ':' + String(m % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
        }
        return m + ':' + String(s % 60).padStart(2, '0');
    }

    /** 2160 → 4K，1440 → 2K，其余 Np；带帧率 */
    function qlabel(f) {
        var h = f.height || 0;
        var n = h >= 2160 ? '4K' : h >= 1440 ? '2K' : h + 'p';
        if (f.fps >= 50) { n += Math.round(f.fps); }
        return n;
    }

    // ---------- n 参数沙箱 ----------
    function ensureSandbox() {
        if (sandbox.ready) { return sandbox.ready; }
        sandbox.ready = new Promise(function (resolve, reject) {
            var f = document.createElement('iframe');
            f.style.cssText = 'position:absolute;width:0;height:0;border:0;left:-9999px;';
            f.setAttribute('sandbox', 'allow-scripts');
            f.src = 'nsig-sandbox.html';
            var timer = setTimeout(function () { reject(new Error('沙箱启动超时')); }, 20000);
            function onMsg(ev) {
                if (ev.source !== f.contentWindow) { return; }
                var d = ev.data || {};
                if (d.vr === 'nsig-ready') {
                    clearTimeout(timer);
                    window.removeEventListener('message', onMsg);
                    resolve(f);
                }
            }
            window.addEventListener('message', onMsg);
            document.body.appendChild(f);
            sandbox.frame = f;
        });
        return sandbox.ready;
    }

    /** 把 base.js 的取数请求从沙箱转到这里来做（沙箱是 opaque origin，会被 CORS 拦） */
    window.addEventListener('message', function (ev) {
        if (!sandbox.frame || ev.source !== sandbox.frame.contentWindow) { return; }
        var d = ev.data || {};
        if (d.vr === 'fetch') {
            fetch(d.url, { credentials: 'omit' }).then(function (r) {
                return r.text().then(function (t) {
                    sandbox.frame.contentWindow.postMessage({
                        vr: 'fetch-res', id: d.id, text: t,
                        status: r.status, statusText: r.statusText
                    }, '*');
                });
            }).catch(function (e) {
                sandbox.frame.contentWindow.postMessage({
                    vr: 'fetch-res', id: d.id, text: '', status: 0,
                    statusText: String((e && e.message) || e)
                }, '*');
            });
            return;
        }
        if (d.vr === 'nsig-res' && sandbox.wait[d.id]) {
            var w = sandbox.wait[d.id];
            delete sandbox.wait[d.id];
            w(d);
        }
    });

    function nsig(urls, playerId) {
        return ensureSandbox().then(function (f) {
            return new Promise(function (resolve, reject) {
                var id = 'n' + (++sandbox.seq);
                var timer = setTimeout(function () {
                    delete sandbox.wait[id];
                    reject(new Error('n 参数解密超时'));
                }, 45000);
                sandbox.wait[id] = function (d) {
                    clearTimeout(timer);
                    if (!d.ok) { reject(new Error(d.err || '解密失败')); return; }
                    resolve(d.urls);
                };
                f.contentWindow.postMessage({
                    vr: 'nsig', id: id, urls: urls, playerId: playerId || ''
                }, '*');
            });
        });
    }

    // ---------- 取格式 ----------
    function loadFormats() {
        setMsg('正在向 YouTube 请求格式列表…');
        el.note.textContent = '';
        chrome.runtime.sendMessage({
            Message: 'ytFormats', videoId: videoId, tabId: tabId
        }, function (res) {
            if (chrome.runtime.lastError) {
                setMsg('取格式失败：' + chrome.runtime.lastError.message, 'err');
                return;
            }
            if (!res || !res.ok) {
                var code = (res && res.code) || '';
                // 视频本身不可播时，重试没有意义 —— 按钮直接引导换视频，别让用户白等
                var dead = code === 'YT_E_UNAVAILABLE';
                var tip = res && res.hint ? '\n' + res.hint : '';
                setMsg('取格式失败：' + ((res && res.error) || '未知原因') + tip, 'err');
                el.note.textContent = dead ? '这个视频播不了，换一个视频试试' : '↻ 点这里重试';
                el.note.style.cursor = dead ? 'default' : 'pointer';
                el.note.onclick = dead ? null : loadFormats;
                state.videoDead = dead;
                return;
            }
            applyFormats(res);
        });
    }

    function applyFormats(res) {
        state.formats = res.formats || [];
        state.limitedReason = res.limitedReason || '';
        state.playerId = res.playerId || '';
        state.durSec = res.durationSec || 0;
        meta.title = res.title || meta.title;
        meta.author = res.author || meta.author;

        el.title.textContent = meta.title || '未命名';
        el.sub.innerHTML = (meta.author ? '<b>' + meta.author + '</b> · ' : '') +
            '<span style="color:var(--muted)">' +
            (state.durSec ? fmtDur(state.durSec) + ' · ' : '') +
            '共 ' + state.formats.length + ' 档</span>';

        // 只看 MP4 容器：AV1-in-MP4 也算，否则 4K 档会被整批过滤掉
        // （YouTube 的 4K 常常只有 av01 在 MP4 里，vp9 在 webm 里）
        var vids = [], auds = [];
        state.formats.forEach(function (f) {
            var mime = f.mime || '';
            if (!f.url) { return; }
            if (/^video\/mp4/.test(mime) && !f.hasAudio) { vids.push(f); }
            if (/^audio\/mp4/.test(mime)) { auds.push(f); }
        });

        // 同高度选一档：avc1 优先（兼容性最好），其次 av01（4K/HDR 主力），
        // 再其次其它；同优先级比码率
        function rank(c) {
            c = String(c || '');
            if (/avc1|avc3/.test(c)) { return 3; }
            if (/av01/.test(c)) { return 2; }
            if (/vp09|vp9/.test(c)) { return 1; }
            return 0;
        }
        var byH = {};
        vids.forEach(function (f) {
            var h = f.height || 0;
            if (!h) { return; }
            var cur = byH[h];
            if (!cur) { byH[h] = f; return; }
            var r = rank(f.codec), rc = rank(cur.codec);
            if (r > rc || (r === rc && (f.bitrate || 0) > (cur.bitrate || 0))) { byH[h] = f; }
        });
        state.video = Object.keys(byH).map(function (k) { return byH[k]; })
            .sort(function (a, b) { return b.height - a.height; });

        // 音频优先 AAC
        auds.sort(function (a, b) {
            var ra = /mp4a/.test(a.codec) ? 1 : 0, rb = /mp4a/.test(b.codec) ? 1 : 0;
            if (ra !== rb) { return rb - ra; }
            return (b.bitrate || 0) - (a.bitrate || 0);
        });
        state.audio = auds[0] || null;

        // 自带音轨的单文件（一般只有 360p），留作免合并兜底
        state.muxed = state.formats.filter(function (f) {
            return f.url && f.hasAudio && /^video\/mp4/.test(f.mime || '');
        }).sort(function (a, b) { return (b.height || 0) - (a.height || 0); })[0] || null;

        render();
    }

    // ---------- 渲染 ----------
    function render() {
        el.qc.innerHTML = '';
        var opts = [];

        state.video.forEach(function (f, i) {
            var total = (f.size || 0) + (state.audio ? (state.audio.size || 0) : 0);
            opts.push({
                key: 'v' + f.itag,
                t: qlabel(f),
                s: mb(total) + (state.audio ? ' · 视频+音频' : ' · 仅视频'),
                badge: i === 0 ? '最高' : '',
                video: f
            });
        });
        if (state.muxed) {
            opts.push({
                key: 'm' + state.muxed.itag,
                t: qlabel(state.muxed),
                s: mb(state.muxed.size) + ' · 单文件',
                badge: '免合并',
                muxed: state.muxed
            });
        }
        if (state.audio) {
            opts.push({
                key: 'a', t: '仅音频', s: mb(state.audio.size) + ' · m4a', badge: '', audio: true
            });
        }

        opts.forEach(function (o) {
            var b = document.createElement('button');
            b.className = 'q';
            b.type = 'button';
            b.setAttribute('aria-pressed', 'false');
            b.innerHTML = '<div class="t">' + o.t +
                (o.badge ? '<span class="badge">' + o.badge + '</span>' : '') + '</div>' +
                '<div class="s">' + (o.s || '') + '</div>';
            b.addEventListener('click', function () {
                if (state.busy) { return; }
                Array.prototype.forEach.call(el.qc.children, function (c) {
                    c.setAttribute('aria-pressed', 'false');
                });
                b.setAttribute('aria-pressed', 'true');
                state.chosen = o;
                el.go.disabled = false;
                hintFor(o);
            });
            el.qc.appendChild(b);
        });

        if (!opts.length) {
            setMsg('这个视频没有可用的 MP4 轨（可能只有 WebM，暂不支持）', 'err');
            return;
        }
        el.qc.firstChild.click();
        if (state.limitedReason) { setMsg('已取到格式（受限）', 'warn'); }
        else { setMsg('已取到 ' + state.formats.length + ' 档格式'); }
    }

    /** 选中某档时的提示：大文件 / AV1 兼容性 */
    function hintFor(o) {
        var tips = [];
        if (o.video) {
            var total = (o.video.size || 0) + (state.audio ? (state.audio.size || 0) : 0);
            if (total > 700 * 1048576) {
                tips.push('约 ' + mb(total) + '，合并占内存较多；不稳可先选 1080p');
            }
            if (/av01/.test(o.video.codec || '')) {
                tips.push('AV1：Chrome/Edge/VLC 可播，老播放器可能不支持');
            }
        }
        if (state.limitedReason) { tips.push(state.limitedReason); }
        el.note.textContent = tips.join('；') || '';
        el.note.style.cursor = '';
        el.note.onclick = null;
    }

    // ---------- 下载 ----------
    function fetchBytes(url, onProgress) {
        return fetch(url, { credentials: 'omit' }).then(function (r) {
            if (!r.ok) {
                throw new Error('HTTP ' + r.status + (r.status === 403 ? '（直链失效）' : ''));
            }
            var total = parseInt(r.headers.get('content-length') || '0', 10) || 0;
            if (!r.body || !r.body.getReader) {
                return r.arrayBuffer().then(function (b) { return new Uint8Array(b); });
            }
            var reader = r.body.getReader();
            var chunks = [], got = 0;
            return (function pump() {
                return reader.read().then(function (x) {
                    if (x.done) {
                        var out = new Uint8Array(got), off = 0;
                        chunks.forEach(function (c) { out.set(c, off); off += c.length; });
                        chunks.length = 0;
                        return out;
                    }
                    chunks.push(x.value);
                    got += x.value.length;
                    if (onProgress) { onProgress(got, total); }
                    return pump();
                });
            })();
        });
    }

    /** 解 n 后拉流；403/解密失败自动重来一次（直链会轮换） */
    function fetchStream(rawUrl, label, onProgress) {
        // 没有 n 参数的直链不需要解密，就别白起沙箱（也避开 base.js 的下载）
        if (!/[?&]n=/.test(rawUrl)) {
            return fetchBytes(rawUrl, onProgress);
        }
        function once() {
            return nsig([rawUrl], state.playerId).then(function (u) {
                var fixed = u[0];
                if (fixed && fixed.__err) { throw new Error(label + '链解密失败：' + fixed.__err); }
                if (!fixed) { throw new Error(label + '链为空'); }
                return fetchBytes(fixed, onProgress);
            });
        }
        return once().catch(function (e) {
            var msg = String((e && e.message) || e);
            if (!/403|失效|解密失败|超时/.test(msg)) { throw e; }
            setMsg(msg + ' → 重试一次…', 'warn');
            return new Promise(function (r) { setTimeout(r, 900); }).then(once);
        });
    }

    /** 走资源库三段路径：video-rod/YouTube/博主(@账号)/视频/文件名 */
    function buildPath(ext, suffix) {
        var fileName = safe(meta.title) + (suffix || '') + '.' + ext;
        if (window.VRPath && VRPath.buildRelPath) {
            try {
                return VRPath.buildRelPath({
                    platform: 'youtube',
                    authorFull: meta.author,
                    creatorId: meta.authorId,
                    type: ext === 'm4a' ? 'audio' : 'video',
                    ext: ext,
                    fileName: fileName,
                    pageUrl: meta.pageUrl,
                    subdir: state.subdir
                });
            } catch (e) { /* 退回简单路径 */ }
        }
        return 'video-rod/YouTube/' + fileName;
    }

    /** 兜底通道：走浏览器下载管理器（文件名可能被新 Chrome 忽略，见下方 save 注释） */
    function saveToDownloads(blob, filename) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(blob);
            /* 下载器通道也要把元数据预登记给资源库，否则入库条目 pageUrl/title 为空，
             * 下次下载无法按来源去重（2026-11-06 的 YouTube 重复卡片就是这么来的）。 */
            try {
                chrome.runtime.sendMessage({
                    Message: 'vrQueueName', url: url, filename: filename, conflictAction: 'uniquify',
                    meta: {
                        platform: 'youtube', platformName: 'YouTube',
                        title: meta.title || '', pageUrl: meta.pageUrl || '',
                        creatorFull: meta.author || '', creatorId: meta.authorId || '',
                        type: /\.m4a$/i.test(filename) ? 'audio' : 'video',
                        mime: /\.m4a$/i.test(filename) ? 'audio/mp4' : 'video/mp4'
                    }
                }, function () { void chrome.runtime.lastError; });
            } catch (e) { /* 记账失败不影响下载 */ }
            chrome.downloads.download({
                url: url, filename: filename, conflictAction: 'uniquify', saveAs: false
            }, function (id) {
                if (chrome.runtime.lastError || id == null) {
                    URL.revokeObjectURL(url);
                    reject(new Error(chrome.runtime.lastError ?
                        chrome.runtime.lastError.message : '下载未被创建'));
                    return;
                }
                var tries = 0;
                var timer = setInterval(function () {
                    tries++;
                    chrome.downloads.search({ id: id }, function (list) {
                        var it = list && list[0];
                        if (!it) { return; }
                        if (it.state === 'complete') {
                            clearInterval(timer);
                            setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
                            resolve({
                                id: id,
                                absPath: it.filename || '',
                                relPath: filename
                            });
                        } else if (it.state === 'interrupted') {
                            clearInterval(timer);
                            URL.revokeObjectURL(url);
                            reject(new Error('下载中断：' + (it.error || '')));
                        } else if (tries >= 240) {
                            clearInterval(timer);
                            URL.revokeObjectURL(url);
                            reject(new Error('下载器 120 秒未完成'));
                        }
                    });
                }, 500);
            });
        });
    }

    /* ==========================================================
     * 落盘：优先 FSA，其次 downloads
     *
     * 为什么不一上来就用 chrome.downloads：
     *   项目原来靠 chrome.downloads.onDeterminingFilename + 预记账来保住文件名
     *   （Chromium bug 579563 的官方 workaround）。但实测在 Chrome 147 上这套已经失效：
     *   连 http 直链下载都会退化成 URL 文件名，blob 更是直接变成 UUID。
     *   老路子是「下载完再改名」，而 downloads API 根本不给改名的口子。
     *
     *   所以主通道换成 File System Access：直接拿资源库已授权的根目录句柄，
     *   按 relPath 建子目录、写文件，文件名 100% 归我们管，还顺带解决了
     *   大文件要先整个塞进 blob 再交给下载管理器的内存问题（写的是流式 blob）。
     *   这也正是 Tubly 那个「另存为」小窗用 showDirectoryPicker 的原因。
     *
     * 没授权目录 / 不支持 FSA 时，退回 downloads，并如实告诉用户名字可能不对。
     * ========================================================== */
    function getRootHandle() {
        if (!window.VRDB || typeof VRDB.getHandle !== 'function') {
            return Promise.resolve(null);
        }
        return Promise.resolve().then(function () {
            return VRDB.getHandle('root');
        }).then(function (h) {
            if (!h || typeof h.getDirectoryHandle !== 'function') { return null; }
            if (typeof h.queryPermission !== 'function') { return h; }
            return h.queryPermission({ mode: 'readwrite' }).then(function (st) {
                if (st === 'granted') { return h; }
                return h.requestPermission({ mode: 'readwrite' }).then(function (s2) {
                    return s2 === 'granted' ? h : null;
                }).catch(function () { return null; });
            }).catch(function () { return null; });
        }).catch(function () { return null; });
    }

    /** 同名文件加 _01/_02，不覆盖已有内容 */
    function freeName(dir, name) {
        var dot = name.lastIndexOf('.');
        var stem = dot > 0 ? name.slice(0, dot) : name;
        var ext = dot > 0 ? name.slice(dot) : '';
        var i = 1;
        function probe(cand) {
            return dir.getFileHandle(cand).then(function () {
                return false;
            }).catch(function () {
                return true;
            });
        }
        return probe(name).then(function (ok) {
            if (ok) { return name; }
            function next() {
                if (i > 99) { return stem + '_' + Date.now() + ext; }
                var cand = stem + '_' + ('0' + i).slice(-2) + ext;
                i++;
                return probe(cand).then(function (ok2) { return ok2 ? cand : next(); });
            }
            return next();
        });
    }

    function writeToRoot(root, relPath, blob) {
        var segs = String(relPath).split('/').filter(Boolean);
        var fileName = segs.pop();
        // 关键：FSA 根句柄指向的是「资源库根」（A 模式 = <下载目录>/video-rod），
        // 里面没有 video-rod/ 这一层——必须先把首段前缀剥掉，否则会落成
        // video-rod/video-rod/YouTube/… （见 docs/HANDOFF.md §6.6）
        if (segs.length && segs[0] === state.prefix) { segs.shift(); }
        var p = Promise.resolve(root);
        segs.forEach(function (seg) {
            p = p.then(function (d) { return d.getDirectoryHandle(seg, { create: true }); });
        });
        return p.then(function (d) {
            return freeName(d, fileName).then(function (n) {
                return d.getFileHandle(n, { create: true }).then(function (fh) {
                    return { fh: fh, name: n };
                });
            });
        }).then(function (x) {
            return x.fh.createWritable().then(function (w) {
                return w.write(blob).then(function () { return w.close(); }).then(function () {
                    return x.name;
                });
            });
        });
    }

    /**
     * 落盘。
     * @returns {Promise<{via:'fsa'|'downloads', relPath:string, absPath:string, size:number}>}
     *
     * 返回实际落盘信息（含 uniquify 后的真实文件名），供随后入库用。
     * 早先只返回 'fsa' 字符串，结果入库那条链路拿不到 relPath，资源库里就不出现这张卡。
     */
    function save(blob, relPath) {
        var baseDir = String(relPath).split('/').slice(0, -1).join('/');
        return getRootHandle().then(function (root) {
            if (!root) { return null; }
            return writeToRoot(root, relPath, blob).then(function (finalName) {
                // 实际文件名可能因重名被加了 _01，入库要用真实名
                return { via: 'fsa', finalName: finalName, baseDir: baseDir };
            });
        }).catch(function (e) {
            state.fsaError = String((e && e.message) || e);
            try { window.__vrFsaError = state.fsaError; } catch (x) { /* ignore */ }
            return null;
        }).then(function (r) {
            if (r && r.via === 'fsa') {
                state.via = 'fsa';
                state.savedRelPath = (r.baseDir ? r.baseDir + '/' : '') + r.finalName;
                return { via: 'fsa', relPath: state.savedRelPath, absPath: '', size: blob.size };
            }
            return saveToDownloads(blob, relPath).then(function (rec) {
                state.via = 'downloads';
                // 下载器可能改文件名，以它回报的为准
                return {
                    via: 'downloads',
                    relPath: (rec && rec.relPath) || relPath,
                    absPath: (rec && rec.absPath) || '',
                    size: blob.size
                };
            });
        });
    }

    /**
     * 写盘成功后主动入库。
     * FSA 直写没有 chrome.downloads 事件，常规入库链路（sw-library 的 onChanged）
     * 永远等不到，所以这里显式调 vrLib.ingest。失败只提示，不影响下载结果。
     */
    function ingestSaved(saved) {
        if (!saved || !saved.relPath) { return Promise.resolve(null); }
        if (saved.via !== 'fsa') { return Promise.resolve(null); }   // 下载器那条会自己入库
        return new Promise(function (resolve) {
            try {
                chrome.runtime.sendMessage({
                    Message: 'vrLib.ingest',
                    info: {
                        relPath: saved.relPath,
                        absPath: saved.absPath || '',
                        platform: 'youtube',
                        platformName: 'YouTube',
                        creatorFull: meta.author || '',
                        creatorId: meta.authorId || '',
                        type: state.chosen && state.chosen.audioOnly ? 'audio' : 'video',
                        title: meta.title || '',
                        pageUrl: meta.pageUrl || '',
                        size: saved.size || 0,
                        mtime: Date.now(),
                        mime: saved.relPath.match(/\.m4a$/i) ? 'audio/mp4' : 'video/mp4'
                    }
                }, function (res) {
                    if (chrome.runtime.lastError) { resolve(null); return; }
                    resolve(res || null);
                });
            } catch (e) { resolve(null); }
        });
    }

    async function run() {
        if (state.busy || !state.chosen) { return; }
        var o = state.chosen;
        state.busy = true;
        el.go.disabled = true;
        el.file.classList.remove('on');
        el.note.textContent = '';
        state.mergeError = '';

        /* 手动下载也要查重：之前只有 auto=1 会检查，手动点下载会再落一份
         * xxx (1).mp4（2026-11-06 反馈的 YouTube 重复卡片）。 */
        var existing = null;
        try { existing = await findExistingYt(); } catch (e) { existing = null; }
        if (existing) {
            state.busy = false;
            el.go.disabled = !state.chosen;
            setMsg('已存在：' + (existing.relPath || existing.title || '同一视频') + '，跳过重复下载');
            broadcast('已存在，跳过重复下载', 100, true, 'ok');
            return;
        }

        function stage(txt, pct) { setMsg(txt); setBar(pct); }
        function finish(saved) {
            setBar(100);
            var tail = state.via === 'fsa'
                ? '已直接写入资源库目录'
                : '已交给浏览器下载器（未授权资源库目录，文件名可能被浏览器改成随机名）';
            setMsg('完成：' + (meta.author ? meta.author + ' / ' : '') +
                (meta.title || '') + '\n' + tail, state.via === 'fsa' ? 'ok' : 'warn');
            el.file.classList.add('on');
            state.busy = false;
            el.go.disabled = !state.chosen;
            broadcast('下载完成：' + (meta.title || '视频'), 100, true, 'ok');
            if (autoMode) {
                /* window.close() 对 chrome.tabs.create 开的扩展页经常被忽略，
                 * 用 tabs.remove 关掉这个后台页，避免用户看到“下载页”残留。 */
                setTimeout(closeAuto, 1800);
            }
            // 同一 YouTube 视频重复下载时，清掉引用卡（用户要求只留一条）。
            setTimeout(function () {
                try {
                    if (!window.VRDB || !VRDB.getAllFiles) { return; }
                    VRDB.getAllFiles().then(function (all) {
                        var refs = all.filter(function (x) { return x.platform === 'youtube' && x.isRef; });
                        if (!refs.length) { return; }
                        refs.forEach(function (x) {
                            if (x.downloadId) {
                                try { chrome.downloads.removeFile(x.downloadId, function () { void chrome.runtime.lastError; }); } catch (e) { /* ignore */ }
                            }
                        });
                        return VRDB.deleteFiles(refs.map(function (x) { return x.relPath; }));
                    }).catch(function () { /* ignore */ });
                } catch (e) { /* ignore */ }
            }, 1600);
            // FSA 直写没有下载事件，主动补一次入库，让资源库立刻能看到这张卡
            ingestSaved(saved).then(function (r) {
                if (r && r.ok) {
                    setMsg('完成：' + (meta.author ? meta.author + ' / ' : '') +
                        (meta.title || '') + '\n' + tail + '，已加入资源库',
                        state.via === 'fsa' ? 'ok' : 'warn');
                }
            });
        }
        function fail(e) {
            setBar(null);
            setMsg(String((e && e.message) || e), 'err');
            broadcast(String((e && e.message) || e), null, true, 'err');
            state.busy = false;
            el.go.disabled = !state.chosen;
        }

        stage('准备链路…', 2);

        var isAudioOnly = !!o.audio;
        var isMuxed = !!o.muxed;
        var vSrc = isMuxed ? o.muxed.url : (o.video ? o.video.url : '');
        var aSrc = (!isAudioOnly && !isMuxed && state.audio) ? state.audio.url : '';
        var nameSuffix = o.video ? '_' + o.video.height + 'p' : '';

        // —— 单文件 / 仅音频：直接下载 ——
        if (isAudioOnly || isMuxed) {
            var onlySrc = isAudioOnly ? state.audio.url : vSrc;
            stage(isAudioOnly ? '下载音频…' : '下载视频…', 5);
            return fetchStream(onlySrc, isAudioOnly ? '音频' : '视频', function (got, total) {
                setBar(total ? 5 + (got / total) * 85 : 50);
                setMsg((isAudioOnly ? '音频 ' : '视频 ') + mb(got) + (total ? ' / ' + mb(total) : ''));
            }).then(function (bytes) {
                stage('写入磁盘…', 92);
                return save(
                    new Blob([bytes], { type: isAudioOnly ? 'audio/mp4' : 'video/mp4' }),
                    buildPath(isAudioOnly ? 'm4a' : 'mp4', isAudioOnly ? '' : nameSuffix)
                );
            }).then(finish, fail);
        }

        // —— 双轨：视频 + 音频 ——
        stage('下载视频轨…', 5);
        fetchStream(vSrc, '视频', function (got, total) {
            setBar(total ? 5 + (got / total) * 60 : 35);
            setMsg('视频轨 ' + mb(got) + (total ? ' / ' + mb(total) : ''));
        }).then(function (vBytes) {
            stage('下载音频轨…', 66);
            if (!aSrc) { return { v: vBytes, a: null }; }
            return fetchStream(aSrc, '音频', function (got, total) {
                setBar(total ? 66 + (got / total) * 18 : 75);
                setMsg('音频轨 ' + mb(got) + (total ? ' / ' + mb(total) : ''));
            }).then(function (aBytes) { return { v: vBytes, a: aBytes }; });
        }).then(function (pair) {
            stage('合并音视频…', 86);
            /* 音频轨必须真有数据且带 mp4a 标记，否则明确报错，
             * 不能静默产出一个「能播但没声音」的文件（苏哥反馈的老问题）。 */
            var aBytes = pair.a || new Uint8Array(0);
            var hasMp4a = false;
            for (var bi = 0; bi < Math.min(aBytes.length, 20000) - 4; bi++) {
                if (aBytes[bi] === 109 && aBytes[bi + 1] === 112 &&
                    aBytes[bi + 2] === 52 && aBytes[bi + 3] === 97) { hasMp4a = true; break; }
            }
            if (!pair.a || pair.a.length < 1000 || !hasMp4a) {
                return save(new Blob([pair.v], { type: 'video/mp4' }),
                    buildPath('mp4', nameSuffix + '_无音轨'))
                    .then(function () { throw new Error('音频轨为空/格式不对，已保存无声视频并标注'); });
            }
            setMsg('合并音视频（不重编码，' + mb(pair.v.length + pair.a.length) + '）…');
            return new Promise(function (res) { setTimeout(res, 30); }).then(function () {
                var blob = null;
                try {
                    blob = VRFmp4.merge(pair.v, pair.a);
                } catch (e) {
                    state.mergeError = String((e && e.message) || e);
                }
                if (blob) {
                    stage('写入磁盘…', 94);
                    return save(blob, buildPath('mp4', nameSuffix));
                }
                // 合并失败 → 两条轨都留着，别让用户白等
                return save(new Blob([pair.v], { type: 'video/mp4' }),
                    buildPath('mp4', nameSuffix + '_视频轨'))
                    .then(function () {
                        return save(new Blob([pair.a], { type: 'audio/mp4' }),
                            buildPath('m4a', '_音频轨'));
                    })
                    .then(function () {
                        throw new Error('合并失败（' + state.mergeError +
                            '），已分别保存视频轨与音频轨');
                    });
            });
        }).then(finish, fail);
    }

    el.go.addEventListener('click', run);
    el.openDir.addEventListener('click', function () {
        chrome.downloads.showDefaultFolder();
    });

    // 读资源库子目录设置，让路径跟全局一致
    try {
        chrome.storage.local.get('vrLibSettings', function (o) {
            var s = o && o.vrLibSettings;
            var sub = (s && s.subdir) || 'video-rod';
            state.subdir = sub;
            state.prefix = sub;
            // 自定义目录模式下索引首段可能不是 subdir，以 db 里记的 rootPrefix 为准
            try {
                if (window.VRDB && typeof VRDB.getSetting === 'function') {
                    VRDB.getSetting('rootPrefix', '').then(function (pfx) {
                        if (pfx) { state.prefix = String(pfx).replace(/^\/+|\/+$/g, ''); }
                    }).catch(function () { /* 用 subdir 兜底 */ });
                }
            } catch (e) { /* 用 subdir 兜底 */ }
        });
    } catch (e) { /* 用默认 video-rod */ }

    el.title.textContent = meta.title || '正在读取视频信息…';
    if (meta.author) { el.sub.innerHTML = '<b>' + meta.author + '</b>'; }

    if (!videoId) {
        el.title.textContent = '缺少 videoId';
        setMsg('参数不全，无法开始', 'err');
    } else {
        loadFormats();
    }

    /* 后台模式：隐藏界面，格式就绪后自动选最高画质并开始合并；
     * 完成后 broadcast(done) 并自动关掉这个后台标签。
     * 注意：这段必须留在 IIFE 内，否则 autoMode/el/state 都是未定义，
     * 后台页只会停在“正在向 YouTube 请求格式列表…”而永不开始。 */
    function closeAuto() {
        try {
            chrome.runtime.sendMessage({ Message: 'vrYtClose' }, function () {
                void chrome.runtime.lastError;
            });
        } catch (e) { /* ignore */ }
        try {
            chrome.tabs.query({}, function (ts) {
                var me = (ts || []).filter(function (t) { return t.url === location.href; })[0];
                if (me) { chrome.tabs.remove(me.id); }
                else { try { window.close(); } catch (e) { /* ignore */ } }
            });
        } catch (e) { try { window.close(); } catch (e2) { /* ignore */ } }
    }

    function findExistingYt() {
        if (!window.VRDB || !VRDB.getAllFiles) { return Promise.resolve(null); }
        var wanted = (meta.title ? safe(meta.title) : '');
        /* 下载器兜底入库的历史条目没有 pageUrl/title，只能从文件名认。
         * 去掉质量后缀/重名后缀后做完整比较，避免「Foo」误命中「Foo Bar」。 */
        function ytStem(rel) {
            var base = String(rel || '').split('/').pop().replace(/\.(mp4|m4a)$/i, '');
            return base.replace(/ \(\d+\)$/, '')
                .replace(/_(无音轨|视频轨|音频轨)$/, '')
                .replace(/_\d{3,4}p$/, '');
        }
        return VRDB.getAllFiles().then(function (all) {
            return all.filter(function (x) {
                if (!x || x.platform !== 'youtube' || x.state === 'missing') { return false; }
                if (meta.pageUrl && x.pageUrl === meta.pageUrl) { return true; }
                if (meta.title && x.title === meta.title) { return true; }
                if (wanted && ytStem(x.relPath) === wanted) { return true; }
                return false;
            })[0] || null;
        }).catch(function () { return null; });
    }

    if (autoMode) {
        document.body.classList.add('vr-auto');
        var autoTimer = setInterval(function () {
            if (el.qc && el.qc.children.length) {
                clearInterval(autoTimer);
                var planned = state.video[0] ? buildPath('mp4', '_' + state.video[0].height + 'p') : '';
                var exists = window.VRDB && VRDB.getFile && planned ? VRDB.getFile(planned).catch(function () { return null; }) : Promise.resolve(null);
                exists.then(function (samePath) {
                    return samePath ? { relPath: planned } : findExistingYt();
                }).then(function (hit) {
                    if (hit) {
                        setMsg('已存在：' + (hit.relPath || hit.title) + '，跳过重复下载');
                        broadcast('已存在，跳过重复下载', 100, true, 'ok');
                        closeAuto();
                        return;
                    }
                    try {
                        el.qc.children[0].click();      // 最高画质（列表已按高度降序）
                        setTimeout(function () { el.go.click(); }, 120);
                    } catch (e) { broadcast('自动开始失败，请手动下载', null, true, 'err'); }
                });
            }
        }, 300);
    }
})();
