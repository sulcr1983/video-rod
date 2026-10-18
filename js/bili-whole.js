/**
 * 钓鱼竿 video-rod — B站「完整视频」下载：公共模块（ADR-029）
 * ------------------------------------------------------------------
 * 为什么单独一个文件：
 *   同一套 B站 下载逻辑要在两个地方用——面板（popup）和页内悬浮按钮（后台 SW）。
 *   SW 里没有 popup 的 DOM，也没法复用 popup 作用域的函数，
 *   所以把「要在页面主世界里跑的那几段」抽出来，两边各自注入同一份代码。
 *
 * 使用方式：
 *   - popup：popup.html 里 <script src="js/bili-whole.js"> 先加载，再取 VR_BILI.xxxFunc
 *   - 后台：importScripts("/js/bili-whole.js")，同样取 VR_BILI.xxxFunc
 *
 * 硬约束（踩过坑）：
 *   下面三个 *Func 会被 chrome.scripting.executeScript 序列化后丢进页面主世界执行，
 *   函数体必须是「自包含」的——只能用自己的参数和页面主世界的全局对象，
 *   **不能引用本文件里的任何变量**（注入后外层的 BILI_Q / qShort 全都够不着）。
 *
 * 为什么必须在页面主世界跑（ADR-029 根因）：
 *   B站媒体 CDN 校验 Referer，扩展后台/offscreen 发起的请求没有页面的 Referer 与登录态
 *   → SERVER_FORBIDDEN；页面主世界自己的请求天然带着这些 → 放行。
 */
