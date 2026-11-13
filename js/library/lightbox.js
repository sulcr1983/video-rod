/* ==========================================================
 * VR Preview —— 原型 .preview 复刻（R5）
 * 真源：media-library-stage-v1.html 的 openPreview / paintInfo / 控件
 * 数据：真实 file:// URL（VRPath.toFileUrl），缺 absPath 时提示
 * ========================================================== */
(function () {
    'use strict';
    var root = window;
    var $ = function (s) { return document.querySelector(s); };
    var esc = function (s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    };
    function fmt(mb) {
        var n = Number(mb) || 0;
        if (n >= 1024) { return (n / 1024).toFixed(1) + ' GB'; }
        if (n >= 1) { return n.toFixed(1) + ' MB'; }
        return Math.round(n * 1024) + ' KB';
    }

    /* 只保留「已知平台的品牌色点」。
     * 显示名一律走 platLabel()（站点字典：手改 > 预置 > 自动学习 > 域名），
     * 这里不再维护第二份名称，避免两处文案漂移
     * （2026-11-07：此前 lightbox / app / ui / path 各有一份 PLAT 字典）。 */
    var PLAT_DOT = {
        x: '#8FA0B8', xiaohongshu: '#FF2442',
        douyin: '#25C8D4', weibo: '#E6506D',
        youtube: '#FF0000', instagram: '#C13584',
        bilibili: '#FB7299', tiktok: '#25F4EE',
        web: '#8B93A1', untracked: '#C9A227'
    };
    function dotOf(key) { return PLAT_DOT[key] || PLAT_DOT.web; }
    var KIND_LABEL = { video: '视频', image: '图片', anim: '动图', live: '实况', audio: '音频', other: '其他' };

    var S = { list: [], idx: 0, info: true, auto: true, rate: 1 };
    var el = {};
    var videoEl = null;
    var animCtl = null;
    var imgEl = null;
    var imgScale = 1;
    var imgRot = 0;
    var imgBaseW = 0;
    var imgBaseH = 0;
    var imgX = 0;
    var imgY = 0;

    /* 成熟播放器（Plyr 3.8.3）实例与布局状态 */
    var plyr = null;
    var playerBox = null;
    var playerRatio = 0;
    var posterUrl = '';
    var spdWrap = null;      /* 倍速直选按钮外层（.vr-spdwrap） */
    var spdBtn = null;
    var spdMenu = null;
    var spdDocClose = null;  /* 菜单开着时挂 document 的关闭监听 */

    function spdCloseMenu() {
        if (spdWrap) { spdWrap.classList.remove('on'); }
        if (spdDocClose) {
            document.removeEventListener('pointerdown', spdDocClose);
            spdDocClose = null;
        }
    }

    function destroyPlayer() {
        spdCloseMenu();
        spdWrap = null; spdBtn = null; spdMenu = null;
        if (plyr) { try { plyr.destroy(); } catch (e) { /* ignore */ } }
        plyr = null;
        if (posterUrl) { try { URL.revokeObjectURL(posterUrl); } catch (e) { /* ignore */ } }
        posterUrl = '';
        playerBox = null;
        playerRatio = 0;
    }

    /** 倍速直选：Plyr 原生把倍速藏在齿轮二级菜单——点一次出来 Settings 面板、
     * 还要点一次 Speed，且全是英文。齿轮唯一的职责就是倍速，直接退役，
     * 控件条上放一个「1×」按钮，点一下弹出倍速菜单，当前倍速金色高亮。 */
    function updSpdBtn() {
        if (spdBtn) { spdBtn.textContent = S.rate + '×'; }
        if (spdMenu) {
            var items = spdMenu.querySelectorAll('.vr-spdo');
            for (var i = 0; i < items.length; i++) {
                items[i].classList.toggle('on', parseFloat(items[i].getAttribute('data-rate')) === S.rate);
            }
        }
    }

    function buildSpeedCtl() {
        if (!plyr || !plyr.elements || !plyr.elements.container) { return; }
        var bar = plyr.elements.container.querySelector('.plyr__controls');
        if (!bar) { return; }
        spdWrap = document.createElement('span');
        spdWrap.className = 'plyr__controls__item vr-spdwrap';
        spdBtn = document.createElement('button');
        spdBtn.type = 'button';
        spdBtn.className = 'plyr__control vr-spd';
        spdBtn.title = '倍速';
        spdBtn.setAttribute('aria-label', '倍速');
        spdMenu = document.createElement('span');
        spdMenu.className = 'vr-spdm';
        var opts = [0.1, 0.2, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
        for (var i = 0; i < opts.length; i++) {
            (function (r) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'vr-spdo';
                b.setAttribute('data-rate', String(r));
                b.textContent = r + '×';
                b.addEventListener('click', function () {
                    plyr.speed = r;   /* Plyr 3.x 官方 setter，内部同步 config 并触发 ratechange */
                    updSpdBtn();
                    spdCloseMenu();
                });
                spdMenu.appendChild(b);
            })(opts[i]);
        }
        spdBtn.addEventListener('click', function () {
            var open = spdWrap.classList.toggle('on');
            if (open && !spdDocClose) {
                /* 点按钮本身不算「点外面」：pointerdown 命中按钮时跳过，click 再正常 toggle */
                spdDocClose = function (ev) {
                    if (spdWrap && spdWrap.contains(ev.target)) { return; }
                    spdCloseMenu();
                };
                document.addEventListener('pointerdown', spdDocClose);
            } else if (!open) { spdCloseMenu(); }
        });
        spdWrap.appendChild(spdBtn);
        spdWrap.appendChild(spdMenu);
        /* 位置放在画中画按钮前面（原齿轮的位置），找不到就排到末尾 */
        var pip = bar.querySelector('[data-plyr="pip"]');
        if (pip && pip.parentNode === bar) { bar.insertBefore(spdWrap, pip); }
        else { bar.appendChild(spdWrap); }
        updSpdBtn();
    }

    /** 按视频真实宽高比给播放器外壳定尺寸，不再一律塞进 16:9 的默认框 */
    function fitPlayer() {
        if (!playerBox || !playerRatio) { return; }
        var stage = $('#pvMedia');
        if (!stage) { return; }
        var r = stage.getBoundingClientRect();
        if (!r.width || !r.height) { return; }
        var availW = Math.max(120, r.width);
        var availH = Math.max(100, r.height);
        var w = availW, h = w / playerRatio;
        if (h > availH) { h = availH; w = h * playerRatio; }
        var shell = playerBox.querySelector('.plyr') || playerBox;
        shell.style.width = Math.round(w) + 'px';
        shell.style.height = Math.round(h) + 'px';
    }

    /** 预览图：复用资源库的视频抽帧缓存（WebP blob），作为播放器 poster */
    function setPoster(f, v) {
        if (!f || !f.relPath || !root.VRDB || !root.VRDB.getThumb) { return; }
        try {
            root.VRDB.getThumb('t:' + f.relPath).then(function (t) {
                if (!t || !t.blob || !v.isConnected) { return; }
                var u = URL.createObjectURL(t.blob);
                posterUrl = u;
                try { v.poster = u; } catch (e) { /* ignore */ }
                if (plyr) { try { plyr.poster = u; } catch (e) { /* ignore */ } }
            }).catch(function () { /* 没缓存就保持黑底，不阻断播放 */ });
        } catch (e) { /* ignore */ }
    }

    function seekBy(d) {
        if (!videoEl || !isFinite(videoEl.duration)) { return; }
        var t = videoEl.currentTime + d;
        videoEl.currentTime = Math.max(0, Math.min(videoEl.duration || 0, t));
    }

    /* ---- 图片缩放/旋转（工具栏和键盘共用） ---- */
    function applyImgView() {
        if (!imgEl) { return; }
        imgEl.style.transformOrigin = 'center center';
        imgEl.style.transform = 'translate(' + imgX + 'px,' + imgY + 'px) scale(' + imgScale + ') rotate(' + imgRot + 'deg)';
        setTxt('iZoom', Math.round(imgScale * 100) + '%');
    }
    function fitImg() {
        if (!imgEl) { return; }
        imgScale = 1; imgRot = 0; imgX = 0; imgY = 0; applyImgView();
    }
    function actualImg() {
        if (!imgEl) { return; }
        var nw = imgEl.naturalWidth || imgBaseW || 1;
        var nh = imgEl.naturalHeight || imgBaseH || 1;
        /* 图片在 contain 框里已经被等比缩放；1:1 要把“内容”放大回自然像素 */
        var contain = Math.min((imgBaseW || nw) / nw, (imgBaseH || nh) / nh) || 1;
        imgScale = Math.max(0.1, Math.min(8, 1 / contain));
        imgX = 0; imgY = 0;
        applyImgView();
    }
    function zoomImg(factor) {
        if (!imgEl) { return; }
        imgScale = Math.max(0.1, Math.min(8, imgScale * factor));
        applyImgView();
    }
    function rotateImg() {
        if (!imgEl) { return; }
        imgRot = (imgRot + 90) % 360;
        applyImgView();
    }

    function cache() {
        ['preview', 'pvCrumb', 'pvCount', 'pvTitle', 'pvPlat', 'pvType', 'pvMedia',
            'pvPrev', 'pvNext', 'pvClose', 'pvBack', 'pvInfoBtn', 'pvFullBtn', 'pvFilm',
            'pvAuthorRow', 'pvAvatar', 'pvAuthor', 'pvOpenTop', 'pvFav', 'pvStar', 'pvStateRow', 'pvState',
            'st1v', 'st2v', 'st3v', 'pvThirdRow', 'pvThirdK', 'pvThirdV',
            'pvSaved', 'pvPath', 'pvPathCopy', 'pvSrcBadge', 'pvPageRow', 'pvPageVal',
            'pvHashRow', 'pvHashVal', 'pvHashCopy', 'pvRefRow', 'pvRefVal',
            'pvRefFold', 'pvRefCount', 'pvRefItems',
            'pvSrcMiss', 'pvWorkId', 'pvTags',
            /* 这几项原先没进 cache：直链行因此永远显示默认「—」，同作者永远 0 项 */
            'pvStageEl', 'pvMediaRow', 'pvMediaVal', 'pvMoreCount', 'pvMoreGrid',
            'vCtl', 'vPlay', 'vCur', 'vDur', 'vProg', 'vFill', 'vRate', 'ratePop', 'rpGrid',
            'imgBar', 'gifBar'].forEach(function (id) { el[id] = document.getElementById(id); });
    }

    function urlOf(f) {
        if (f && f._fileUrl) { return f._fileUrl; }
        if (!f || !f.absPath || !root.VRPath) { return ''; }
        try { return root.VRPath.toFileUrl(f.absPath); } catch (e) { return ''; }
    }

    /**
     * 按「库内相对路径」取本地 URL（实况视频用，2026-11-11 B-71）。
     * 走 RAW 表拿那条真实记录的 absPath，再转 file://；拿不到返回空串
     * —— 调用方据此跳过实况、只显示照片，绝不猜路径。
     */
    function fileUrlOf(rel) {
        try {
            var raw = (root.VRApp && typeof root.VRApp.getRaw === 'function') ? root.VRApp.getRaw() : null;
            var e = raw && raw[rel];
            if (!e || !e.absPath || !root.VRPath) { return ''; }
            return root.VRPath.toFileUrl(e.absPath);
        } catch (err) { return ''; }
    }

    /* 自选文件夹没有绝对路径时，用目录句柄读出 Blob URL。切换条目/关闭时回收。 */
    var lastShown = null;

    /* 「已有标签」候选的刷新钩子：由 bindInfoPanel 里的标签逻辑赋值，
     * paintInfo 每次切换素材后调用它。声明放模块级，避免 TDZ / 未定义引用。 */
    var tagPickRefresh = null;

    function releaseUrl(f) {
        if (!f) { return; }
        if (typeof f._revokeUrl === 'function') {
            try { f._revokeUrl(); } catch (e) { /* 忽略 */ }
        }
        f._fileUrl = '';
        f._revokeUrl = null;
    }
    function fmtDur(sec) {
        var s = Math.round(Number(sec) || 0);
        var m = Math.floor(s / 60), r = s % 60;
        return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
    }
    function setTxt(id, v) { var e = document.getElementById(id); if (e) { e.textContent = v; } }
    function show(id, on) { var e = document.getElementById(id); if (e) { e.classList.toggle('hidden', !on); } }

    function renderStage(f) {
        var stage = $('#pvMedia');
        if (!stage) { return; }
        destroyPlayer();
        stage.innerHTML = '';
        stage.style.cursor = '';
        videoEl = null;
        imgEl = null; imgScale = 1; imgRot = 0; imgBaseW = 0; imgBaseH = 0; imgX = 0; imgY = 0;
        setTxt('iZoom', '100%');
        var url = urlOf(f);
        var kind = f.kind;

        /* CSS 里 .pv-stage.is-video .fakeMedia 才铺满舞台。
         * 这个 class 之前从来没人加过 → 视频一直被锁在 62% 宽的 16:9 小框里，
         * 四周留大片空白（用户 2026-11-05 截图反馈）。 */
        var stageOuter = el.pvStageEl || document.getElementById('pvStageEl');
        if (stageOuter) {
            stageOuter.classList.toggle('is-video', kind === 'video');
            stageOuter.classList.toggle('is-gif', kind === 'anim');
            /* 实况按图片布局：照片占位定比例，视频浮在上面（不铺满、不抢图注区） */
            stageOuter.classList.toggle('is-image', kind === 'image' || kind === 'live');
            stageOuter.classList.toggle('is-live', kind === 'live');
            stageOuter.classList.toggle('is-audio', kind === 'audio');
        }

        /* 有成熟播放器时让自绘控件条让位；Plyr 没加载成功则保留原控件条降级 */
        show('vCtl', kind === 'video' && !root.Plyr);
        show('imgBar', kind === 'image' || kind === 'live');
        show('gifBar', kind === 'anim');

        if (!url) {
            stage.innerHTML = '<div class="viewer-missing">没有本地路径，无法预览（文件可能已移动）</div>';
            return;
        }
        if (kind === 'video') {
            var box = document.createElement('div');
            box.className = 'vr-player';
            var v = document.createElement('video');
            v.src = url; v.preload = 'metadata'; v.playsInline = true; v.controls = false;
            v.muted = false; v.volume = 1;   // 别让自动播放策略把声音吞掉
            box.appendChild(v);
            stage.appendChild(box);
            playerBox = box;
            playerRatio = 0;
            videoEl = v;

            v.addEventListener('loadedmetadata', function () {
                setTxt('st1v', v.videoWidth + '×' + v.videoHeight);
                setTxt('vDur', fmtDur(v.duration));
                if (v.videoWidth && v.videoHeight) {
                    playerRatio = v.videoWidth / v.videoHeight;
                    fitPlayer();
                }
            });
            v.addEventListener('timeupdate', function () {
                setTxt('vCur', fmtDur(v.currentTime));
                if (el.vFill && v.duration) { el.vFill.style.width = (v.currentTime / v.duration * 100) + '%'; }
            });
            v.addEventListener('ended', function () { if (S.auto) { step(1); } });
            v.playbackRate = S.rate;

            /* 采用成熟开源播放器：控件、倍速、全屏、画中画、无障碍全由 Plyr 负责，
             * 这里只负责把本地文件交给它、按真实比例布局、以及队列/滚轮语义。 */
            if (root.Plyr) {
                try {
                    var iconUrl = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
                        ? chrome.runtime.getURL('lib/plyr/plyr.svg') : 'lib/plyr/plyr.svg';
                    plyr = new root.Plyr(v, {
                        /* 2026-11-10：去掉 settings 齿轮——倍速改由控件条上的 1× 直选按钮负责（见 buildSpeedCtl） */
                        controls: ['play-large', 'play', 'progress', 'current-time',
                                   'mute', 'volume', 'pip', 'fullscreen'],
                        speed: { selected: S.rate, options: [0.1, 0.2, 0.5, 0.75, 1, 1.25, 1.5, 2, 3] },
                        iconUrl: iconUrl,
                        /* 键盘语义由本模块统一定义（↑↓ 切素材、←→ 调进度），
                           不让播放器自带的 ↑↓ 调音量抢走按键 */
                        keyboard: { focused: false, global: false },
                        hideControls: true,
                        tooltips: { controls: true, seek: true }
                    });
                    plyr.on('ratechange', function () {
                        if (plyr && plyr.speed) { S.rate = plyr.speed; }
                        updSpdBtn();
                    });
                    buildSpeedCtl();
                    fitPlayer();
                } catch (e) { plyr = null; }
            }
            setPoster(f, v);
            v.play().catch(function () { });
            setTxt('st1v', '—');
            setTxt('vDur', f.dur || '—');
        } else if (kind === 'anim' && root.VRAnim && root.VRAnim.supported()) {
            /* F6 动图逐帧：原生 ImageDecoder 解码到 canvas，可暂停/逐帧/循环/倍速 */
            var holder = document.createElement('div');
            holder.className = 'anim-holder';
            stage.appendChild(holder);
            setTxt('st1v', '—');
            root.VRAnim.attach({
                url: url,
                ext: f.ext,
                rate: S.rate,
                onFrame: function (n, total) {
                    setTxt('gNo', n);
                    setTxt('gTotal', total);
                },
                onReady: function (total) { setTxt('gTotal', total); setTxt('gNo', 1); },
                onError: function () {
                    /* 解码失败退回静态图，不让预览空白 */
                    var img0 = document.createElement('img');
                    img0.alt = f._title || f.title; img0.src = url;
                    holder.innerHTML = '';
                    holder.appendChild(img0);
                    var bar = document.getElementById('gifBar');
                    if (bar) { bar.classList.add('hidden'); }
                }
            }).then(function (ctl) {
                if (!ctl) { return; }
                animCtl = ctl;
                holder.innerHTML = '';
                holder.appendChild(ctl.canvas);
                var bar = document.getElementById('gifBar');
                if (bar) { bar.classList.remove('hidden'); }
                setTxt('gFmt', f.ext || 'GIF');
                setTxt('gTotal', ctl.total());
                setTxt('gNo', 1);
                var pb = document.querySelector('#gPause use');
                if (pb) { pb.setAttribute('href', '#i-pause'); }
            });
        } else if (kind === 'image' || kind === 'anim' || kind === 'live') {
            var img = document.createElement('img');
            img.alt = f._title || f.title; img.draggable = false;
            imgEl = img; imgScale = 1; imgRot = 0; imgBaseW = 0; imgX = 0; imgY = 0;
            img.addEventListener('load', function () {
                setTxt('st1v', img.naturalWidth + '×' + img.naturalHeight);
                imgBaseW = img.clientWidth || img.naturalWidth || 1;
                imgBaseH = img.clientHeight || img.naturalHeight || 1;
                applyImgView();
            });
            img.src = url;
            stage.appendChild(img);
            stage.style.cursor = 'grab';
            setTxt('st1v', '—');

            /* 实况：照片下面浮一段静音循环的实况视频（2026-11-11，B-71）。
             * 为什么用 <video> 而不是接到 anim 播放器：实况 mp4 是 H.264，
             * ImageDecoder 走的是 GIF/WebP 那套；<video muted loop autoplay>
             * 一行就能循环播放，还带声音轨（默认静音，点一下才开）。
             * 视频加载失败就只显示照片 —— 实况是加分项，不能把预览搞挂。 */
            if (kind === 'live' && f.livePair) {
                var lv = document.createElement('video');
                lv.className = 'pv-live';
                lv.src = fileUrlOf(f.livePair);
                lv.muted = true; lv.loop = true; lv.autoplay = true;
                lv.playsInline = true; lv.controls = false;
                lv.addEventListener('error', function () { try { lv.remove(); } catch (e0) { } });
                lv.addEventListener('loadedmetadata', function () {
                    setTxt('pvThirdV', fmtDur(lv.duration));
                });
                /* 点视频 = 开/关声音（手机系统相机那套交互习惯） */
                lv.addEventListener('click', function () {
                    lv.muted = !lv.muted;
                    if (!lv.muted) { lv.play().catch(function () { }); }
                });
                stage.appendChild(lv);
            }
        } else if (kind === 'audio') {
            /* 音频不是视频的缩小版：给独立的大尺寸播放器面板，
             * 原生 audio 控件负责播放/进度/音量，外层负责标题与来源信息。 */
            var aw = document.createElement('div');
            aw.className = 'vr-audio';
            aw.innerHTML = '<div class="a-ico"><svg class="i"><use href="#i-volume-2"/></svg></div>' +
                '<div class="a-title">' + esc(f._title || f.title) + '</div>' +
                '<div class="a-sub">' + esc(f.author || '未知来源') + ' · ' + fmt(f.size) + '</div>';
            var a = document.createElement('audio');
            a.src = url; a.controls = true; a.preload = 'auto';
            a.addEventListener('loadedmetadata', function () {
                setTxt('pvThirdV', fmtDur(a.duration));
            });
            a.addEventListener('canplay', function () {
                setTxt('pvThirdV', fmtDur(a.duration));
            });
            a.addEventListener('error', function () {
                setTxt('st1v', '—');
                if (stage) { stage.innerHTML = '<div class="viewer-missing">音频无法播放（文件可能已移动或格式不支持）</div>'; }
            });
            aw.appendChild(a);
            stage.appendChild(aw);
            videoEl = a;
            a.load();                 // 复用 K/M/空格/数字/方向键的媒体键盘语义
            a.play().catch(function () { });
            setTxt('st1v', '—');
        } else {
            var na = document.createElement('audio');
            na.src = url; na.controls = true;
            stage.appendChild(na);
            na.play().catch(function () { });
            setTxt('st1v', '—');
        }
    }

    /** 站点显示名：统一走站点字典，未收录才回落内置表 */
    function platLabel(key) {
        var R = root.VRSiteRegistry;
        if (R && typeof R.nameOf === 'function') {
            try {
                var n = R.nameOf(key);
                if (n) { return n; }
            } catch (e) { /* 落回内置表 */ }
        }
        var d = PLAT_DOT[key];
        return (d && (d.label || d.name)) || key || '网页';
    }

    function paintInfo(f) {
        var p = { dot: dotOf(f.plat) };
        if (el.pvCrumb) { el.pvCrumb.innerHTML = '<b>' + esc(platLabel(f.plat)) + '</b> / ' + esc(f.author || '未分类'); }
        setTxt('pvCount', (S.idx + 1) + ' / ' + S.list.length);
        setTxt('pvType', (KIND_LABEL[f.kind] || '媒体').toUpperCase());
        setTxt('pvTitle', f._title || f.title);
        if (el.pvTitle) { el.pvTitle.title = f._title || f.title; }
        var inFav = false;
        try { inFav = !!(root.VRFav && root.VRFav.hasFavorite && root.VRFav.hasFavorite(f.relPath)); } catch (e) { inFav = false; }
        if (el.pvFav) {
            el.pvFav.classList.toggle('on', inFav);
            el.pvFav.setAttribute('aria-pressed', inFav ? 'true' : 'false');
            var favLabel = el.pvFav.querySelector('span');
            if (favLabel) { favLabel.textContent = inFav ? '已收藏' : '收藏'; }
        }
        if (el.pvStar) {
            el.pvStar.classList.toggle('on', !!f.starred);
            el.pvStar.setAttribute('aria-pressed', f.starred ? 'true' : 'false');
            var starLabel = el.pvStar.querySelector('span');
            if (starLabel) { starLabel.textContent = f.starred ? '已星标' : '星标'; }
        }

        if (el.pvPlat) {
            el.pvPlat.innerHTML = '<i class="dot" style="--pc:' + p.dot + '"></i>' + esc(platLabel(f.plat)) + ' · ' + (KIND_LABEL[f.kind] || '');
        }
        if (el.pvAuthorRow) {
            var hasAuthor = !!f.author;
            el.pvAuthorRow.style.display = hasAuthor ? '' : 'none';
            if (hasAuthor) {
                setTxt('pvAvatar', f.author.slice(0, 1));
                el.pvAuthor.innerHTML = esc(f.author) + (f.authorId ? ' <em>@' + esc(f.authorId) + '</em>' : '');
                el.pvAuthorRow.href = f.pageUrl || '#';
            }
        }
        if (el.pvOpenTop) {
            if (f.pageUrl) { el.pvOpenTop.href = f.pageUrl; el.pvOpenTop.classList.remove('hidden'); }
            else { el.pvOpenTop.classList.add('hidden'); }
        }

        if (f.width && f.height) { setTxt('st1v', f.width + '×' + f.height); }
        setTxt('st2v', fmt(f.size));
        /* 下载时间拆两行：主值只放日期（14px 等宽 10 字符稳稳放进格子），
         * 具体时刻并进标签行——「2026-11-10 00:27」整串塞一格必然破格（苏哥 2026-11-10） */
        var dparts = String(f.savedAt || '').split(' ');
        setTxt('st3v', dparts[0] || '—');
        setTxt('st3k', '下载时间' + (dparts[1] ? ' · ' + dparts[1] : ''));
        if (el.pvThirdRow) {
            var showThird = (f.kind === 'video' || f.kind === 'anim' || f.kind === 'audio');
            el.pvThirdRow.classList.toggle('hidden', !showThird);
            if (showThird) {
                el.pvThirdK.innerHTML = '<svg class="k-ico"><use href="#i-clock"/></svg>' + (f.kind === 'anim' ? '帧数' : '时长');
                setTxt('pvThirdV', f.kind === 'anim' ? (f.frames ? f.frames + ' 帧' : '—') : (f.dur || '—'));
            }
        }
        setTxt('pvSaved', f.savedAt || '—');
        setTxt('pvPath', f.relPath);
        /* 存储指纹与引用：去重是这个库的护城河，但此前详情页完全看不到。
         * sha256/isRef 数据层早就有，这里只补渲染，不改写入语义。 */
        var hash = String(f.sha256 || '');
        if (el.pvHashRow) { el.pvHashRow.classList.toggle('hidden', !hash); }
        if (el.pvHashVal) {
            el.pvHashVal.textContent = hash ? hash.slice(0, 12) : '—';
            el.pvHashVal.title = hash || '';
        }
        var peers = [];
        if (hash && root.VRApp && root.VRApp.getFiles) {
            try {
                peers = root.VRApp.getFiles().filter(function (x) { return x.sha256 === hash; });
            } catch (e) { peers = []; }
        }
        var refs = peers.length > 1 ? peers.length - 1 : 0;
        if (el.pvRefVal) {
            el.pvRefVal.textContent = hash
                ? (refs ? (refs + ' 条同内容引用（物理只存一份）') : '无同内容副本')
                : '—';
        }
        if (el.pvRefFold) {
            el.pvRefFold.classList.toggle('hidden', !refs);
            setTxt('pvRefCount', refs);
            if (el.pvRefItems) {
                var others = peers.filter(function (x) { return x.relPath !== f.relPath; });
                el.pvRefItems.innerHTML = others.map(function (x) {
                    var pp = { dot: dotOf(x.plat) };
                    return '<button class="pv-ref-item" data-rel="' + esc(x.relPath) + '">' +
                        '<span class="ri-plat" style="--pc:' + pp.dot + '">' + esc(platLabel(x.plat)) + '</span>' +
                        '<span class="ri-title">' + esc(x._title || x.title || x.relPath) + '</span>' +
                        '<span class="ri-go">打开</span></button>';
                }).join('');
            }
        }
        show('pvStateRow', f.state === 'missing');
        setTxt('pvState', f.state === 'missing' ? '文件缺失' : '正常');

        var hasPage = !!f.pageUrl;
        /* 下载记录入库时只写 sourceUrl（直链），预览层原本只认 mediaUrl，
         * 于是「直链」永远空着。这里做字段兜底，不改数据层。 */
        var mediaUrl = f.mediaUrl || f.sourceUrl || '';
        /* 离屏下载落盘的是 blob: URL，不是可回溯的网页直链，
         * 显示出来只会是一串没意义的乱码。 */
        if (/^(blob:|data:|file:)/i.test(mediaUrl)) { mediaUrl = ''; }
        var hasMedia = !!mediaUrl;
        /* 「未记录」提示只在原帖与直链**都缺**时出现；
         * 文案按实际情况区分，不能一律写「原帖与直链未记录」——
         * 有直链没原帖时那句话是错的（2026-11-06 截图反馈）。 */
        var noSource = !hasPage && !hasMedia;
        show('pvSrcMiss', noSource);
        if (noSource) {
            setTxt('pvSrcMissText', '历史素材：原帖与直链均未记录');
        }
        if (el.pvPageRow) {
            el.pvPageRow.classList.toggle('hidden', !hasPage);
            if (hasPage) { el.pvPageRow.href = f.pageUrl; setTxt('pvPageVal', f.pageUrl); }
        }
        /* 直链：CDN 地址带签名会过期，UI 上明确提示，回溯请用原帖 */
        if (el.pvMediaRow) {
            el.pvMediaRow.classList.toggle('hidden', !hasMedia);
            if (hasMedia) { setTxt('pvMediaVal', mediaUrl); }
        }
        var copyBtn = document.getElementById('pvCopyBtn');
        if (copyBtn) { copyBtn.classList.toggle('hidden', !hasMedia); }
        var warn = document.getElementById('pvExpireWarn');
        if (warn) { warn.classList.toggle('hidden', !hasMedia); }
        if (el.pvSrcBadge) {
            /* 四态徽标：完整 / 部分 / 未记录。
               不能把「有直链没原帖」显示成已记录——直链会过期，回溯靠原帖。 */
            var state = (hasPage && hasMedia) ? 'full' : (hasPage || hasMedia) ? 'part' : 'none';
            var txt = state === 'full' ? '已记录' : (state === 'part' ? '部分记录' : '未记录');
            el.pvSrcBadge.className = 'pi-badge' + (state === 'part' ? ' warn' : (state === 'none' ? ' none' : ''));
            el.pvSrcBadge.innerHTML = (state === 'full'
                ? '<svg class="i"><use href="#i-circle-check"/></svg>' : '') + txt;
        }
        setTxt('pvWorkId', f.workId || '—');

        if (el.pvTags) {
            el.pvTags.innerHTML = (f.tags && f.tags.length)
                ? f.tags.map(function (t, i) {
                    return '<span class="pv-tag">' + esc(t) +
                        '<button data-ti="' + i + '" aria-label="移除标签"><svg class="i" style="width:10px;height:10px"><use href="#i-x"/></svg></button></span>';
                }).join('')
                : '';   /* 空态不写「还没有标签」，+ 添加 按钮本身就是入口 */
        }
        hideEmptyFields(!hasPage && !hasMedia);
        /* 同作者区必须在 paintInfo 里刷新（有 f），不能放进 hideEmptyFields
         * —— 那里没有参数 f，会直接 ReferenceError（2026-11-13 真机踩到）。 */
        paintPeers(f);
        /* 切换素材时刷新「已有标签」候选：刚加过的标签要从候选里消失，
         * 换到另一条素材时它自己的标签也要排除掉。 */
        if (tagPickRefresh) {
            try { tagPickRefresh(); } catch (e) { /* 候选刷新失败不影响信息栏 */ }
        }
    }

    /** 右栏只显示真实有值的字段：空 / — / - 一律收起，避免整片「没记录」占位 */
    function hideEmptyFields(noSource) {
        var info = document.querySelector('.pv-info');
        if (!info) { return; }
        info.querySelectorAll('.pi-item').forEach(function (row) {
            /* 状态行由 paintInfo 按 missing 判定，别在这里按文本覆盖回来 */
            if (row.id === 'pvStateRow') { return; }
            /* 「未记录」提示行的可见性完全由 paintInfo 决定：
             * 它的文案是固定的非空文本，这里按文本判断会把它强行打开，
             * 导致「有直链」时也显示「原帖与直链未记录」（2026-11-06 截图反馈）。 */
            if (row.id === 'pvSrcMiss') { return; }
            var dd = row.querySelector('dd');
            if (!dd) { return; }
            var t = String(dd.textContent || '').trim();
            row.classList.toggle('hidden', !t || t === '—' || t === '-');
        });
        var more = info.querySelector('.pi-more');
        if (more) {
            var n = Number(String((el.pvMoreCount || {}).textContent || '0').replace(/\D/g, '')) || 0;
            more.classList.toggle('hidden', n <= 0);
        }
        /* 折叠区里一行有效数据都没有，就别留一个空入口 */
        info.querySelectorAll('.pi-fold').forEach(function (fold) {
            var rows = fold.querySelectorAll('.pi-item');
            var visible = 0;
            rows.forEach(function (r) { if (!r.classList.contains('hidden')) { visible++; } });
            fold.classList.toggle('hidden', visible === 0);
        });
        /* 顶部已有「? 快捷键」按钮，底部这行是重复提示 */
        var foot = info.querySelector('.pi-foot');
        if (foot) { foot.classList.add('hidden'); }
        /* 原帖和直链都没有有效记录时，整组「来源」收起，
         * 不再留「未记录 / 历史素材」这类空占位 */
        var srcGroup = document.getElementById('pvSrcGroup');
        if (srcGroup) { srcGroup.classList.toggle('hidden', !!noSource); }
        if (noSource && el.pvSrcMiss) { el.pvSrcMiss.classList.add('hidden'); }
    }

    /* ---------------- 同作者区（2026-11-13 苏哥需求） ----------------
     * 诉求原话：「只想看同一个博主的，现在都是一个平台的混在一起；点博主名字会跳回原站，
     * 但我只想看同一个博主的循环播放就没办法了」。
     *
     * 做法：详情页就把「同作者」的条目列出来并可直接切换；
     * 另给一个「只看此人 · 循环播放」按钮 —— 把预览队列收窄成该作者的全部素材并开连播。
     * 不跳站、不改筛选状态，纯本地行为。 */
    var peerUrls = [];
    function peersOf(f) {
        if (!f) { return []; }
        var who = String(f.author || '').trim();
        var uid = String(f.authorId || '').trim();
        if (!who && !uid) { return []; }
        var all = [];
        if (root.VRApp && root.VRApp.getFiles) {
            try { all = root.VRApp.getFiles() || []; } catch (e) { all = []; }
        }
        /* 「同一个博主」的判定：优先 authorId（X 的 handle / 微博的 uid，全局唯一），
         * 没有 id 才退回昵称比对。只按昵称会把不同平台的同名博主混进来
         * （苏哥要的正是「只看这一个博主」，混人就违背初衷）。 */
        return all.filter(function (x) {
            if (x.relPath === f.relPath) { return false; }
            if (uid) { return String(x.authorId || '').trim() === uid; }
            return String(x.author || '').trim() === who;
        });
    }

    function paintPeers(f) {
        var grid = el.pvMoreGrid;
        var host = grid && grid.closest ? grid.closest('.pi-more') : null;
        if (!grid) { return; }
        peerUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } });
        peerUrls = [];
        var peers = peersOf(f);
        if (el.pvMoreCount) { el.pvMoreCount.textContent = String(peers.length); }
        if (host) { host.classList.toggle('hidden', peers.length === 0); }
        if (!peers.length) { grid.innerHTML = ''; return; }

        /* 最多展示 24 个，避免右栏被同作者刷屏；「查看全部」走原路径（按作者筛全库） */
        grid.innerHTML = peers.slice(0, 24).map(function (p) {
            return '<button class="pi-more-item" type="button" data-peers="' + esc(p.relPath) + '" ' +
                'title="' + esc(p._title || p.title || p.relPath) + '">' +
                '<span class="cover" data-rel="' + esc(p.relPath) + '"></span></button>';
        }).join('');

        /* 「只看此人 · 循环播放」：把队列换成该博主全部素材并开连播 */
        var head = host ? host.querySelector('.pi-more-head') : null;
        if (head && !head.querySelector('.pv-peer-loop')) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'pv-peer-loop';
            b.textContent = '只看此人 · 循环播放';
            b.title = '播放队列只保留该作者的素材，并开启连播';
            b.addEventListener('click', function () {
                var cur = S.list[S.idx];
                var mine = peersOf(cur).concat([cur]);
                /* 保持库内原顺序（按下载时间等既有排序），不要打乱 —— 用户认的是习惯顺序 */
                var order = {};
                var all = [];
                try { all = root.VRApp.getFiles() || []; } catch (e) { all = []; }
                all.forEach(function (x, i) { order[x.relPath] = i; });
                mine.sort(function (a, b2) { return (order[a.relPath] || 0) - (order[b2.relPath] || 0); });
                if (mine.length < 2) { return; }
                S.list = mine;
                S.idx = 0;
                for (var i = 0; i < mine.length; i++) {
                    if (mine[i].relPath === cur.relPath) { S.idx = i; break; }
                }
                S.auto = true;
                var ab = document.getElementById('autoBtn');
                if (ab) { ab.classList.add('on'); ab.setAttribute('aria-pressed', 'true'); }
                render();
            });
            head.appendChild(b);
        }

        if (!root.VRDB || !root.VRDB.getThumb) { return; }
        grid.querySelectorAll('.cover[data-rel]').forEach(function (node) {
            root.VRDB.getThumb('t:' + node.getAttribute('data-rel')).then(function (t) {
                if (!t || !t.blob || !node.isConnected) { return; }
                var u = URL.createObjectURL(t.blob);
                peerUrls.push(u);
                node.style.backgroundImage = 'url(' + u + ')';
            }).catch(function () { /* 无缓存保留底色 */ });
        });
    }

    var filmUrls = [];
    function paintFilm() {
        if (!el.pvFilm) { return; }
        filmUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } });
        filmUrls = [];
        // 原型（media-library-stage-v1.html 3226 行）：96×66 的编号缩略图按钮。
        // cover 显示真实抽帧缓存，fno 只留编号角标；原来是「一排只有数字的空按钮」。
        el.pvFilm.innerHTML = S.list.map(function (f, i) {
            return '<button class="film' + (i === S.idx ? ' on' : '') + '" data-i="' + i + '" title="' + esc(f._title || f.title) + '">' +
                '<span class="cover" data-rel="' + esc(f.relPath) + '"></span>' +
                '<span class="fno">' + (i + 1) + '</span></button>';
        }).join('');
        if (!root.VRDB || !root.VRDB.getThumb) { return; }
        el.pvFilm.querySelectorAll('.cover[data-rel]').forEach(function (node) {
            root.VRDB.getThumb('t:' + node.getAttribute('data-rel')).then(function (t) {
                if (!t || !t.blob || !node.isConnected) { return; }
                var u = URL.createObjectURL(t.blob);
                filmUrls.push(u);
                node.style.backgroundImage = 'url(' + u + ')';
            }).catch(function () { /* 无缓存保留渐变底 */ });
        });
    }

    function open(f, list) {
        if (!f) { return; }
        var arr = (list && list.length) ? list : [f];
        var i = -1;
        for (var k = 0; k < arr.length; k++) { if (arr[k].id === f.id) { i = k; break; } }
        S.list = arr; S.idx = i < 0 ? 0 : i;
        cache();
        if (!el.preview) { return; }
        el.preview.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        render();
    }

    function render() {
        var f = S.list[S.idx];
        if (!f) { return; }
        if (lastShown && lastShown !== f) { releaseUrl(lastShown); }
        lastShown = f;
        renderStage(f);
        paintInfo(f);
        paintFilm();
        /* 没有绝对路径（自选文件夹）→ 用句柄解析出 Blob URL 后再画一次 */
        if (!f.absPath && !f._fileUrl && root.VRFile) {
            root.VRFile.resolve(f).then(function (r) {
                if (!r || !r.url) { return; }
                if (S.list[S.idx] !== f) { if (r.revoke) { r.revoke(); } return; }
                f._fileUrl = r.url;
                f._revokeUrl = r.revoke || null;
                renderStage(f);
            }).catch(function () { /* 保留「没有本地路径」提示 */ });
        }
    }

    function close() {
        if (el.preview) { el.preview.classList.add('hidden'); }
        document.body.style.overflow = '';
        destroyPlayer();
        releaseUrl(lastShown);
        lastShown = null;
        var stage = $('#pvMedia'); if (stage) { stage.innerHTML = ''; }
        videoEl = null;
        imgEl = null; imgScale = 1; imgRot = 0; imgBaseW = 0; imgBaseH = 0; imgX = 0; imgY = 0;
        try { if (animCtl) { animCtl.destroy(); } } catch (e) { /* ignore */ }
        animCtl = null;
    }

    function step(d) {
        if (!S.list.length) { return; }
        S.idx = (S.idx + d + S.list.length) % S.list.length;
        render();
    }

    function bind() {
        if (el.pvFav) {
            el.pvFav.addEventListener('click', function () {
                var f = S.list[S.idx];
                if (!f) { return; }
                if (root.VRFav && root.VRFav.addToDefault) {
                    root.VRFav.addToDefault(f.relPath);
                    paintInfo(f);
                }
            });
        }
        if (el.pvStar) {
            el.pvStar.addEventListener('click', async function () {
                var f = S.list[S.idx];
                if (!f) { return; }
                if (root.VRFav && typeof root.VRFav.toggleStar === 'function') {
                    var next = await root.VRFav.toggleStar(f.relPath);
                    f.starred = !!next;
                    paintInfo(f);
                }
            });
        }
        if (el.vPlay) {
            el.vPlay.addEventListener('click', function () {
                if (!videoEl) { return; }
                if (videoEl.paused) { videoEl.play().catch(function () { }); } else { videoEl.pause(); }
            });
        }
        if (el.vProg) {
            el.vProg.addEventListener('click', function (e) {
                if (!videoEl || !videoEl.duration) { return; }
                var r = el.vProg.getBoundingClientRect();
                var p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
                videoEl.currentTime = p * videoEl.duration;
            });
        }
        if (el.vRate) {
            el.vRate.addEventListener('click', function () {
                if (!el.ratePop) { return; }
                el.ratePop.classList.toggle('on');
                buildRates();
            });
        }
        function buildRates() {
            if (!el.rpGrid) { return; }
            var rates = [0.1, 0.2, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
            el.rpGrid.innerHTML = rates.map(function (r) {
                return '<button data-r="' + r + '" class="' + (Math.abs(r - S.rate) < 0.001 ? 'on' : '') + '">' + r + '×</button>';
            }).join('');
        }
        if (el.rpGrid) {
            el.rpGrid.addEventListener('click', function (e) {
                var b = e.target.closest('button'); if (!b) { return; }
                S.rate = Number(b.dataset.r) || 1;
                if (videoEl) { videoEl.playbackRate = S.rate; }
                setTxt('vRate', S.rate + '×');
                if (el.ratePop) { el.ratePop.classList.remove('on'); }
                buildRates();
            });
        }
        /* ---- F6 动图控件条 ---- */
        var gPause = document.getElementById('gPause');
        if (gPause) {
            gPause.addEventListener('click', function () {
                if (!animCtl) { return; }
                animCtl.toggle();
                var u = gPause.querySelector('use');
                if (u) { u.setAttribute('href', animCtl.isPlaying() ? '#i-pause' : '#i-play'); }
            });
        }
        var gLoop = document.getElementById('gLoop');
        if (gLoop) {
            var LOOP_TXT = { infinite: '⟳ 无限', once: '→ 一次', pingpong: '⇄ 往返' };
            var LOOP_SEQ = ['infinite', 'once', 'pingpong'];
            var loopIdx = 0;
            gLoop.addEventListener('click', function () {
                loopIdx = (loopIdx + 1) % LOOP_SEQ.length;
                var m = LOOP_SEQ[loopIdx];
                if (animCtl) { animCtl.setLoop(m); }
                gLoop.textContent = LOOP_TXT[m];
            });
        }
        var gRate = document.getElementById('gRate');
        if (gRate) {
            var RATES = [1, 0.5, 0.25, 2];
            var rateIdx = 0;
            gRate.addEventListener('click', function () {
                rateIdx = (rateIdx + 1) % RATES.length;
                var r = RATES[rateIdx];
                S.rate = r;
                if (animCtl) { animCtl.setRate(r); }
                gRate.textContent = r + '×';
            });
        }

        /* 图片工具栏：缩放 / 旋转 / 适应 / 1:1 */
        var izi = document.getElementById('imgZoomIn');
        if (izi) { izi.addEventListener('click', function () { zoomImg(1.25); }); }
        var izo = document.getElementById('imgZoomOut');
        if (izo) { izo.addEventListener('click', function () { zoomImg(0.8); }); }
        var irt = document.getElementById('imgRotate');
        if (irt) { irt.addEventListener('click', rotateImg); }
        var ift = document.getElementById('imgFit');
        if (ift) { ift.addEventListener('click', fitImg); }
        var iac = document.getElementById('imgActual');
        if (iac) { iac.addEventListener('click', actualImg); }

        if (el.pvPrev) { el.pvPrev.addEventListener('click', function () { step(-1); }); }
        if (el.pvNext) { el.pvNext.addEventListener('click', function () { step(1); }); }
        if (el.pvClose) { el.pvClose.addEventListener('click', close); }
        if (el.pvBack) { el.pvBack.addEventListener('click', close); }
        if (el.pvInfoBtn) {
            el.pvInfoBtn.addEventListener('click', function () {
                S.info = !S.info;
                el.preview.classList.toggle('no-info', !S.info);
                el.pvInfoBtn.classList.toggle('on', S.info);
            });
        }
        if (el.pvFullBtn) {
            el.pvFullBtn.addEventListener('click', function () {
                if (!document.fullscreenElement) { if (el.preview.requestFullscreen) { el.preview.requestFullscreen(); } }
                else if (document.exitFullscreen) { document.exitFullscreen(); }
            });
        }
        if (el.pvFilm) {
            el.pvFilm.addEventListener('click', function (e) {
                var b = e.target.closest('.film'); if (!b) { return; }
                S.idx = Number(b.dataset.i) || 0; render();
            });
        }
        /* 同作者卡片：点击直接切到那条。
         * 它可能不在当前播放队列里（比如从「平台货架」进来，队列只有该平台），
         * 所以找不到就插到当前条后面 —— 而不是把用户原来的队列打乱。 */
        if (el.pvMoreGrid) {
            el.pvMoreGrid.addEventListener('click', function (e) {
                var b = e.target.closest('[data-peers]'); if (!b) { return; }
                var rel = b.getAttribute('data-peers');
                var cur = S.list[S.idx];
                var target = null;
                for (var i = 0; i < S.list.length; i++) {
                    if (S.list[i].relPath === rel) { S.idx = i; render(); return; }
                }
                if (root.VRApp && root.VRApp.getFiles) {
                    try {
                        target = (root.VRApp.getFiles() || []).filter(function (x) {
                            return x.relPath === rel;
                        })[0] || null;
                    } catch (err) { target = null; }
                }
                if (!target) { return; }
                S.list.splice(S.idx + 1, 0, target);
                S.idx += 1;
                render();
            });
        }
        if (el.pvPathCopy) {
            el.pvPathCopy.addEventListener('click', function () {
                var f = S.list[S.idx]; if (!f) { return; }
                navigator.clipboard.writeText(f.relPath).then(function () {
                    if (root.VRApp) { root.VRApp.toast('路径已复制'); }
                }).catch(function () {
                    if (root.VRApp) { root.VRApp.toast('复制失败：窗口没聚焦或没给剪贴板权限'); }
                });
            });
        }
        if (el.pvHashCopy) {
            el.pvHashCopy.addEventListener('click', function () {
                var f = S.list[S.idx]; if (!f || !f.sha256) { return; }
                navigator.clipboard.writeText(f.sha256).then(function () {
                    if (root.VRApp) { root.VRApp.toast('SHA-256 已复制'); }
                }).catch(function () {
                    if (root.VRApp) { root.VRApp.toast('复制失败：窗口没聚焦或没给剪贴板权限'); }
                });
            });
        }
        /* 引用来源：点一条直接跳到那条素材（物理只存一份，但两条来源都该能回看） */
        if (el.pvRefItems) {
            el.pvRefItems.addEventListener('click', function (e) {
                var b = e.target.closest('.pv-ref-item'); if (!b) { return; }
                var rel = b.getAttribute('data-rel');
                var all = [];
                try { all = (root.VRApp && root.VRApp.getFiles) ? root.VRApp.getFiles() : []; } catch (err) { all = []; }
                var t = null;
                for (var i = 0; i < all.length; i++) { if (all[i].relPath === rel) { t = all[i]; break; } }
                if (t) { open(t, all); }
            });
        }

        /* ---- F2 溯源：复制直链（CDN 直链带签名会过期，UI 已标注） ---- */
        var copyMedia = document.getElementById('pvCopyBtn');
        if (copyMedia) {
            copyMedia.addEventListener('click', function () {
                var f = curFile0(); if (!f || !f.mediaUrl) { return; }
                navigator.clipboard.writeText(f.mediaUrl).then(function () {
                    if (root.VRApp) { root.VRApp.toast('直链已复制（可能已过期）'); }
                }).catch(function () {
                    if (root.VRApp) { root.VRApp.toast('复制失败：窗口没聚焦或没给剪贴板权限'); }
                });
            });
        }
        function curFile0() { return S.list[S.idx]; }

        /* ---- 标签（F3）：写回 VRDB 条目，重建索引由 mergeEntry 保住 ---- */
        function curFile() { return S.list[S.idx]; }
        async function saveTags(next) {
            var f = curFile(); if (!f) { return; }
            f.tags = next;
            try { await root.VRDB.patchFile(f.relPath, { tags: next }); } catch (e) { /* 忽略 */ }
            paintInfo(f);
            if (root.VRApp && root.VRApp.reload) { root.VRApp.reload(); }
        }
        if (el.pvTags) {
            el.pvTags.addEventListener('click', function (e) {
                var b = e.target.closest('button[data-ti]'); if (!b) { return; }
                var f = curFile(); if (!f) { return; }
                var i = Number(b.dataset.ti);
                var next = (f.tags || []).slice(); next.splice(i, 1);
                saveTags(next);
            });
        }
        var tagAdd = document.getElementById('pvTagAdd');
        var tagWrap = document.getElementById('pvTagInputWrap');
        var tagInput = document.getElementById('pvTagInput');
        var tagPick = document.getElementById('pvTagPick');
        /* 候选列表状态：items 是当前可见项，idx 是键盘高亮项（-1 = 无） */
        var tagPickItems = [];
        var tagPickIdx = -1;

        /**
         * 汇总全库标签（跨素材去重）。
         * 为什么从全库取：标签是自由文本，没有独立注册表；
         * 只有把所有素材的 tags 并起来，才知道「已经有哪些标签可用」。
         * 小写作为去重 key，显示沿用首次出现的写法（避免 PIXIV / pixiv 并存）。
         */
        function collectAllTags() {
            var all = [];
            try {
                all = (root.VRApp && root.VRApp.getFiles) ? root.VRApp.getFiles() : [];
            } catch (e) { all = []; }
            var map = {};
            (all || []).forEach(function (f) {
                ((f && f.tags) || []).forEach(function (t) {
                    var label = String(t || '').trim();
                    if (!label) { return; }
                    var k = label.toLowerCase();
                    if (!map[k]) { map[k] = { key: k, label: label, count: 0 }; }
                    map[k].count++;
                });
            });
            return Object.keys(map).map(function (k) { return map[k]; });
        }

        /** 渲染候选：排除当前素材已有的标签；按输入过滤；前缀匹配优先 */
        function renderTagPick() {
            if (!tagPick) { return; }
            var open = !!(tagWrap && tagWrap.classList.contains('on'));
            if (!open) { tagPick.hidden = true; tagPickIdx = -1; return; }

            var f = curFile();
            var mine = {};
            ((f && f.tags) || []).forEach(function (t) { mine[String(t).toLowerCase()] = 1; });
            var raw = tagInput ? String(tagInput.value || '').trim() : '';
            var q = raw.toLowerCase();

            var list = collectAllTags().filter(function (t) {
                if (mine[t.key]) { return false; }   // 当前素材已经有，不必再列
                if (q && t.key.indexOf(q) < 0) { return false; }
                return true;
            }).sort(function (a, b) {
                var ap = (q && a.key.indexOf(q) === 0) ? 0 : 1;
                var bp = (q && b.key.indexOf(q) === 0) ? 0 : 1;
                if (ap !== bp) { return ap - bp; }
                if (b.count !== a.count) { return b.count - a.count; }
                return a.label.localeCompare(b.label, 'zh');
            });

            tagPickItems = list.slice(0, 40);
            if (tagPickIdx >= tagPickItems.length) { tagPickIdx = -1; }

            if (!tagPickItems.length) {
                tagPick.innerHTML = q
                    ? '<span class="none">没有匹配的已有标签，回车新建「' + esc(raw) + '」</span>'
                    : '<span class="none">还没有其它标签，直接输入回车即可新建</span>';
                tagPick.hidden = false;
                return;
            }
            tagPick.innerHTML = tagPickItems.map(function (t, i) {
                return '<button type="button" class="pick' + (i === tagPickIdx ? ' on' : '') +
                    '" data-pick="' + i + '" title="点一下加这个标签">' +
                    '<span>#' + esc(t.label) + '</span>' +
                    '<span class="n">' + t.count + '</span></button>';
            }).join('');
            tagPick.hidden = false;
        }

        /** 把标签加到当前素材；label 为空表示取消 */
        async function addTagValue(label) {
            var f = curFile();
            var v = String(label || '').trim();
            if (!f || !v) { return; }
            /* 大小写归一：库里已有「Pixiv」时，输入 pixiv 不新建重复项 */
            var same = collectAllTags().filter(function (t) { return t.key === v.toLowerCase(); })[0];
            var finalLabel = same ? same.label : v;
            var next = (f.tags || []).slice();
            if (next.indexOf(finalLabel) < 0) { next.push(finalLabel); }
            if (tagInput) { tagInput.value = ''; }
            tagPickIdx = -1;
            if (tagWrap) { tagWrap.classList.remove('on'); }
            if (tagPick) { tagPick.hidden = true; }
            await saveTags(next);
        }

        async function addTag() {
            if (!tagInput) { return; }
            await addTagValue(tagInput.value);
        }

        /* 切换素材后由 paintInfo 调这里，保证候选跟着当前条目走 */
        tagPickRefresh = renderTagPick;

        if (tagPick) {
            tagPick.addEventListener('click', function (e) {
                var b = e.target.closest('[data-pick]');
                if (!b) { return; }
                var it = tagPickItems[Number(b.getAttribute('data-pick'))];
                if (it) { addTagValue(it.label); }
            });
        }

        if (tagAdd) {
            tagAdd.addEventListener('click', function () {
                if (tagWrap) { tagWrap.classList.add('on'); }
                if (tagInput) { tagInput.focus(); }
                tagPickIdx = -1;
                renderTagPick();
            });
        }
        var tagSave = document.getElementById('pvTagSave');
        if (tagSave) { tagSave.addEventListener('click', addTag); }
        if (tagInput) {
            tagInput.addEventListener('input', function () {
                tagPickIdx = -1;
                renderTagPick();
            });
            tagInput.addEventListener('focus', function () { renderTagPick(); });
            tagInput.addEventListener('keydown', function (e) {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    if (!tagPickItems.length) { return; }
                    e.preventDefault();
                    var stepN = e.key === 'ArrowDown' ? 1 : -1;
                    var n = tagPickItems.length;
                    tagPickIdx = (tagPickIdx + stepN + n) % n;
                    renderTagPick();
                    return;
                }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    /* 用上下键选中的候选优先；否则按输入框文本新建 */
                    if (tagPickIdx >= 0 && tagPickItems[tagPickIdx]) {
                        addTagValue(tagPickItems[tagPickIdx].label);
                    } else {
                        addTag();
                    }
                    return;
                }
                if (e.key === 'Escape') {
                    if (tagPickIdx >= 0) { tagPickIdx = -1; renderTagPick(); return; }
                    if (tagWrap) { tagWrap.classList.remove('on'); }
                    renderTagPick();
                }
            });
        }

        document.addEventListener('keydown', function (e) {
            if (!el.preview || el.preview.classList.contains('hidden')) { return; }
            var tag = (document.activeElement && document.activeElement.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA') { return; }
            if (e.key === 'Escape') { close(); }
            /* 上下 = 上一个/下一个素材；左右 = 进度 ±5 秒（用户 2026-11-05 拍板） */
            else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
            else if (e.key === 'ArrowLeft') { if (videoEl) { e.preventDefault(); seekBy(-5); } }
            else if (e.key === 'ArrowRight') { if (videoEl) { e.preventDefault(); seekBy(5); } }
            else if (e.key === 'i' || e.key === 'I') { if (el.pvInfoBtn) { el.pvInfoBtn.click(); } }
            else if (e.key === 'f' || e.key === 'F') { if (el.pvFullBtn) { el.pvFullBtn.click(); } }
            else if (e.key === ' ' && videoEl) { e.preventDefault(); if (videoEl.paused) { videoEl.play(); } else { videoEl.pause(); } }
            else if (e.key === ' ' && animCtl) {
                e.preventDefault();
                var gp = document.getElementById('gPause');
                if (gp) { gp.click(); } else { animCtl.toggle(); }
            }
            else if ((e.key === '+' || e.key === '=') && imgEl) { e.preventDefault(); zoomImg(1.25); }
            else if (e.key === '-' && imgEl) { e.preventDefault(); zoomImg(0.8); }
            else if (e.key === '0' && imgEl) { e.preventDefault(); fitImg(); }
            else if (e.key === '1' && imgEl) { e.preventDefault(); actualImg(); }
            else if ((e.key === 'r' || e.key === 'R') && imgEl) { e.preventDefault(); rotateImg(); }
            else if ((e.key === ',' || e.key === '.') && animCtl) {
                e.preventDefault();
                animCtl.pause();
                animCtl.seek(animCtl.frame() - 1 + (e.key === '.' ? 1 : -1));
                setTxt('gNo', animCtl.frame());
            }
            else if ((e.key === 'l' || e.key === 'L') && animCtl) {
                e.preventDefault();
                var gl = document.getElementById('gLoop');
                if (gl) { gl.click(); }
            }
            else if (e.key === '0' && animCtl) { e.preventDefault(); animCtl.seek(0); setTxt('gNo', 1); }
            else if ((e.key === 'k' || e.key === 'K') && videoEl) {
                e.preventDefault();
                if (videoEl.paused) { videoEl.play().catch(function () { }); } else { videoEl.pause(); }
            }
            else if ((e.key === 'm' || e.key === 'M') && videoEl) {
                e.preventDefault();
                videoEl.muted = !videoEl.muted;
            }
            else if ((e.key === '-' || e.key === '=') && videoEl) {
                e.preventDefault();
                videoEl.volume = Math.max(0, Math.min(1, (videoEl.volume || 1) + (e.key === '=' ? 0.05 : -0.05)));
            }
            else if ((e.key === '>' || e.key === '<') && videoEl) {
                e.preventDefault();
                var rates = [0.1, 0.2, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
                var ri = 5;
                for (var ri2 = 0; ri2 < rates.length; ri2++) { if (Math.abs(rates[ri2] - S.rate) < 0.001) { ri = ri2; break; } }
                ri = Math.max(0, Math.min(rates.length - 1, ri + (e.key === '>' ? 1 : -1)));
                S.rate = rates[ri];
                videoEl.playbackRate = S.rate;
                setTxt('vRate', S.rate + '×');
                buildRates();
            }
            else if ((e.key === ',' || e.key === '.') && videoEl && videoEl.paused) {
                e.preventDefault();
                videoEl.currentTime = Math.max(0, Math.min(videoEl.duration || 0,
                    (videoEl.currentTime || 0) + (e.key === '.' ? 1 : -1) / 30));
            }
            else if (/^[0-9]$/.test(e.key) && videoEl && isFinite(videoEl.duration)) {
                e.preventDefault();
                videoEl.currentTime = videoEl.duration * (Number(e.key) / 10);
            }
            else if ((e.key === 'p' || e.key === 'P') && videoEl && document.pictureInPictureEnabled &&
                     videoEl.requestPictureInPicture) {
                e.preventDefault();
                videoEl.requestPictureInPicture().catch(function () { });
            }
        });

        /* 滚轮：上下切上一个/下一个，左右（或 Shift+滚轮）调进度。
         * 原实现根本没绑预览层的 wheel，autoBtn 却写着「滚轮可切换」；
         * 这里与原型 3371 行的 deltaY→goNext/goPrev 语义一致并补齐横向。 */
        var wheelLock = 0;
        if (el.preview) {
            el.preview.addEventListener('wheel', function (e) {
                if (el.preview.classList.contains('hidden')) { return; }
                /* 图片：普通滚轮和视频/GIF 一样切上一张/下一张；
                 * Ctrl/⌘ + 滚轮才缩放（避免用户想翻图却误放大）。 */
                if (imgEl && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    zoomImg(e.deltaY < 0 ? 1.12 : 0.89);
                    return;
                }
                var horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;
                if (horizontal) {
                    if (!videoEl || !isFinite(videoEl.duration)) { return; }
                    e.preventDefault();
                    seekBy((e.deltaX || e.deltaY) > 0 ? 5 : -5);
                    return;
                }
                if (!e.deltaY) { return; }
                e.preventDefault();
                var now = Date.now();
                if (now < wheelLock) { return; }
                wheelLock = now + 350;
                step(e.deltaY > 0 ? 1 : -1);
            }, { passive: false });
        }
        /* 图片拖拽平移 / 双击切换适应↔实际像素 */
        var imgStage = el.pvMedia || document.getElementById('pvMedia');
        if (imgStage) {
            var drag = null;
            imgStage.addEventListener('pointerdown', function (e) {
                if (!imgEl || e.button !== 0) { return; }
                drag = { x: e.clientX, y: e.clientY, ox: imgX, oy: imgY };
                try { imgStage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
                imgStage.style.cursor = 'grabbing';
            });
            imgStage.addEventListener('pointermove', function (e) {
                if (!drag || !imgEl) { return; }
                imgX = drag.ox + (e.clientX - drag.x);
                imgY = drag.oy + (e.clientY - drag.y);
                applyImgView();
            });
            function endImgDrag() {
                drag = null;
                imgStage.style.cursor = imgEl ? 'grab' : '';
            }
            imgStage.addEventListener('pointerup', endImgDrag);
            imgStage.addEventListener('pointercancel', endImgDrag);
            imgStage.addEventListener('dblclick', function (e) {
                if (!imgEl) { return; }
                e.preventDefault();
                if (imgScale > 1.05) { fitImg(); } else { actualImg(); }
            });
        }

        window.addEventListener('resize', fitPlayer);
    }

    function init() {
        cache();
        if (!el.preview) { return; }
        bind();
    }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }

    root.VRPreview = {
        open: open,
        close: close,
        /* 当前正在看的素材（供库页的「重命名/删除/同作者」按钮使用） */
        current: function () { return S.list[S.idx] || null; },
        setAuto: function (v) { S.auto = !!v; },
        isAuto: function () { return !!S.auto; }
    };
})();
