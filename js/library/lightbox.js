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

    function cache() {
        ['preview', 'pvCrumb', 'pvCount', 'pvTitle', 'pvPlat', 'pvType', 'pvMedia',
            'pvPrev', 'pvNext', 'pvClose', 'pvBack', 'pvInfoBtn', 'pvFullBtn', 'pvFilm',
            'pvAuthorRow', 'pvAvatar', 'pvAuthor', 'pvOpenTop', 'pvStateRow', 'pvState',
            'st1v', 'st2v', 'st3v', 'pvThirdRow', 'pvThirdK', 'pvThirdV',
            'pvSaved', 'pvPath', 'pvPathCopy', 'pvSrcBadge', 'pvPageRow', 'pvPageVal',
            'pvSrcMiss', 'pvWorkId', 'pvTags',
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
        stage.innerHTML = '';
        videoEl = null;
        var url = urlOf(f);
        var kind = f.kind;

        show('vCtl', kind === 'video');
        show('imgBar', kind === 'image');
        show('gifBar', kind === 'anim');

        if (!url) {
            stage.innerHTML = '<div class="viewer-missing">没有本地路径，无法预览（文件可能已移动）</div>';
            return;
        }
        if (kind === 'video') {
            var v = document.createElement('video');
            v.src = url; v.preload = 'metadata'; v.playsInline = true; v.controls = false;
            v.addEventListener('loadedmetadata', function () {
                setTxt('st1v', v.videoWidth + '×' + v.videoHeight);
                setTxt('vDur', fmtDur(v.duration));
            });
            v.addEventListener('timeupdate', function () {
                setTxt('vCur', fmtDur(v.currentTime));
                if (el.vFill && v.duration) { el.vFill.style.width = (v.currentTime / v.duration * 100) + '%'; }
            });
            v.addEventListener('ended', function () { if (S.auto) { step(1); } });
            v.playbackRate = S.rate;
            stage.appendChild(v);
            videoEl = v;
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
                    img0.alt = f.title; img0.src = url;
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
            img.alt = f.title; img.draggable = false;
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
        setTxt('pvTitle', f.title);

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
        var hasMedia = !!f.mediaUrl;
        show('pvSrcMiss', !hasPage && !hasMedia);
        if (el.pvPageRow) {
            el.pvPageRow.classList.toggle('hidden', !hasPage);
            if (hasPage) { el.pvPageRow.href = f.pageUrl; setTxt('pvPageVal', f.pageUrl); }
        }
        /* 直链：CDN 地址带签名会过期，UI 上明确提示，回溯请用原帖 */
        if (el.pvMediaRow) {
            el.pvMediaRow.classList.toggle('hidden', !hasMedia);
            if (hasMedia) { setTxt('pvMediaVal', f.mediaUrl); }
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
                : '<span class="pv-tag empty">还没有标签</span>';
        }
    }

    function paintFilm() {
        if (!el.pvFilm) { return; }
        el.pvFilm.innerHTML = S.list.map(function (f, i) {
            return '<button class="film' + (i === S.idx ? ' on' : '') + '" data-i="' + i + '" title="' + esc(f.title) + '">' +
                esc(String(f.title).slice(0, 16)) + '</button>';
        }).join('');
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
            var rates = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
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
            else if (e.key === 'ArrowLeft') { step(-1); }
            else if (e.key === 'ArrowRight') { step(1); }
            else if (e.key === 'i' || e.key === 'I') { if (el.pvInfoBtn) { el.pvInfoBtn.click(); } }
            else if (e.key === ' ' && videoEl) { e.preventDefault(); if (videoEl.paused) { videoEl.play(); } else { videoEl.pause(); } }
        });
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
