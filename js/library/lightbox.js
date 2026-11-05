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

    var PLAT = {
        x: { label: 'X', dot: '#8FA0B8' }, xiaohongshu: { label: '小红书', dot: '#FF2442' },
        douyin: { label: '抖音', dot: '#25C8D4' }, weibo: { label: '微博', dot: '#E6506D' },
        youtube: { label: 'YouTube', dot: '#FF0000' }, instagram: { label: 'Instagram', dot: '#C13584' },
        bilibili: { label: 'B站', dot: '#FB7299' }, tiktok: { label: 'TikTok', dot: '#25F4EE' },
        web: { label: '网页', dot: '#8B93A1' }
    };
    var KIND_LABEL = { video: '视频', image: '图片', anim: '动图', audio: '音频', other: '其他' };

    var S = { list: [], idx: 0, info: true, auto: true, rate: 1 };
    var el = {};
    var videoEl = null;
    var animCtl = null;

    /* 成熟播放器（Plyr 3.8.3）实例与布局状态 */
    var plyr = null;
    var playerBox = null;
    var playerRatio = 0;
    var posterUrl = '';

    function destroyPlayer() {
        if (plyr) { try { plyr.destroy(); } catch (e) { /* ignore */ } }
        plyr = null;
        if (posterUrl) { try { URL.revokeObjectURL(posterUrl); } catch (e) { /* ignore */ } }
        posterUrl = '';
        playerBox = null;
        playerRatio = 0;
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

    function cache() {
        ['preview', 'pvCrumb', 'pvCount', 'pvTitle', 'pvPlat', 'pvType', 'pvMedia',
            'pvPrev', 'pvNext', 'pvClose', 'pvBack', 'pvInfoBtn', 'pvFullBtn', 'pvFilm',
            'pvAuthorRow', 'pvAvatar', 'pvAuthor', 'pvOpenTop', 'pvStateRow', 'pvState',
            'st1v', 'st2v', 'st3v', 'pvThirdRow', 'pvThirdK', 'pvThirdV',
            'pvSaved', 'pvPath', 'pvPathCopy', 'pvSrcBadge', 'pvPageRow', 'pvPageVal',
            'pvSrcMiss', 'pvWorkId', 'pvTags',
            /* 这几项原先没进 cache：直链行因此永远显示默认「—」，同作者永远 0 项 */
            'pvStageEl', 'pvMediaRow', 'pvMediaVal', 'pvMoreCount', 'pvMoreGrid',
            'vCtl', 'vPlay', 'vCur', 'vDur', 'vProg', 'vFill', 'vRate', 'ratePop', 'rpGrid',
            'imgBar', 'gifBar'].forEach(function (id) { el[id] = document.getElementById(id); });
    }

    function urlOf(f) {
        if (!f || !f.absPath || !root.VRPath) { return ''; }
        try { return root.VRPath.toFileUrl(f.absPath); } catch (e) { return ''; }
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
        videoEl = null;
        var url = urlOf(f);
        var kind = f.kind;

        /* CSS 里 .pv-stage.is-video .fakeMedia 才铺满舞台。
         * 这个 class 之前从来没人加过 → 视频一直被锁在 62% 宽的 16:9 小框里，
         * 四周留大片空白（用户 2026-11-05 截图反馈）。 */
        var stageOuter = el.pvStageEl || document.getElementById('pvStageEl');
        if (stageOuter) {
            stageOuter.classList.toggle('is-video', kind === 'video');
            stageOuter.classList.toggle('is-gif', kind === 'anim');
        }

        /* 有成熟播放器时让自绘控件条让位；Plyr 没加载成功则保留原控件条降级 */
        show('vCtl', kind === 'video' && !root.Plyr);
        show('imgBar', kind === 'image');
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
                        controls: ['play-large', 'play', 'progress', 'current-time',
                                   'mute', 'volume', 'settings', 'pip', 'fullscreen'],
                        settings: ['speed'],
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
                    });
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
        } else if (kind === 'image' || kind === 'anim') {
            var img = document.createElement('img');
            img.alt = f._title || f.title; img.draggable = false;
            img.addEventListener('load', function () { setTxt('st1v', img.naturalWidth + '×' + img.naturalHeight); });
            img.src = url;
            stage.appendChild(img);
            setTxt('st1v', '—');
        } else {
            var a = document.createElement('audio');
            a.src = url; a.controls = true;
            stage.appendChild(a);
            a.play().catch(function () { });
            setTxt('st1v', '—');
        }
    }

    function paintInfo(f) {
        var p = PLAT[f.plat] || PLAT.web;
        if (el.pvCrumb) { el.pvCrumb.innerHTML = '<b>' + esc(p.label) + '</b> / ' + esc(f.author || '未分类'); }
        setTxt('pvCount', (S.idx + 1) + ' / ' + S.list.length);
        setTxt('pvType', (KIND_LABEL[f.kind] || '媒体').toUpperCase());
        setTxt('pvTitle', f._title || f.title);

        if (el.pvPlat) {
            el.pvPlat.innerHTML = '<i class="dot" style="--pc:' + p.dot + '"></i>' + esc(p.label) + ' · ' + (KIND_LABEL[f.kind] || '');
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
        setTxt('st3v', f.savedAt || '—');
        if (el.pvThirdRow) {
            var showThird = (f.kind === 'video' || f.kind === 'anim');
            el.pvThirdRow.classList.toggle('hidden', !showThird);
            if (showThird) {
                el.pvThirdK.innerHTML = '<svg class="k-ico"><use href="#i-clock"/></svg>' + (f.kind === 'video' ? '时长' : '帧数');
                setTxt('pvThirdV', f.kind === 'video' ? (f.dur || '—') : (f.frames ? f.frames + ' 帧' : '—'));
            }
        }
        setTxt('pvSaved', f.savedAt || '—');
        setTxt('pvPath', f.relPath);
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
        show('pvSrcMiss', !hasPage && !hasMedia);
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
    }

    /** 右栏只显示真实有值的字段：空 / — / - 一律收起，避免整片「没记录」占位 */
    function hideEmptyFields(noSource) {
        var info = document.querySelector('.pv-info');
        if (!info) { return; }
        info.querySelectorAll('.pi-item').forEach(function (row) {
            /* 状态行由 paintInfo 按 missing 判定，别在这里按文本覆盖回来 */
            if (row.id === 'pvStateRow') { return; }
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
        renderStage(f);
        paintInfo(f);
        paintFilm();
    }

    function close() {
        if (el.preview) { el.preview.classList.add('hidden'); }
        document.body.style.overflow = '';
        destroyPlayer();
        var stage = $('#pvMedia'); if (stage) { stage.innerHTML = ''; }
        videoEl = null;
        try { if (animCtl) { animCtl.destroy(); } } catch (e) { /* ignore */ }
        animCtl = null;
    }

    function step(d) {
        if (!S.list.length) { return; }
        S.idx = (S.idx + d + S.list.length) % S.list.length;
        render();
    }

    function bind() {
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
        if (tagAdd) {
            tagAdd.addEventListener('click', function () {
                if (tagWrap) { tagWrap.classList.add('on'); }
                if (tagInput) { tagInput.focus(); }
            });
        }
        async function addTag() {
            var f = curFile(); if (!f || !tagInput) { return; }
            var v = String(tagInput.value || '').trim();
            if (!v) { return; }
            var next = (f.tags || []).slice();
            if (next.indexOf(v) < 0) { next.push(v); }
            tagInput.value = '';
            if (tagWrap) { tagWrap.classList.remove('on'); }
            await saveTags(next);
        }
        var tagSave = document.getElementById('pvTagSave');
        if (tagSave) { tagSave.addEventListener('click', addTag); }
        if (tagInput) {
            tagInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); addTag(); }
                if (e.key === 'Escape' && tagWrap) { tagWrap.classList.remove('on'); }
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
            else if (e.key === ' ' && animCtl) { e.preventDefault(); animCtl.toggle(); }
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
