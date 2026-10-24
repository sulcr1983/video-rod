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
        durSec: 0,
        mergeError: '',
        via: ''
    };

    var sandbox = { frame: null, ready: null, seq: 0, wait: {} };

    // ---------- 小工具 ----------
    function setMsg(text, kind) {
        el.msg.textContent = text || '';
        el.msg.className = 'msg' + (kind ? ' ' + kind : '');
        el.msg.style.whiteSpace = 'pre-line';
    }

    function setBar(pct) {
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
                var tip = res && res.hint ? '\n' + res.hint : '';
                setMsg('取格式失败：' + ((res && res.error) || '未知原因') + tip, 'err');
                el.note.textContent = '↻ 点这里重试';
                el.note.style.cursor = 'pointer';
                el.note.onclick = loadFormats;
                return;
            }
            applyFormats(res);
        });
    }

    function applyFormats(res) {
        state.formats = res.formats || [];
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
            chrome.downloads.download({
                url: url, filename: filename, conflictAction: 'uniquify', saveAs: false
            }, function (id) {
                if (chrome.runtime.lastError || id == null) {
                    URL.revokeObjectURL(url);
                    reject(new Error(chrome.runtime.lastError ?
                        chrome.runtime.lastError.message : '下载未被创建'));
                    return;
                }
                function onChange(d) {
                    if (d.id !== id) { return; }
                    if (d.state === 'complete' || d.state === 'interrupted') {
                        chrome.downloads.onChanged.removeListener(onChange);
                        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
                        if (d.state === 'complete') { resolve(id); }
                        else { reject(new Error('下载中断：' + (d.error || ''))); }
                    }
                }
                chrome.downloads.onChanged.addListener(onChange);
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

    /** @returns {Promise<string>} 'fsa' | 'downloads' */
    function save(blob, relPath) {
        return getRootHandle().then(function (root) {
            if (!root) { return null; }
            return writeToRoot(root, relPath, blob).then(function () { return 'fsa'; });
        }).catch(function (e) {
            state.fsaError = String((e && e.message) || e);
            try { window.__vrFsaError = state.fsaError; } catch (x) { /* ignore */ }
            return null;
        }).then(function (via) {
            if (via === 'fsa') { state.via = 'fsa'; return 'fsa'; }
            return saveToDownloads(blob, relPath).then(function () {
                state.via = 'downloads';
                return 'downloads';
            });
        });
    }

    function run() {
        if (state.busy || !state.chosen) { return; }
        var o = state.chosen;
        state.busy = true;
        el.go.disabled = true;
        el.file.classList.remove('on');
        el.note.textContent = '';
        state.mergeError = '';

        function stage(txt, pct) { setMsg(txt); setBar(pct); }
        function finish() {
            setBar(100);
            var tail = state.via === 'fsa'
                ? '已直接写入资源库目录'
                : '已交给浏览器下载器（未授权资源库目录，文件名可能被浏览器改成随机名）';
            setMsg('完成：' + (meta.author ? meta.author + ' / ' : '') +
                (meta.title || '') + '\n' + tail, state.via === 'fsa' ? 'ok' : 'warn');
            el.file.classList.add('on');
            state.busy = false;
            el.go.disabled = !state.chosen;
        }
        function fail(e) {
            setBar(null);
            setMsg(String((e && e.message) || e), 'err');
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
            if (!pair.a) {
                return save(new Blob([pair.v], { type: 'video/mp4' }),
                    buildPath('mp4', nameSuffix + '_无音轨'))
                    .then(function () { throw new Error('没取到音频轨，已保存无声视频'); });
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
            if (s && s.subdir) { state.subdir = s.subdir; }
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
})();
