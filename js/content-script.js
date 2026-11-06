(function () {
    var _videoObj = [];
    var _videoSrc = [];
    var _key = new Set();
    var m3u8Text = new Map();

    /* ---------- 扩展上下文存活判定 ----------
     * 扩展被更新/重载后，旧页面里的 content script 会变成「孤儿」：
     * 监听器还在、仍能收到页面消息，但任何 chrome.* 调用都会同步抛
     * "Extension context invalidated."。以前这些调用点是裸调用，
     * 页面每推一条消息就在 edge://extensions 错误页攒一条红字
     * （实测单个小红书页面可积到 30 条以上，且会一直涨到刷新为止）。
     * 现在统一先判存活、再兜底发送；确实失效就静默自毁，不再制造噪音。 */
    var _dead = false;
    var _pageListener = null;

    function runtimeAlive() {
        if (_dead) { return false; }
        try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
    }

    /* 上下文已失效：摘掉页面监听器（否则还会继续吞掉页面的 postMessage），
     * 断开保活通道，后续所有发送直接短路。 */
    function bury() {
        if (_dead) { return; }
        _dead = true;
        try {
            if (_pageListener) { window.removeEventListener("message", _pageListener, { capture: true }); }
        } catch (e) { /* 忽略 */ }
        try {
            if (Port && Port.onDisconnect) { Port.onDisconnect.removeListener(onPortDisconnect); }
            if (Port && Port.disconnect) { Port.disconnect(); }
        } catch (e) { /* 忽略 */ }
    }

    /* 统一发送口：先判存活，再包 try/catch，并读一次 lastError，
     * 避免控制台再报 "Unchecked runtime.lastError"。 */
    function safeSend(msg, cb) {
        if (!runtimeAlive()) { bury(); return false; }
        try {
            chrome.runtime.sendMessage(msg, function (res) {
                void chrome.runtime.lastError;
                if (cb) { try { cb(res); } catch (e) { /* 忽略 */ } }
            });
            return true;
        } catch (e) {
            bury();
            return false;
        }
    }

    chrome.runtime.onMessage.addListener(function (Message, sender, sendResponse) {
        if (chrome.runtime.lastError) { return; }
        // 获取页面视频对象
        if (Message.Message == "getVideoState") {
            let videoObj = [];
            let videoSrc = [];
            document.querySelectorAll("video, audio").forEach(function (video) {
                if (video.currentSrc != "" && video.currentSrc != undefined) {
                    videoObj.push(video);
                    videoSrc.push(video.currentSrc);
                }
            });
            const iframe = document.querySelectorAll("iframe");
            if (iframe.length > 0) {
                iframe.forEach(function (iframe) {
                    if (iframe.contentDocument == null) { return true; }
                    iframe.contentDocument.querySelectorAll("video, audio").forEach(function (video) {
                        if (video.currentSrc != "" && video.currentSrc != undefined) {
                            videoObj.push(video);
                            videoSrc.push(video.currentSrc);
                        }
                    });
                });
            }
            if (videoObj.length > 0) {
                if (videoObj.length !== _videoObj.length || videoSrc.toString() !== _videoSrc.toString()) {
                    _videoSrc = videoSrc;
                    _videoObj = videoObj;
                }
                Message.index = Message.index == -1 ? 0 : Message.index;
                const video = videoObj[Message.index];
                const timePCT = video.currentTime / video.duration * 100;
                sendResponse({
                    time: timePCT,
                    currentTime: video.currentTime,
                    duration: video.duration,
                    volume: video.volume,
                    count: _videoObj.length,
                    src: _videoSrc,
                    paused: video.paused,
                    loop: video.loop,
                    speed: video.playbackRate,
                    muted: video.muted,
                    type: video.tagName.toLowerCase(),
                    videoStatus: videoObj.map(v => v.paused ? 1 : 0)
                });
                return true;
            }
            sendResponse({ count: 0 });
            return true;
        }
        // 速度控制
        if (Message.Message == "speed") {
            if (_videoObj[Message.index]?.playbackRate !== undefined) {
                _videoObj[Message.index].playbackRate = Message.speed;
            }
            return true;
        }
        // 画中画
        if (Message.Message == "pip") {
            if (document.pictureInPictureElement) {
                try { document.exitPictureInPicture(); } catch (e) { return true; }
                sendResponse({ state: false });
                return true;
            }
            try { _videoObj[Message.index].requestPictureInPicture(); } catch (e) { return true; }
            sendResponse({ state: true });
            return true;
        }
        // 全屏
        if (Message.Message == "fullScreen") {
            if (document.fullscreenElement) {
                try { document.exitFullscreen(); } catch (e) { return true; }
                sendResponse({ state: false });
                return true;
            }
            setTimeout(function () {
                try { _videoObj[Message.index].requestFullscreen(); } catch (e) { return true; }
            }, 500);
            sendResponse({ state: true });
            return true;
        }
        // 播放
        if (Message.Message == "play") {
            _videoObj[Message.index]?.play();
            return true;
        }
        // 暂停
        if (Message.Message == "pause") {
            _videoObj[Message.index]?.pause();
            return true;
        }
        // 循环播放
        if (Message.Message == "loop") {
            if (_videoObj[Message.index]?.loop !== undefined) {
                _videoObj[Message.index].loop = Message.action;
            }
            return true;
        }
        // 设置音量
        if (Message.Message == "setVolume") {
            if (_videoObj[Message.index]?.volume !== undefined) {
                _videoObj[Message.index].volume = Message.volume;
            }
            sendResponse("ok");
            return true;
        }
        // 静音
        if (Message.Message == "muted") {
            if (_videoObj[Message.index]?.muted !== undefined) {
                _videoObj[Message.index].muted = Message.action;
            }
            return true;
        }
        // 设置视频进度
        if (Message.Message == "setTime") {
            if (_videoObj[Message.index]?.currentTime !== undefined && _videoObj[Message.index]?.duration !== undefined) {
                _videoObj[Message.index].currentTime = Message.time * _videoObj[Message.index].duration / 100;
            }
            sendResponse("ok");
            return true;
        }
        // 截图视频图片
        if (Message.Message == "screenshot") {
            try {
                let video = _videoObj[Message.index];
                let canvas = document.createElement("canvas");
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
                let link = document.createElement("a");
                link.href = canvas.toDataURL("image/jpeg");
                link.download = `${location.hostname}-${secToTime(video.currentTime)}.jpg`;
                link.click();
                canvas = null;
                link = null;
                sendResponse("ok");
                return true;
            } catch (e) { console.log(e); return true; }
        }
        if (Message.Message == "getKey") {
            sendResponse(Array.from(_key));
            return true;
        }
        if (Message.Message == "ffmpeg") {
            if (!Message.files) {
                window.postMessage(Message);
                sendResponse("ok");
                return true;
            }
            Message.quantity ??= Message.files.length;
            for (let item of Message.files) {
                const data = { ...Message, ...item };
                data.type = item.type ?? "video";
                if (data.data instanceof Blob) {
                    window.postMessage(data);
                } else {
                    fetch(data.data)
                        .then(response => response.blob())
                        .then(blob => {
                            data.data = blob;
                            window.postMessage(data);
                        });
                }
            }
            sendResponse("ok");
            return true;
        }
        if (Message.Message == "getPage") {
            if (Message.find) {
                const DOM = document.querySelector(Message.find);
                DOM ? sendResponse(DOM.innerHTML) : sendResponse("");
                return true;
            }
            sendResponse(document.documentElement.outerHTML);
            return true;
        }
        if (Message.Message == "getM3u8Text") {
            if (Message.url && m3u8Text.has(Message.url)) {
                sendResponse(m3u8Text.get(Message.url));
                return true;
            }
            sendResponse("");
            return true;
        }
        if (Message.Message == "getM3u8Cache") {
            fetch(Message.url, { method: "GET", cache: "force-cache" })
                .then(response => response.text())
                .then(text => sendResponse({ success: true, data: text }))
                .catch(() => sendResponse({ success: false, error: "Failed to fetch" }));
            return true;
        }
    });

    // Heart Beat
    var Port = null;
    function onPortDisconnect() {
        if (!Port) { return; }
        try { void chrome.runtime.lastError; } catch (e) { /* 忽略 */ }
        // 上下文已失效就别再重连了：孤儿态下 connect 只会同步抛错，
        // 而且 onDisconnect 会再次触发，形成递归风暴。
        if (!runtimeAlive()) { bury(); return; }
        connect();
    }
    function connect() {
        if (!runtimeAlive()) { bury(); return; }
        try {
            Port = chrome.runtime.connect(chrome.runtime.id, { name: "HeartBeat" });
            Port.postMessage("HeartBeat");
            Port.onMessage.addListener(function (message, Port) { return true; });
            Port.onDisconnect.addListener(onPortDisconnect);
        } catch (e) {
            bury();
        }
    }
    connect();

    function secToTime(sec) {
        let time = "";
        let hour = Math.floor(sec / 3600);
        let min = Math.floor((sec % 3600) / 60);
        sec = Math.floor(sec % 60);
        if (hour > 0) { time = hour + "'"; }
        if (min < 10) { time += "0"; }
        time += min + "'";
        if (sec < 10) { time += "0"; }
        time += sec;
        return time;
    }
    const isFirefox = navigator.userAgent.includes('Firefox');
    const sendAddMedia = (data) => {
        safeSend({
            Message: "addMedia",
            url: data.url,
            href: data.href ?? location.href,
            extraExt: data.ext,
            mime: data.mime,
            requestHeaders: { referer: data.referer },
            requestId: data.requestId
        });
    };
    _pageListener = function (event) {
        const action = ["catCatchAddMedia", "catCatchAddKey", "catCatchFFmpeg", "catCatchFFmpegResult", "catCatchCloseScript", "vrNetMedia"];
        if (!event.data || !event.data.action || event.origin !== window.location.origin || !action.includes(event.data.action)) { return; }
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (event.data.action == "catCatchAddMedia") {
            if (!event.data.url) { return; }

            /*
             * firefox 不允许直接下载跨域blob内容
             * fetch获取文本内容并缓存到m3u8Text中，供 m3u8.html调用获取。
             */
            if (event.data.url.startsWith("blob:") && isFirefox) {
                fetch(event.data.url)
                    .then(response => response.text())
                    .then(text => {
                        m3u8Text.set(event.data.url, text);
                        sendAddMedia(event.data);
                    });
                return;
            }
            sendAddMedia(event.data);
        }
        if (event.data.action == "vrNetMedia") {
            /* 页面侧（MAIN world 的 net-sniff.js）从接口 JSON 里挖到的媒体地址。
               抖音这类站的播放地址不在网络请求里，只在接口响应里，靠这一步才能拿到。
               交给后台的 addMedia 通道：类型判定、去重、大小上限都在那边。 */
            const urls = event.data.urls;
            if (!urls || !urls.length) { return; }
            for (let i = 0; i < urls.length; i++) {
                const it = urls[i];
                const u = String((it && it.u) || it || "");
                const x = (it && it.x) || "";
                if (!/^https?:/i.test(u)) { continue; }
                // ext 必须一起带上：抖音的地址没有 .mp4 后缀，
                // 不带 extraExt 后台会把 ext 判成空，悬浮键就列不出这个源。
                sendAddMedia({ url: u, ext: x || undefined, href: location.href });
            }
            return;
        }
        if (event.data.action == "catCatchAddKey") {
            let key = event.data.key;
            if (key instanceof ArrayBuffer || key instanceof Array) {
                key = ArrayToBase64(key);
            }
            if (_key.has(key)) { return; }
            _key.add(key);
            safeSend({
                Message: "send2local",
                action: "addKey",
                data: key,
            });
            safeSend({
                Message: "popupAddKey",
                data: key,
                url: event.data.url,
            });
        }
        if (event.data.action == "catCatchFFmpeg") {
            if (!event.data.use ||
                !event.data.files ||
                !event.data.files instanceof Array ||
                event.data.files.length == 0
            ) { return; }
            event.data.title = event.data.title ?? document.title ?? new Date().getTime().toString();
            event.data.title = event.data.title.replaceAll('"', "").replaceAll("'", "").replaceAll(" ", "");
            let data = {
                Message: event.data.action,
                action: event.data.use,
                files: event.data.files,
                url: event.data.href ?? event.source.location.href,
            };
            data = { ...event.data, ...data };
            safeSend(data);
        }
        if (event.data.action == "catCatchFFmpegResult") {
            if (!event.data.state || !event.data.tabId) { return; }
            safeSend({ Message: "catCatchFFmpegResult", ...event.data });
        }
        if (event.data.action == "catCatchCloseScript") {
            if (!event.data.script || !event.isTrusted) { return; }
            safeSend({ Message: "closeScript", ...event.data });
        }

    };

    // 注册为具名引用，孤儿态下才能被 bury() 摘掉
    // 注意：connect() 在加载早期就可能因孤儿态触发 bury()，
    // 那时监听器还没赋值。所以这里先判存活：已经死了就不注册，
    // 免得继续吞掉页面的 postMessage（否则页面消息也会被无声吃掉）。
    if (!_dead && runtimeAlive()) {
        window.addEventListener("message", _pageListener, { capture: true });
    } else {
        bury();
    }

    function ArrayToBase64(data) {
        try {
            let bytes = new Uint8Array(data);
            let binary = "";
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            if (typeof _btoa == "function") {
                return _btoa(binary);
            }
            return btoa(binary);
        } catch (e) {
            return false;
        }
    }
})();