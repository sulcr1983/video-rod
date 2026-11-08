/* ==========================================================
 * VRYtOptions —— YouTube 档位列表的纯逻辑（可 Node 单测）
 *
 * 2026-11-08 抽取。起因：苏哥点下载后静默开始拉 15.66GB（91vZf7QNTpE），
 * 既没让他选、也没法中途停。修好之后「选档」成了主路径，
 * 这段逻辑就必须可测 —— 它在下载页、YouTube 页面各用过一遍，
 * 两份实现一旦漂移，就会出现「显示 4K 却下了 1080p」这类问题。
 *
 * 约定：不碰 chrome.*、不碰 DOM、零依赖。
 * 输出结构供浮层直接渲染：{key, label, size, sizeText, height, badge}
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VRYtOptions = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    var MB = 1048576;
    var GB = 1073741824;

    /**
     * 体积 → 人类可读。
     *
     * 0 / 负数 / 非数字一律返回 '大小未知' —— 不要返回空串：
     * 浮层里留空，用户会以为是 0 或者以为是渲染 bug。
     */
    function sizeText(bytes) {
        var n = Number(bytes);
        if (!isFinite(n) || n <= 0) { return '大小未知'; }
        if (n >= GB) { return (n / GB).toFixed(2) + ' GB'; }
        return Math.round(n / MB) + ' MB';
    }

    /**
     * 高度 → 清晰度标签。
     *
     * 2026-11-08：画质不再过滤后 8K 也会出现在列表里。
     * 原来写死 `h >= 2160 ? '4K'`，会把 4320 也标成 4K，用户分不出高低。
     */
    function qualityLabel(height, fps) {
        var h = Number(height) || 0;
        var s = h >= 4320 ? '8K'
            : h >= 2880 ? '5K'
            : h >= 2160 ? '4K'
            : h >= 1440 ? '2K'
            : h > 0 ? h + 'p'
            : '未知';
        var f = Number(fps) || 0;
        if (f >= 50) { s += Math.round(f); }
        return s;
    }

    /**
     * 由格式信息构造档位列表。
     *
     * @param {object} src
     *   src.video  [{itag,height,fps,size}]
     *   src.audio  {size} 或 null
     *   src.muxed  {itag,height,fps,size} 或 null
     * @returns {Array} 每项 {key,label,size,sizeText,height,badge,kind}
     *
     * 顺序即「从高到低」，浮层按此顺序渲染；最高档带「最高」徽标。
     * 体积 = 视频轨 + 音频轨（用户实际要下的量），muxed/audio 单独算。
     */
    function buildAll(src) {
        var o = src || {};
        var video = Array.isArray(o.video) ? o.video : [];
        var audio = o.audio || null;
        var muxed = o.muxed || null;
        var audioSize = (audio && Number(audio.size)) || 0;
        var out = [];

        video.forEach(function (f, i) {
            if (!f || !f.itag) { return; }
            var total = (Number(f.size) || 0) + audioSize;
            out.push({
                key: 'v' + f.itag,
                label: qualityLabel(f.height, f.fps),
                size: total,
                sizeText: sizeText(total),
                height: Number(f.height) || 0,
                badge: i === 0 ? '最高' : '',
                kind: 'video'
            });
        });

        if (muxed && muxed.itag) {
            var ms = Number(muxed.size) || 0;
            out.push({
                key: 'm' + muxed.itag,
                label: qualityLabel(muxed.height, muxed.fps),
                size: ms,
                sizeText: sizeText(ms),
                height: Number(muxed.height) || 0,
                badge: '免合并',
                kind: 'muxed'
            });
        }

        if (audio) {
            var as = Number(audio.size) || 0;
            out.push({
                key: 'a',
                label: '仅音频',
                size: as,
                sizeText: sizeText(as),
                height: 0,
                badge: '',
                kind: 'audio'
            });
        }

        return out;
    }

    /** 按 key 找下标；找不到返回 -1（调用方据此拒绝，而不是误点第 0 档） */
    function indexOfKey(list, key) {
        var want = String(key || '');
        if (!want || !Array.isArray(list)) { return -1; }
        for (var i = 0; i < list.length; i++) {
            if (list[i] && list[i].key === want) { return i; }
        }
        return -1;
    }

    /**
     * 是否属于「大文件」——只用于给一句提醒，不做拦截。
     * 苏哥明确要求不限制容量，所以这里只返回布尔值供文案使用。
     */
    function isBig(bytes, threshold) {
        var n = Number(bytes) || 0;
        var t = Number(threshold) > 0 ? Number(threshold) : 2 * GB;
        return n > t;
    }

    return {
        MB: MB,
        GB: GB,
        sizeText: sizeText,
        qualityLabel: qualityLabel,
        buildAll: buildAll,
        indexOfKey: indexOfKey,
        isBig: isBig
    };
});