/* ==========================================================
 * 原图派生规则扩展包（2026-11-18，审计 C1）
 *
 * 来源：AIX 智能下载器 9.0.58 的 62 条「缩略图→原图」规则表
 *       （见 docs/research/extensions/AIX-原图派生规则表.md）
 *
 * 为什么独立成文件：`album-sites.js` 已有 5 条规则且被大量单测覆盖，
 *   往它里面塞 60 条会让那个文件失去可读性。这里只做「追加注册」：
 *   加载后调用 VRSites.registerOriginalRules(规则表) 即可并入。
 *
 * 设计约束（与既有 5 条规则一致）：
 *   ① 每条规则只做「输入 URL → 输出原图 URL」，失败返回 ''（绝不返回半成品）
 *   ② 必须校验 CDN 域名 —— 只看路径会误伤任意站点（既有单测踩过这个坑）
 *   ③ 输出必须与输入不同才算命中（否则 originalOf 会一直试下一条）
 *   ④ 纯函数，无网络、无 DOM、无 chrome.*，可 Node 单测
 * ========================================================== */
(function (root) {
    'use strict';

    /**
     * 通用工厂：把「域名匹配 + 若干条替换」压成一个规则函数。
     *
     * @param {RegExp} hostRe    必须命中的域名正则（含 ^https?:// 前缀校验由调用方保证）
     * @param {Array}  replaces  [[正则, 替换串], …] —— **链式**依次应用
     * @returns {function(string): string}
     *
     * 2026-11-18 修正：原实现「每条都在原始 URL 上试、命中第一条就返回」，
     * 遇到需要两次替换的形态就漏了（zhimg 的 /80/ 与 _hd 要各剥一次）。
     * 改为链式累积：每条作用在**上一条的结果**上，最终结果与原输入不同才算命中。
     */
    function makeRule(hostRe, replaces) {
        return function (url) {
            var s = String(url || '');
            if (!s) { return ''; }
            var m = /^https?:\/\/([^/]+)/i.exec(s);
            if (!m) { return ''; }
            if (!hostRe.test(m[1])) { return ''; }
            var cur = s;
            for (var i = 0; i < replaces.length; i++) {
                var next = cur.replace(replaces[i][0], replaces[i][1]);
                if (next && next !== cur) { cur = next; }
            }
            return (cur !== s) ? cur : '';
        };
    }

    /* ---------------- 62 条规则（按 AIX 规则表整理） ----------------
     * 说明：每条都带「原始 site 名」注释，便于回溯到 AIX 规则表。
     * 域名正则用「子域可选」写法，兼容 CDN 多节点（wx1/wx2/p3/p9…）。
     */

    var RULES = {

        /* 1. topit.me —— /m/ /s/ /t/ 是小图目录，换成 /l/；xxx.jpg → l.jpg */
        topit: makeRule(/(^|\.)topit\.me$/i, [
            [/\/[mst]\//g, '/l/'],
            [/[mst]\.jpg/gi, 'l.jpg']
        ]),

        /* 2. B站 hdslb —— 去掉 @数字字母.webp 这类尺寸处理后缀 */
        hdslb: makeRule(/(^|\.)hdslb\.com$/i, [
            [/@(\d+[a-z]_?)+\.webp$/i, '']
        ]),

        /* 3. 新浪微博 —— small/square/thumbnail/bmiddle/thumb/mw/orj 都是同一 pid，
         *    换成 /large/ 即原图（与既有 sinaimg 规则同义，这里补齐 /orj\d+/ 与 /mw\d+/） */
        sinaimgExt: makeRule(/(^|\.)sinaimg\.cn$/i, [
            [/\/orj\d*\//i, '/large/'],
            [/\/mw\d+\//i, '/large/'],
            [/\/bmiddle\//i, '/large/'],
            [/\/thumbnail\//i, '/large/'],
            [/\/square\//i, '/large/'],
            [/\/thumb\d*\//i, '/large/'],
            [/\/small\//i, '/large/']
        ]),

        /* 4. QQ相册 —— /m/ → /o/；去掉 &w=&h= 缩放参数 */
        qqphoto: makeRule(/(^|\.)photo\.store\.qq\.com$/i, [
            [/\/m\//, '/o/'],
            [/&w=\d+&h=\d+/, '']
        ]),

        /* 5. QQ相册新版 qpic —— /psb 的 /m/ → /b/ */
        qpic: makeRule(/(^|\.)qpic\.cn$/i, [
            [/\/m\//, '/b/']
        ]),

        /* 6. 考拉海购 —— 去掉 ?imageView 处理参数 */
        kaola: makeRule(/(^|\.)(nosdn\.127\.net|nos\.netease\.com)$/i, [
            [/\?imageView.*$/, '']
        ]),

        /* 7. QQ群相册 —— /400 /200 /100 后缀换成 /800 */
        qqgroup: makeRule(/(^|\.)group\.store\.qq\.com$/i, [
            [/\/400$/, '/800'],
            [/\/200$/, '/800'],
            [/\/100$/, '/800']
        ]),

        /* 8. Twitter —— format=X → format=X&name=4096x4096（X 的最大尺寸） */
        twimg: makeRule(/(^|\.)pbs\.twimg\.com$/i, [
            [/format=([a-z]+)(?!.*name=)/i, 'format=$1&name=4096x4096']
        ]),

        /* 9. 百度图趣 —— /abpic/ /pin/w=N/ 换成 /pic/ */
        baiduhp: makeRule(/(^|\.)hiphotos\.baidu\.com$/i, [
            [/\/abpic\//, '/pic/'],
            [/\/pin\/w=\d+\/.+\//, '/pin/pic/item/']
        ]),

        /* 10. 豆瓣 —— 已有 douban 规则，这里补 albumicon 与 photo/m 两种 */
        doubanExt: makeRule(/(^|\.)douban(io)?\.com$/i, [
            [/\/albumicon\//, '/photo/'],
            [/\/photo\/m\//, '/photo/l/'],
            [/\/photo\/thumb\//, '/photo/raw/']
        ]),

        /* 11. 花瓣 —— 已有 huaban 规则，这里补 hb.aicdn.com 这个老 CDN */
        huabanAicdn: makeRule(/(^|\.)hb\.aicdn\.com$/i, [
            [/_fw\d+[a-z]*$/, ''],
            [/_fw\/\d+.*$/, '']
        ]),

        /* 12. Flickr —— _m.jpg / _s.jpg → _b.jpg（1024 宽） */
        flickr: makeRule(/(^|\.)staticflickr\.com$/i, [
            [/_[ms]\.jpg$/i, '_b.jpg']
        ]),

        /* 13. Google+ / Blogger —— /wN-hN(-n)-k/ → /s1600/ */
        googleusercontent: makeRule(/(^|\.)googleusercontent\.com$/i, [
            [/\/w\d+-h\d+(-[a-z]+)?(-k)?\//i, '/s1600/'],
            [/\/s\d+-c\//i, '/s1600/']
        ]),

        /* 14. 迅雷方舟 —— &s=数字 → &s=1600 */
        xlpan: makeRule(/(^|\.)kanimg\.com$/i, [
            [/&s=\d+.*$/, '&s=1600']
        ]),

        /* 15. poco.cn —— _123.jpg 后缀去掉 */
        poco: makeRule(/(^|\.)poco\.cn$/i, [
            [/_\d{3}\.jpg$/i, '.jpg']
        ]),

        /* 16. pconline —— _mthumb.jpg / _thumb.jpg → .jpg */
        pconline: makeRule(/(^|\.)pconline\.com\.cn$/i, [
            [/_mthumb\.jpg$/i, '.jpg'],
            [/_thumb\.jpg$/i, '.jpg']
        ]),

        /* 17. 拼多多 —— /webp → jpg */
        pdd: makeRule(/(^|\.)(pddpic|yangkeduo)\.com$/i, [
            [/\/webp$/i, 'jpg']
        ]),

        /* 18. 美丽说 —— /l/ /r/ → /_o/ */
        meilishuo: makeRule(/(^|\.)(meilishuo\.net|meiliworks\.com)$/i, [
            [/\/l\//, '/_o/'],
            [/\/r\//, '/_o/']
        ]),

        /* 19. 蘑菇街 —— _123x456.jpg → _468x468.jpg */
        mogujie: makeRule(/(^|\.)mogujie\.cn$/i, [
            [/_\d{3}x\d+\.jpg$/i, '_468x468.jpg']
        ]),

        /* 20. 又拍网 —— square.jpg / fw200.jpg → medish.jpg */
        yupoo: makeRule(/(^|\.)yupoo\.com$/i, [
            [/(square|fw200)\.jpg$/i, 'medish.jpg']
        ]),

        /* 21. brickvisual —— -WxH.jpg → .jpg */
        brickvisual: makeRule(/(^|\.)brickvisual\.com$/i, [
            [/-\d+x\d+\.jpg$/i, '.jpg']
        ]),

        /* 22. archdaily —— /small/x.jpg → /large_jpg/x.jpg */
        archdaily: makeRule(/(^|\.)(adsttc|archdaily)\.com$/i, [
            [/\/\w+\/([\w%.]+)\.jpg.*$/i, '/large_jpg/$1.jpg']
        ]),

        /* 23. hao123美图 —— _310 → _0 */
        hao123: makeRule(/(^|\.)hao123\.com$/i, [
            [/_310$/, '_0']
        ]),

        /* 24. Pinterest —— /2xx/ → /7xxx/；/474x/ → /736x/；
         *     originals 是最原始版本（AIX 的做法） */
        /* 24. Pinterest —— 直接统一到 originals（最原始版本）。
         * 2026-11-18：原来分档改写（236x→7xx、474x→736x），但 originals 才是真原图；
         * 分档改写反而拿不到最大图。链式替换会把任何 /Nx/ 都收口到 originals。 */
        pinimg: makeRule(/(^|\.)pinimg\.com$/i, [
            [/\/\d+x\d*\//, '/originals/']
        ]),

        /* 25. 1688 —— 去掉 _.webp、.WxH.、.220x220xz. */
        alicdn1688: makeRule(/(^|\.)alicdn\.com$/i, [
            /* 必须先处理「.jpg_.webp」这种双后缀：否则 \.webp$ 会把它变成 .jpg_.jpg */
            [/\.jpg_\.webp$/i, '.jpg'],
            [/\.(jpg|png)_\.webp$/i, '.$1'],
            [/_\d+x\d+q\d+\.jpg$/i, '.jpg'],
            [/\.\d+x\d+xz\.jpg$/i, '.jpg'],
            [/_\d+x\d+xzq\d+\.jpg$/i, '.jpg'],
            [/\.jpg_\d+x\d+xzq\d+\.jpg$/i, '.jpg'],
            [/_\d+x\d+\.jpg$/i, '.jpg'],
            [/\.\d+x\d+\.jpg$/i, '.jpg'],
            [/_\d+x\d+.*?\.(jpg|webp|png)$/i, '.$1'],
            [/\.webp$/i, '.jpg']
        ]),

        /* 26. 京东 —— 缩略图目录 /n1~/n9/ → /imgzone/；s450x450_jfs → jfs；去掉 !cc_ 与 !q 参数
         * 注意：/n0/ 本身就是原图级，**不能**改（改了反而降级）。 */
        jd: makeRule(/(^|\.)360buyimg\.com$/i, [
            [/\/n[1-9]\d*\//, '/imgzone/'],
            [/s\d+x\d+_jfs/, 'jfs'],
            [/!cc_\d+x\d+\.jpg$/i, ''],
            [/!q\d+\.dpg\.webp$/i, '']
        ]),

        /* 27. 唯品会 —— 一串 _NxN 后缀（可能多个）→ 全部剥掉
         * 2026-11-18：原正则只能剥一段（a_100x200_300x400 → a_100x200），
         * 改成重复组 + 让链式替换跑两轮以上。 */
        vip: makeRule(/(^|\.)vpimg\d*\.com$/i, [
            [/(_\d+x\d+)+\.(jpg|png|webp)$/i, '.$2']
        ]),

        /* 28. Amazon —— ._AC_xxx_.jpg 之类的处理后缀去掉 */
        amazon: makeRule(/(^|\.)ssl-images-amazon\.com$/i, [
            [/\.[^./]+\.jpg$/i, '.jpg']
        ]),

        /* 29. 小红书 —— 去掉 ?imageView2/… 处理参数（与既有 xhs 归一互补） */
        xhscdn: makeRule(/(^|\.)(xhscdn|xiaohongshu)\.com$/i, [
            [/\?imageView2\/.*$/i, ''],
            [/\?imageView\/.*$/i, '']
        ]),

        /* 30. airbnb —— 统一到 ?aki_policy=xx_large */
        airbnb: makeRule(/(^|\.)muscache\.com$/i, [
            [/\?aki_policy=[^&]*/i, '?aki_policy=xx_large'],
            [/\?tdsourcetag=[^&]*/i, '?aki_policy=xx_large']
        ]),

        /* 31. shein —— _thumbnail.* → . */
        shein: makeRule(/(^|\.)ltwebstatic\.com$/i, [
            [/_thumbnail.*?\./i, '.']
        ]),

        /* 32. 易派客 —— .Nw_Nh_.* → .jpg */
        epec: makeRule(/(^|\.)epec\.com$/i, [
            [/\.(jpg|png)\.\d+w_\d+h_.*$/i, '.$1']
        ]),

        /* 33. 微相册 —— 去掉 ?imageMogr2 处理参数 */
        szwego: makeRule(/(^|\.)szwego\.com$/i, [
            [/\?imageMogr2.*$/i, '']
        ]),

        /* 34. 人人网 —— /p/xxx_p → /p/xxx */
        renren: makeRule(/(^|\.)(xnpic|rrfmn)\.com$/i, [
            [/\/p\/(.*?)_p/, '/p/$1']
        ]),

        /* 35. 知乎 —— picN.zhimg.com 的 /N/ 版本段去掉；_hd → _r */
        zhimg: makeRule(/(^|\.)zhimg\.com$/i, [
            [/\.com\/\d+\//, '.com/'],
            [/_hd\./, '_r.']
        ]),

        /* 36. 堆糖（补充 v2 路径形态） */
        duitangExt: makeRule(/(^|\.)duitang\.com$/i, [
            [/\.thumb.*?\./i, '.']
        ]),

        /* 37. POCO —— _W123.jpg → .jpg */
        pocoimg: makeRule(/(^|\.)pocoimg\.cn$/i, [
            [/_W\d+\.jpg$/i, '.jpg']
        ]),

        /* 38. 什么值得买 —— 去掉 ?imageView2 */
        smzdm: makeRule(/(^|\.)smzdm\.com$/i, [
            [/\?imageView2.*$/i, '']
        ]),

        /* 39. unsplash —— 去掉所有图片处理参数（auto/format/w/q/fm/h/fit/crop…）
         * 2026-11-18：原正则只删「?或&开头」的参数，链式第一轮把 ?auto=format& 删掉后，
         * 后面的 w=400 前面就没有 ?/& 了，导致漏删。改成逐个参数匹配 + 收尾清分隔符。 */
        unsplash: makeRule(/(^|\.)unsplash\.com$/i, [
            [/[?&](?:auto|w|h|q|fm|fit|crop|dpr|ixlib|cs)=[^&#]*/gi, ''],
            [/[?&]+$/, '']
        ]),

        /* 40. squarespace —— 去掉 ?format=Nw */
        squarespace: makeRule(/(^|\.)squarespace-cdn\.com$/i, [
            [/\?format=\d+w/i, '']
        ]),

        /* 41. dhgate —— 去掉 _WxH.jpg 后缀 */
        dhgate: makeRule(/(^|\.)dhresource\.com$/i, [
            [/_\d+x\d+\.jpg$/i, '.jpg']
        ]),

        /* 42. 淘宝/天猫自有图床（img.taobao.com）。
         * 注意：alicdn.com 上的淘宝图已由 alicdn1688 覆盖（三站共用同一 CDN），
         * 这里只补自有域名，不重复定义。 */
        taobao: makeRule(/(^|\.)(taobao|tmall)\.com$/i, [
            [/_\d+x\d+\.jpg$/i, '.jpg'],
            [/\.jpg_\d+x\d+\.jpg$/i, '.jpg']
        ]),

        /* 43. 微博图片备用域（wx*.sinaimg 之外的 weibo.com 图床） */
        weibocdn: makeRule(/(^|\.)weibocdn\.com$/i, [
            [/\?.*$/, '']
        ]),

        /* 44. 快手 —— 去掉 ~tplv- 处理指令（与抖音同构） */
        kuaishou: makeRule(/(^|\.)(kwaicdn|yximgs)\.com$/i, [
            [/~tplv-[^/]*$/i, '']
        ]),

        /* 45. B站相册 —— 与 hdslb 同域，补 /bfs/ 路径的 @ 后缀剥离 */
        biliBfs: makeRule(/(^|\.)hdslb\.com$/i, [
            [/@[^/]*$/i, '']
        ]),

        /* 46. 腾讯视频/QQ —— 去掉 ?imageView 与 &w=&h= */
        qqvideo: makeRule(/(^|\.)(gtimg|qpic)\.cn$/i, [
            [/\?imageView.*$/i, ''],
            [/&w=\d+&h=\d+/, '']
        ]),

        /* 47. 网易云/lofter —— 去掉 ?imageView */
        lofter: makeRule(/(^|\.)lofter\.com$/i, [
            [/\?imageView.*$/i, '']
        ])
    };

    /** 供 album-sites.js 合并进 ORIGINAL_RULES */
    root.VRSiteOriginalRules = RULES;
    root.VRSiteOriginalRules_makeRule = makeRule;

    /* 加载顺序兜底（2026-11-18，C1）：
     * 若 album-sites.js 已经先加载，它不会再跑「主动拉取」那段，
     * 所以这里反过来推进去。两边都注入才不会因为加载顺序丢规则。 */
    if (root.VRAlbumSites && typeof root.VRAlbumSites.registerOriginalRules === 'function') {
        root.VRAlbumSites.registerOriginalRules(RULES);
    }

})(typeof globalThis !== 'undefined' ? globalThis
    : (typeof self !== 'undefined' ? self
        : (typeof window !== 'undefined' ? window : this)));