(function (root) {
    'use strict';

    /* ===== 只在扩展侧用（不进页面） ===== */

    // B站清晰度档位 → 人话短标签
    var BILI_Q = {
        16: '360P', 32: '480P', 64: '720P', 74: '720P60', 80: '1080P',
        112: '1080P+', 116: '1080P60', 120: '4K', 127: '8K'
    };

    function qShort(q) { return BILI_Q[Number(q)] || (q ? ('qn' + q) : ''); }

    /**
     * 主世界：探测这个视频能走哪条路。
     * 两条路都问一遍（不写死清晰度，让 B站 按账号给它能给的最高档）：
     *   路线一 durl  = 整段 MP4，一个文件直接下，快
     *   路线二 dash  = 画面/声音分开，要合成，但常常能上更高清晰度
     * 实测两条路的档位是分开给的，有的视频 durl 只到 720P 而 DASH 给 1080P，
     * 也有的视频 durl 本身就给 1080P —— 所以不能一概而论，得比。
     */
    function probeFunc() {
        try {
            var s = window.__INITIAL_STATE__;
            if (!s || !s.videoData) { return null; }
            var vd = s.videoData;
            var cid = vd.cid || (vd.pages && vd.pages[0] && vd.pages[0].cid);
            if (!cid) { return null; }
            var bvid = vd.bvid ||
                (location.href.match(/\/video\/(BV[0-9A-Za-z]+)/) || [])[1] || '';
            var owner = (vd.owner && vd.owner.name) || '';
            var base = {
                bvid: bvid, cid: cid, title: vd.title || '', owner: owner,
                hasDurl: false, hasDash: false
            };
            function qText(sf, q) {
                for (var i = 0; i < (sf || []).length; i++) {
                    if (sf[i] && sf[i].quality === q) {
                        return sf[i].new_description || sf[i].description || '';
                    }
                }
                return q ? ('qn' + q) : '';
            }
            // qn=127 是「要最高档(8K)」的意思，B站 会按登录态/会员等级降回它能给的那档
            var COMMON = '&bvid=' + bvid + '&otype=json&platform=html5&high_quality=1';
            var apiDurl = 'https://api.bilibili.com/x/player/playurl?cid=' + cid +
                '&qn=127' + COMMON;
            // fnval=4048 → DASH（画面/声音分离）
            var apiDash = 'https://api.bilibili.com/x/player/playurl?cid=' + cid +
                '&qn=127' + COMMON + '&fnval=4048';
            function jget(u) {
                return fetch(u, { method: 'GET', credentials: 'include' })
                    .then(function (r) { return r.json(); })
                    .catch(function () { return null; });
            }
            return Promise.all([jget(apiDurl), jget(apiDash)]).then(function (rs) {
                var jd = rs[0], jh = rs[1];
                if (jd && jd.code === 0 && jd.data && jd.data.durl && jd.data.durl[0]) {
                    var d = jd.data, du = d.durl[0];
                    base.hasDurl = true;
                    base.size = du.size || 0;
                    base.format = d.format || 'mp4';
                    base.quality = d.quality;
                    base.qualityText = qText(d.support_formats, d.quality);
                    base.topAccept = (d.accept_quality || [])[0] || 0;
                }
                if (jh && jh.code === 0 && jh.data && jh.data.dash) {
                    var dh = jh.data.dash;
                    var vs = (dh.video || []).slice().sort(function (a, b) {
                        return (b.width * b.height) - (a.width * a.height);
                    });
                    var as = (dh.audio || []).slice().sort(function (a, b) {
                        return (b.bandwidth || 0) - (a.bandwidth || 0);
                    });
                    if (vs.length && as.length) {
                        base.hasDash = true;
                        base.dashW = vs[0].width;
                        base.dashH = vs[0].height;
                        base.dashQuality = vs[0].id;
                        base.dashQualityText = qText(jh.data.support_formats, vs[0].id) ||
                            (vs[0].height + 'P');
                    }
                }
                return base;
            });
        } catch (e) { return null; }
    }

    /**
     * 主世界：整段 MP4 直链下载（快）。进度写进 window.__vrBiliDL 供外部轮询。
     */
    function durlFunc(filename, cidArg, bvidArg) {
        window.__vrBiliDL = { loaded: 0, total: 0, done: false, error: null, bytes: 0 };
        function save(url) {
            return new Promise(function (resolve, reject) {
                var x = new XMLHttpRequest();
                x.open('GET', url, true);
                x.responseType = 'blob';
                x.onprogress = function (ev) {
                    if (ev.lengthComputable) {
                        window.__vrBiliDL.loaded = ev.loaded;
                        window.__vrBiliDL.total = ev.total;
                    }
                };
                x.onload = function () {
                    if (x.status < 200 || x.status >= 300) {
                        reject(new Error('HTTP ' + x.status));
                        return;
                    }
                    try {
                        var bu = URL.createObjectURL(x.response);
                        var a = document.createElement('a');
                        a.href = bu;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        setTimeout(function () { URL.revokeObjectURL(bu); }, 5000);
                        window.__vrBiliDL.bytes = x.response.size;
                        window.__vrBiliDL.done = true;
                        resolve(true);
                    } catch (e) { reject(e); }
                };
                x.onerror = function () { reject(new Error('网络错误')); };
                x.send();
            });
        }
        try {
            // 每次都重新要：durl 链接带时效，不能复用旧地址
            var api = 'https://api.bilibili.com/x/player/playurl?cid=' + cidArg +
                '&qn=127&bvid=' + bvidArg + '&otype=json&platform=html5&high_quality=1';
            fetch(api, { method: 'GET', credentials: 'include' })
                .then(function (r) { return r.json(); })
                .then(function (j) {
                    var du = j && j.data && j.data.durl && j.data.durl[0];
                    if (!du) {
                        throw new Error((j && j.message) ||
                            'B站只给了 DASH（音视频分离），本入口暂不支持');
                    }
                    return save(du.url);
                })
                .catch(function (e) {
                    window.__vrBiliDL.error = String((e && e.message) || e);
                    window.__vrBiliDL.done = true;
                });
        } catch (e) {
            window.__vrBiliDL.error = String(e);
            window.__vrBiliDL.done = true;
        }
        return true;
    }

    /**
     * 主世界：DASH 高清路线——分别下画面/声音，用 mp4box 合成一个 MP4 再存盘。
     * 执行前必须先往主世界注入 lib/mp4box.all.min.js。
     *
     * 合成踩坑（别改回去）：
     *   1. 不能 appendBuffer(视频)+appendBuffer(音频) 直接导出——mp4box 只保留第一个 moov
     *      （音频轨道丢失）且 mdat 载荷会被丢弃，导出只有 73KB 空壳。
     *   2. 样本数据用 samples[i].offset/size 从原始 buffer 切片取；不能用 getSample()，
     *      它依赖 flush() 后会清掉的 stream 缓冲。
     *   3. getBuffer() 才是导出方法；write() 需要传 DataStream 参数。
     */
    function dashFunc(filename, cidArg, bvidArg) {
        var S = { pct: 0, phase: '准备', done: false, error: null, bytes: 0, loaded: 0, total: 0 };
        window.__vrBiliDL = S;
        function tick(p, ph) { S.pct = p; if (ph) { S.phase = ph; } }

        function getBuf(url, base, span) {
            return new Promise(function (resolve, reject) {
                var x = new XMLHttpRequest();
                x.open('GET', url, true);
                x.responseType = 'arraybuffer';
                x.onprogress = function (ev) {
                    if (ev.lengthComputable) {
                        S.loaded = ev.loaded;
                        S.total = ev.total;
                        tick(base + span * (ev.loaded / ev.total), S.phase);
                    }
                };
                x.onload = function () {
                    if (x.status < 200 || x.status >= 300) {
                        reject(new Error('HTTP ' + x.status)); return;
                    }
                    resolve(x.response);
                };
                x.onerror = function () { reject(new Error('网络错误')); };
                x.send();
            });
        }

        function playurl() {
            var u = 'https://api.bilibili.com/x/player/playurl?cid=' + cidArg +
                '&qn=127&bvid=' + bvidArg +
                '&otype=json&platform=html5&high_quality=1&fnval=4048';
            return fetch(u, { method: 'GET', credentials: 'include' })
                .then(function (r) { return r.json(); });
        }

        /** 从一个 m4s 里取出轨道条目和样本列表 */
        function openM4s(buf) {
            var f = MP4Box.createFile();
            f.onError = function () {};
            buf.fileStart = 0;
            f.appendBuffer(buf);
            f.flush();
            var trak = f.moov.traks[0];
            var entry = trak.mdia.minf.stbl.stsd.entries[0];
            var u8 = new Uint8Array(buf);
            var ts = trak.mdia.mdhd.timescale;
            var list = [];
            for (var i = 0; i < trak.samples.length; i++) {
                var s = trak.samples[i];
                if (!(s.offset >= 0 && s.size > 0 && s.offset + s.size <= buf.byteLength)) {
                    continue;
                }
                list.push({
                    data: u8.subarray(s.offset, s.offset + s.size),
                    duration: s.duration || 1, dts: s.dts || 0, cts: s.cts || 0,
                    is_sync: !!s.is_sync,
                    t: (s.dts || 0) / ts
                });
            }
            return { entry: entry, list: list, timescale: ts };
        }

        try {
            if (!window.MP4Box) { throw new Error('合成库没加载上'); }
            return playurl().then(function (j) {
                var dh = j && j.data && j.data.dash;
                if (!dh) { throw new Error((j && j.message) || 'B站没给 DASH 流'); }
                var vs = (dh.video || []).slice().sort(function (a, b) {
                    return (b.width * b.height) - (a.width * a.height);
                });
                var as = (dh.audio || []).slice().sort(function (a, b) {
                    return (b.bandwidth || 0) - (a.bandwidth || 0);
                });
                if (!vs.length || !as.length) { throw new Error('DASH 里没有画面或声音'); }
                var vUrl = vs[0].baseUrl || vs[0].base_url;
                var aUrl = as[0].baseUrl || as[0].base_url;

                // 画面（占大头 0→80%）→ 声音（80→88%）→ 合成（88→99%）
                tick(0, '下载画面');
                return getBuf(vUrl, 0, 80).then(function (vb) {
                    tick(80, '下载声音');
                    return getBuf(aUrl, 80, 8).then(function (ab) {
                        return { vb: vb, ab: ab };
                    });
                });
            }).then(function (bufs) {
                tick(88, '合成中');
                var V = openM4s(bufs.vb);
                var A = openM4s(bufs.ab);
                if (!V.list.length || !A.list.length) {
                    throw new Error('画面或声音没解析出样本');
                }
                var out = MP4Box.createFile();
                out.onError = function () {};
                var vLast = V.list[V.list.length - 1];
                var aLast = A.list[A.list.length - 1];
                var vId = out.addTrack({
                    id: 1, type: 'avc1', timescale: V.timescale,
                    width: V.entry.width, height: V.entry.height,
                    hdlr: 'vide', name: 'VideoHandler',
                    default_sample_duration: vLast.duration,
                    description_boxes: V.entry.avcC ? [V.entry.avcC] : []
                });
                var aId = out.addTrack({
                    id: 2, type: 'mp4a', timescale: A.timescale,
                    channel_count: A.entry.channel_count || 2,
                    samplesize: A.entry.samplesize || 16,
                    samplerate: A.entry.samplerate || 44100,
                    hdlr: 'soun', name: 'SoundHandler',
                    default_sample_duration: aLast.duration,
                    description_boxes: A.entry.esds ? [A.entry.esds] : []
                });

                // 按时间交错写入，播放器才不会「先放完画面再出声」
                var i = 0, j = 0, n = 0, total = V.list.length + A.list.length;
                function pump() {
                    var N = 0;
                    while ((i < V.list.length || j < A.list.length) && N < 2000) {
                        var takeV;
                        if (i >= V.list.length) { takeV = false; }
                        else if (j >= A.list.length) { takeV = true; }
                        else { takeV = V.list[i].t <= A.list[j].t; }
                        var s = takeV ? V.list[i++] : A.list[j++];
                        out.addSample(takeV ? vId : aId, s.data, {
                            duration: s.duration, dts: s.dts, cts: s.cts,
                            is_sync: takeV ? s.is_sync : true
                        });
                        n++; N++;
                    }
                    tick(88 + Math.round(10 * n / total), '合成中');
                    if (i < V.list.length || j < A.list.length) {
                        // 让出主线程；注意后台标签页 timer 会被节流到 1 秒，所以批量要大
                        return new Promise(function (r) { setTimeout(r, 0); }).then(pump);
                    }
                    return true;
                }
                return pump().then(function () {
                    var o = out.getBuffer();
                    var abuf = (o instanceof ArrayBuffer) ? o
                        : (o && o.buffer) ? o.buffer : null;
                    if (!abuf) { throw new Error('合成结果为空'); }
                    var blob = new Blob([abuf], { type: 'video/mp4' });
                    var url = URL.createObjectURL(blob);
                    var a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    // 别急着回收：大文件下载被中断过（ADR-029）
                    setTimeout(function () { URL.revokeObjectURL(url); }, 180000);
                    S.bytes = abuf.byteLength;
                    tick(100, '完成');
                    S.done = true;
                    return true;
                });
            }).catch(function (e) {
                S.error = String((e && e.message) || e);
                S.done = true;
            });
        } catch (e) {
            S.error = String((e && e.message) || e);
            S.done = true;
            return true;
        }
    }

    root.VR_BILI = {
        BILI_Q: BILI_Q,
        qShort: qShort,
        probeFunc: probeFunc,
        durlFunc: durlFunc,
        dashFunc: dashFunc
    };
})(typeof self !== 'undefined' ? self : this);
