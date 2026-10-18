/**
 * 钓鱼竿 M11 多段合并 —— 手动兜底页（m3u8-multi.html）
 * 日常不需要用：嗅探到同页多段 m3u8 时面板会自动归组，勾选下载即后台合并。
 * 这个页面只用于「自动归组没认出来」时手动贴地址走同一条直连管线
 * （解析/下载/解密/合并全在离屏文档，本页只负责发任务、显示进度、点保存）。
 */
(function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };

    var running = false;
    var taskId = 'mm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var segments = [];

    // 默认文件名：merged_年月日_时分
    (function () {
        var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
        $('filename').value = 'merged_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate())
            + '_' + p(d.getHours()) + p(d.getMinutes());
    })();

    function log(msg) {
        var el = $('log');
        var t = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
        el.textContent += '\n[' + p(t.getHours()) + ':' + p(t.getMinutes()) + ':' + p(t.getSeconds()) + '] ' + msg;
        el.scrollTop = el.scrollHeight;
    }

    function fmtSize(n) {
        if (n > 1024 * 1024 * 1024) { return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'; }
        if (n > 1024 * 1024) { return (n / 1024 / 1024).toFixed(1) + ' MB'; }
        if (n > 1024) { return (n / 1024).toFixed(0) + ' KB'; }
        return n + ' B';
    }

    function renderSegs() {
        var box = $('seglist');
        box.innerHTML = '';
        segments.forEach(function (s) {
            var row = document.createElement('div');
            row.className = 'seg';
            var no = document.createElement('span'); no.className = 'no'; no.textContent = s.index + 1;
            var url = document.createElement('span'); url.className = 'url'; url.textContent = s.url; url.title = s.url;
            var st = document.createElement('span'); st.className = 'st ' + s.state;
            var label = { waiting: '等待中', downloading: '下载中', done: '完成', error: '失败' }[s.state];
            if (s.state === 'downloading' && s.progress) { label = s.progress; }
            row.appendChild(no); row.appendChild(url); row.appendChild(st);
            st.textContent = label;
            box.appendChild(row);
        });
    }

    function setProgress(done, total) {
        $('bar').classList.add('on');
        $('barIn').style.width = (total ? Math.round(done / total * 100) : 0) + '%';
    }

    // 合并结果就绪 → 按钮变成保存
    function showSave(bytes) {
        var btn = $('startBtn');
        btn.disabled = false;
        btn.textContent = '保存文件（' + fmtSize(bytes) + '）';
        btn.onclick = function () {
            var name = ($('filename').value || '').trim() || ('merged_' + Date.now());
            chrome.runtime.sendMessage({
                Message: 'vrMergeSave', taskId: taskId, filename: 'video-rod/' + name
            }, function () { void chrome.runtime.lastError; });
            log('保存中…');
            btn.disabled = true;
            btn.textContent = '保存中…';
        };
    }

    chrome.runtime.onMessage.addListener(function (Message) {
        if (!Message || Message.taskId !== taskId) { return; }
        if (Message.Message === 'vrMergeProgress') {
            log(Message.text || '下载中…');
            if (Message.index > 0) {
                var i = Message.index - 1;
                segments.forEach(function (s, k) {
                    if (k < i) { s.state = 'done'; }
                    else if (k === i) { s.state = 'downloading'; s.progress = Message.text; }
                });
                renderSegs();
                setProgress(Message.index, segments.length);
            }
        }
        if (Message.Message === 'vrMergeReady') {
            segments.forEach(function (s) { s.state = 'done'; });
            renderSegs();
            setProgress(segments.length, segments.length);
            log('拼好了：' + fmtSize(Message.bytes) + '，点下方保存');
            showSave(Message.bytes);
            running = false;
        }
        if (Message.Message === 'vrMergeError') {
            segments.forEach(function (s) {
                if (s.state === 'downloading') { s.state = 'error'; }
            });
            renderSegs();
            log('失败：' + (Message.error || '未知错误'));
            var btn = $('startBtn');
            btn.disabled = false;
            btn.textContent = '重新开始';
            btn.onclick = null;
            running = false;
        }
        if (Message.Message === 'vrMergeSaved') {
            log(Message.ok ? '已保存到 video-rod/' : ('保存失败：' + (Message.error || '')));
            var btn = $('startBtn');
            btn.textContent = '再拼一段';
        }
    });

    $('startBtn').addEventListener('click', function () {
        if (running) { return; }
        var urls = $('urls').value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        if (urls.length < 2) { log('至少需要 2 个片段地址'); return; }
        segments = urls.map(function (url, i) {
            return { index: i, url: url, state: i === 0 ? 'downloading' : 'waiting', progress: '' };
        });
        renderSegs();
        setProgress(0, urls.length);
        $('log').textContent = '';
        log('共 ' + urls.length + ' 段，开始后台下载合并');
        running = true;
        var btn = $('startBtn');
        btn.disabled = true;
        btn.textContent = '合并中…';
        chrome.runtime.sendMessage({ Message: 'vrMergeStart', taskId: taskId, urls: urls }, function () {
            void chrome.runtime.lastError;
        });
    });
})();
