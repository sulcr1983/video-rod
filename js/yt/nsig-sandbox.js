/**
 * 苏哥的钓鱼竿：n 参数解密的沙箱执行器
 *
 * 它只做一件事：把 googlevideo 直链里的 `n` 参数从「原始值」换成「变换后的值」。
 * 不做这一步，直链一律 403（body 为空）——实测已确认这是唯一原因。
 *
 * 为什么必须在沙箱里跑：
 *   变换逻辑来自 YouTube 的 base.js，它是一坨混淆代码，只能在允许 eval 的环境求值。
 *   MV3 的扩展页 CSP 禁止 eval，所以 manifest 里声明了一个 sandbox 页，
 *   它的 CSP 带 'unsafe-eval'，且拿不到任何 chrome.* 权限（安全边界在这里）。
 *
 * 为什么要代理 fetch：
 *   沙箱页是 opaque origin（null），直接 fetch youtube.com 会被 CORS 拦。
 *   所以所有网络请求都 postMessage 回父页面，由父页面（有 host_permissions）代取，
 *   再把文本塞回来。走同一条链，副产物是顺带绕开了 CORS。
 */
(function () {
    'use strict';

    var seq = 0;
    var pending = {};
    var playerPromise = null;

    function post(msg) {
        if (parent) { parent.postMessage(msg, '*'); }
    }

    function ask(msg, timeoutMs) {
        var id = 'r' + (++seq);
        msg.id = id;
        return new Promise(function (resolve, reject) {
            var timer = setTimeout(function () {
                delete pending[id];
                reject(new Error('父页面响应超时：' + (msg.t || '')));
            }, timeoutMs || 20000);
            pending[id] = {
                ok: function (v) { clearTimeout(timer); resolve(v); },
                fail: function (e) { clearTimeout(timer); reject(e); }
            };
            post(msg);
        });
    }

    /** 给 Player.create 用的 fetch：把请求转给父页面 */
    function proxyFetch(input) {
        var url = (typeof input === 'string') ? input : (input && input.url) || String(input);
        return ask({ t: 'fetch', url: url }, 30000).then(function (r) {
            return new Response(r.text || '', {
                status: r.status || 200,
                statusText: r.statusText || 'OK',
                headers: { 'content-type': 'text/javascript' }
            });
        });
    }

    function getPlayer(playerId) {
        if (playerPromise) { return playerPromise; }
        var YTJS = window.YTJS;
        if (!YTJS || !YTJS.Player) {
            return Promise.reject(new Error('youtubei 没加载（lib/youtubei.min.js）'));
        }
        playerPromise = YTJS.Player.create(undefined, proxyFetch, null, playerId || undefined)
            .catch(function (e) {
                playerPromise = null;            // 失败了允许重试
                throw e;
            });
        return playerPromise;
    }

    window.addEventListener('message', function (ev) {
        var d = ev.data || {};
        if (d.vr !== 'nsig') { return; }

        getPlayer(d.playerId).then(function (player) {
            var urls = d.urls || [];
            return Promise.all(urls.map(function (u) {
                if (!u) { return Promise.resolve(''); }
                return player.decipher(u).catch(function (e) {
                    return { __err: String((e && e.message) || e) };
                });
            })).then(function (out) {
                post({ vr: 'nsig-res', id: d.id, ok: true, urls: out, playerId: player.player_id });
            });
        }).catch(function (e) {
            post({ vr: 'nsig-res', id: d.id, ok: false, err: String((e && e.message) || e) });
        });
    });

    window.addEventListener('message', function (ev) {
        var d = ev.data || {};
        if (d.vr !== 'fetch-res' || !pending[d.id]) { return; }
        var p = pending[d.id];
        delete pending[d.id];
        p.ok(d);
    });

    // 告诉父页面沙箱就绪
    post({ vr: 'nsig-ready' });
})();
