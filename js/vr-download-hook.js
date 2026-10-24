/**
 * 钓鱼竿：下载文件名保护（页面侧挂钩）
 * 背景：Chromium bug 579563——浏览器内任何扩展注册 onDeterminingFilename 监听后，
 * downloads.download({filename}) 的 filename 会被忽略（落盘变服务器名/UUID名）。
 * SW 侧（background.js）已注册监听并按 URL 记账 suggest；页面自身发起的下载，
 * 在下载前把文件名经 IPC 记账给 SW（页面上下文与 SW 不共享内存）。
 * 关键时序：必须等 SW 记账确认（sendMessage 回调）后才发起下载——blob:/data:
 * 下载不走网络，onDeterminingFilename 几乎立即触发，fire-and-forget 式记账赛不过它。
 * 幂等：重复加载只包一层；守卫属性用 __vrNameHooked，与 popup-videorod.js 的
 * hookDownloadsApi（__vrHooked）错开，两个 hook 可叠加互不冲突。
 * 由 popup.html / options.html / m3u8.html / downloader.html 加载。
 */
(function () {
    'use strict';
    try {
        var api = chrome.downloads;
        if (!api || !api.download || api.download.__vrNameHooked) { return; }
        var orig = api.download;
        var wrapped = function (opts, cb) {
            if (opts && typeof opts.filename === 'string' && opts.filename) {
                // 资源库：从三段路径反解平台/博主/类型，随记账一起预登记
                var meta = null;
                try {
                    var P = self.VRPath;
                    if (P && P.parseRelPath) {
                        var rel = String(opts.filename).replace(/\\/g, '/');
                        var p = P.parseRelPath(rel) || {};
                        meta = {
                            relPath: rel,
                            platform: p.platform || '',
                            platformName: p.platformName || '',
                            creatorFull: p.creatorFull || '',
                            creatorId: p.creatorId || '',
                            type: p.type || '',
                            pageUrl: '',
                            title: ''
                        };
                    }
                } catch (e) { meta = null; }

                try {
                    chrome.runtime.sendMessage({
                        Message: 'vrQueueName',
                        url: opts.url,
                        filename: opts.filename,
                        conflictAction: opts.conflictAction,
                        meta: meta
                    }, function () {
                        // 无论 SW 是否应答（休眠唤醒失败等极端情况），都继续下载，
                        // 最多退化回落盘默认名，不能卡住用户的下载。
                        orig.call(api, opts, cb);
                    });
                    return;
                } catch (e) { /* 记账通道异常，直连下载降级 */ }
            }
            return orig.call(api, opts, cb);
        };
        wrapped.__vrNameHooked = true;
        api.download = wrapped;   // 个别版本 API 只读（参考猫抓 hookDownloadsApi 注释），炸了就静默放弃
    } catch (e) { /* 页面无 downloads 权限或 API 异常，不阻断页面其他功能 */ }
})();
