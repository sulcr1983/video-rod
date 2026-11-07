/* ==========================================================
 * VRSiteNamesPreset —— 预置站点名称表
 *
 * 为什么需要它（而不是全靠自动提取）：
 *   1. 资源库重扫只读文件系统、没有 DOM，自动提取补不回来；
 *   2. 自动提取给出的名字常不适合做目录（B站给 "bilibili"、抖音给小写拼音）；
 *   3. 拷贝进来的旧文件夹从未在本机打开过，学习流程永远触发不了。
 * 定位：**校正 + 首装即正确**，不是「决定谁能进来」。
 *   未收录站点照样能下载，首次靠自动提取（见 js/site-name.js）。
 *
 * 优先级（见 js/library/site-registry.js）：
 *   用户手改(manual) > 本表(preset) > 自动学习(learned) > 可注册域名(host)
 *
 * 字段：
 *   h  hosts —— **必须是可注册域名**（v.qq.com 等特例见 KEEP_SUBDOMAIN）
 *   n  显示名 —— 中文站用中文名，国际站用官方英文名；**必须全局唯一**
 *   c  分类 —— 见 CAT
 *
 * 硬约束（tools/check-site-names.js 会校验）：
 *   · host 只允许 ASCII 合法域名，不含路径，不得重复；
 *   · 显示名不得重复（重名会让两个站挤进同一个目录）；
 *   · 子域一律归并到主域，同域产品只保留最有代表性的一个名字。
 *     例外只有 js/site-name.js 的 KEEP_SUBDOMAIN（v.qq.com / y.qq.com /
 *     music.163.com）—— 它们是独立产品，归并会让素材混在一起。
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VRSiteNamesPreset = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    var CAT = {
        'cn-social': '中文社区',
        'intl-social': '国际社交',
        'video': '视频',
        'live': '直播',
        'design': '设计素材',
        'photo': '图片摄影',
        'tech': '技术开发',
        'news': '新闻媒体',
        'shop': '电商',
        'tool': '工具服务',
        'music': '音乐音频',
        'game': '游戏',
        'edu': '教育知识',
        'blog': '博客建站',
        'cloud': '云存储'
    };

    var PRESET = [
        /* ---------------- 中文社区 / 内容平台 ---------------- */
        { h: ['xiaohongshu.com', 'xhslink.com'], n: '小红书', c: 'cn-social' },
        { h: ['douyin.com', 'iesdouyin.com'], n: '抖音', c: 'cn-social' },
        { h: ['weibo.com', 'weibo.cn'], n: '微博', c: 'cn-social' },
        { h: ['zhihu.com'], n: '知乎', c: 'cn-social' },
        { h: ['douban.com'], n: '豆瓣', c: 'cn-social' },        { h: ['baidu.com'], n: '百度', c: 'cn-social' },
        { h: ['jianshu.com'], n: '简书', c: 'cn-social' },
        { h: ['hupu.com'], n: '虎扑', c: 'cn-social' },
        { h: ['lofter.com'], n: 'LOFTER', c: 'cn-social' },
        { h: ['tianya.cn'], n: '天涯社区', c: 'cn-social' },
        { h: ['mop.com'], n: '猫扑', c: 'cn-social' },
        { h: ['kaixin001.com'], n: '开心网', c: 'cn-social' },
        { h: ['renren.com'], n: '人人网', c: 'cn-social' },
        { h: ['pixiv.net'], n: 'Pixiv', c: 'design' },

        /* ---------------- 国际社交 ----------------
         * 2026-11-07 修：重写预置表时这一段被整段漏掉，导致 X / Instagram /
         * TikTok 等站全部退回域名目录（test-path 的 "目录 X" 用例抓到）。 */
        { h: ['x.com', 'twitter.com'], n: 'X', c: 'intl-social' },
        { h: ['instagram.com'], n: 'Instagram', c: 'intl-social' },
        { h: ['tiktok.com'], n: 'TikTok', c: 'intl-social' },
        { h: ['facebook.com', 'fb.com'], n: 'Facebook', c: 'intl-social' },
        { h: ['reddit.com'], n: 'Reddit', c: 'intl-social' },
        { h: ['linkedin.com'], n: 'LinkedIn', c: 'intl-social' },
        { h: ['pinterest.com'], n: 'Pinterest', c: 'intl-social' },
        { h: ['tumblr.com'], n: 'Tumblr', c: 'intl-social' },
        { h: ['threads.net'], n: 'Threads', c: 'intl-social' },
        { h: ['mastodon.social'], n: 'Mastodon', c: 'intl-social' },
        { h: ['quora.com'], n: 'Quora', c: 'intl-social' },
        { h: ['deviantart.com'], n: 'DeviantArt', c: 'intl-social' },
        { h: ['vk.com'], n: 'VK', c: 'intl-social' },
        { h: ['weheartit.com'], n: 'We Heart It', c: 'intl-social' },
        { h: ['snapchat.com'], n: 'Snapchat', c: 'intl-social' },
        { h: ['discord.com'], n: 'Discord', c: 'intl-social' },

        /* ---------------- 视频 ---------------- */
        { h: ['bilibili.com', 'b23.tv'], n: 'B站', c: 'video' },
        { h: ['bilibili.tv'], n: 'Bilibili TV', c: 'video' },
        { h: ['acfun.cn'], n: 'AcFun', c: 'video' },
        { h: ['youtube.com', 'youtu.be'], n: 'YouTube', c: 'video' },
        { h: ['vimeo.com'], n: 'Vimeo', c: 'video' },
        { h: ['dailymotion.com'], n: 'Dailymotion', c: 'video' },
        { h: ['netflix.com'], n: 'Netflix', c: 'video' },
        { h: ['hulu.com'], n: 'Hulu', c: 'video' },
        { h: ['disneyplus.com'], n: 'Disney+', c: 'video' },
        { h: ['primevideo.com'], n: 'Prime Video', c: 'video' },
        { h: ['max.com'], n: 'HBO Max', c: 'video' },
        { h: ['iqiyi.com'], n: '爱奇艺', c: 'video' },
        { h: ['youku.com'], n: '优酷', c: 'video' },
        { h: ['v.qq.com'], n: '腾讯视频', c: 'video' },
        { h: ['mgtv.com'], n: '芒果TV', c: 'video' },
        { h: ['ixigua.com'], n: '西瓜视频', c: 'video' },
        { h: ['kuaishou.com'], n: '快手', c: 'video' },
        { h: ['nicovideo.jp'], n: 'ニコニコ', c: 'video' },
        { h: ['crunchyroll.com'], n: 'Crunchyroll', c: 'video' },
        { h: ['peacocktv.com'], n: 'Peacock', c: 'video' },
        { h: ['paramountplus.com'], n: 'Paramount+', c: 'video' },
        { h: ['rumble.com'], n: 'Rumble', c: 'video' },
        { h: ['odysee.com'], n: 'Odysee', c: 'video' },
        { h: ['ted.com'], n: 'TED', c: 'video' },
        { h: ['veoh.com'], n: 'Veoh', c: 'video' },
        { h: ['sohu.com'], n: '搜狐视频', c: 'video' },
        { h: ['le.com'], n: '乐视视频', c: 'video' },
        { h: ['pptv.com'], n: 'PP视频', c: 'video' },
        { h: ['1905.com'], n: '电影网', c: 'video' },
        { h: ['migu.cn'], n: '咪咕视频', c: 'video' },

        /* ---------------- 直播 ---------------- */
        { h: ['twitch.tv'], n: 'Twitch', c: 'live' },
        { h: ['douyu.com'], n: '斗鱼', c: 'live' },
        { h: ['huya.com'], n: '虎牙', c: 'live' },
        { h: ['yy.com'], n: 'YY直播', c: 'live' },
        { h: ['kick.com'], n: 'Kick', c: 'live' },
        { h: ['trovo.live'], n: 'Trovo', c: 'live' },
        { h: ['nimo.tv'], n: 'Nimo TV', c: 'live' },
        { h: ['afreecatv.com'], n: 'AfreecaTV', c: 'live' },
        { h: ['showroom-live.com'], n: 'SHOWROOM', c: 'live' },
        { h: ['zhanqi.tv'], n: '战旗直播', c: 'live' },

        /* ---------------- 设计素材 ---------------- */
        { h: ['pixso.cn'], n: 'Pixso', c: 'design' },
        { h: ['figma.com'], n: 'Figma', c: 'design' },
        { h: ['sketch.com'], n: 'Sketch', c: 'design' },
        { h: ['canva.com'], n: 'Canva', c: 'design' },
        { h: ['canva.cn'], n: 'Canva可画', c: 'design' },
        { h: ['adobe.com'], n: 'Adobe', c: 'design' },
        { h: ['behance.net'], n: 'Behance', c: 'design' },
        { h: ['dribbble.com'], n: 'Dribbble', c: 'design' },
        { h: ['artstation.com'], n: 'ArtStation', c: 'design' },
        { h: ['zcool.com.cn'], n: '站酷', c: 'design' },
        { h: ['ui.cn'], n: 'UI中国', c: 'design' },
        { h: ['iconfont.cn'], n: 'iconfont', c: 'design' },
        { h: ['icons8.com'], n: 'Icons8', c: 'design' },
        { h: ['flaticon.com'], n: 'Flaticon', c: 'design' },
        { h: ['thenounproject.com'], n: 'Noun Project', c: 'design' },
        { h: ['freepik.com'], n: 'Freepik', c: 'design' },
        { h: ['pngtree.com'], n: 'PNGTree', c: 'design' },
        { h: ['cleanpng.com'], n: 'CleanPNG', c: 'design' },
        { h: ['58pic.com'], n: '千图网', c: 'design' },
        { h: ['699pic.com'], n: '摄图网', c: 'design' },
        { h: ['51yuansu.com'], n: '觅元素', c: 'design' },
        { h: ['aigei.com'], n: '爱给网', c: 'design' },
        { h: ['huke88.com'], n: '虎课网', c: 'design' },
        { h: ['uisdc.com'], n: '优设网', c: 'design' },
        { h: ['huaban.com'], n: '花瓣', c: 'design' },
        { h: ['duitang.com'], n: '堆糖', c: 'design' },
        { h: ['tuchong.com'], n: '图虫', c: 'design' },
        { h: ['lottiefiles.com'], n: 'LottieFiles', c: 'design' },
        { h: ['remove.bg'], n: 'remove.bg', c: 'design' },
        { h: ['tinypng.com'], n: 'TinyPNG', c: 'design' },
        { h: ['coolors.co'], n: 'Coolors', c: 'design' },
        { h: ['mastergo.com'], n: 'MasterGo', c: 'design' },
        { h: ['js.design'], n: '即时设计', c: 'design' },
        { h: ['lanhuapp.com'], n: '蓝湖', c: 'design' },
        { h: ['mobbin.com'], n: 'Mobbin', c: 'design' },

        /* ---------------- 图片摄影 ---------------- */
        { h: ['unsplash.com'], n: 'Unsplash', c: 'photo' },
        { h: ['pexels.com'], n: 'Pexels', c: 'photo' },
        { h: ['pixabay.com'], n: 'Pixabay', c: 'photo' },
        { h: ['stocksnap.io'], n: 'StockSnap', c: 'photo' },
        { h: ['picsum.photos'], n: 'Lorem Picsum', c: 'photo' },
        { h: ['500px.com'], n: '500px', c: 'photo' },
        { h: ['flickr.com'], n: 'Flickr', c: 'photo' },
        { h: ['smugmug.com'], n: 'SmugMug', c: 'photo' },
        { h: ['shutterstock.com'], n: 'Shutterstock', c: 'photo' },
        { h: ['istockphoto.com'], n: 'iStock', c: 'photo' },
        { h: ['gettyimages.com'], n: 'Getty Images', c: 'photo' },
        { h: ['alamy.com'], n: 'Alamy', c: 'photo' },
        { h: ['dreamstime.com'], n: 'Dreamstime', c: 'photo' },
        { h: ['depositphotos.com'], n: 'Depositphotos', c: 'photo' },
        { h: ['123rf.com'], n: '123RF', c: 'photo' },
        { h: ['vcg.com'], n: '视觉中国', c: 'photo' },
        { h: ['wallhaven.cc'], n: 'Wallhaven', c: 'photo' },
        { h: ['wallpaperflare.com'], n: 'Wallpaper Flare', c: 'photo' },
        { h: ['desktopnexus.com'], n: 'Desktop Nexus', c: 'photo' },
        { h: ['photobucket.com'], n: 'Photobucket', c: 'photo' },
        { h: ['imgur.com'], n: 'Imgur', c: 'photo' },
        { h: ['giphy.com'], n: 'GIPHY', c: 'photo' },
        { h: ['tenor.com'], n: 'Tenor', c: 'photo' },
        { h: ['nasa.gov'], n: 'NASA', c: 'photo' },
        { h: ['esa.int'], n: 'ESA', c: 'photo' },
        { h: ['wikimedia.org'], n: 'Wikimedia Commons', c: 'photo' },
        { h: ['openverse.org'], n: 'Openverse', c: 'photo' },
        { h: ['pixnio.com'], n: 'Pixnio', c: 'photo' },
        { h: ['reshot.com'], n: 'Reshot', c: 'photo' },
        { h: ['kaboompics.com'], n: 'Kaboompics', c: 'photo' },
        { h: ['lifeofpix.com'], n: 'Life of Pix', c: 'photo' },
        { h: ['picjumbo.com'], n: 'Picjumbo', c: 'photo' },

        /* ---------------- 技术开发 ---------------- */
        { h: ['github.com'], n: 'GitHub', c: 'tech' },
        { h: ['gitlab.com'], n: 'GitLab', c: 'tech' },
        { h: ['gitee.com'], n: 'Gitee', c: 'tech' },
        { h: ['bitbucket.org'], n: 'Bitbucket', c: 'tech' },
        { h: ['stackoverflow.com'], n: 'Stack Overflow', c: 'tech' },
        { h: ['stackexchange.com'], n: 'Stack Exchange', c: 'tech' },
        { h: ['npmjs.com'], n: 'npm', c: 'tech' },
        { h: ['pypi.org'], n: 'PyPI', c: 'tech' },
        { h: ['crates.io'], n: 'crates.io', c: 'tech' },
        { h: ['packagist.org'], n: 'Packagist', c: 'tech' },
        { h: ['nuget.org'], n: 'NuGet', c: 'tech' },
        { h: ['docker.com'], n: 'Docker', c: 'tech' },
        { h: ['kubernetes.io'], n: 'Kubernetes', c: 'tech' },
        { h: ['mozilla.org'], n: 'MDN', c: 'tech' },
        { h: ['w3schools.com'], n: 'W3Schools', c: 'tech' },
        { h: ['runoob.com'], n: '菜鸟教程', c: 'tech' },
        { h: ['liaoxuefeng.com'], n: '廖雪峰的教程', c: 'tech' },
        { h: ['ruanyifeng.com'], n: '阮一峰的网络日志', c: 'tech' },
        { h: ['infoq.cn'], n: 'InfoQ', c: 'tech' },
        { h: ['oschina.net'], n: '开源中国', c: 'tech' },
        { h: ['hellogithub.com'], n: 'HelloGitHub', c: 'tech' },
        { h: ['v2ex.com'], n: 'V2EX', c: 'tech' },
        { h: ['leetcode.cn'], n: '力扣', c: 'tech' },
        { h: ['leetcode.com'], n: 'LeetCode', c: 'tech' },
        { h: ['codeforces.com'], n: 'Codeforces', c: 'tech' },
        { h: ['atcoder.jp'], n: 'AtCoder', c: 'tech' },
        { h: ['huggingface.co'], n: 'Hugging Face', c: 'tech' },
        { h: ['kaggle.com'], n: 'Kaggle', c: 'tech' },
        { h: ['vercel.com'], n: 'Vercel', c: 'tech' },
        { h: ['netlify.com'], n: 'Netlify', c: 'tech' },
        { h: ['cloudflare.com'], n: 'Cloudflare', c: 'tech' },
        { h: ['amazon.com'], n: 'AWS', c: 'tech' },
        { h: ['microsoft.com'], n: 'Microsoft', c: 'tech' },
        { h: ['aliyun.com'], n: '阿里云', c: 'tech' },
        { h: ['chinatelecomcloud.com'], n: '天翼云', c: 'tech' },
        { h: ['openai.com'], n: 'OpenAI', c: 'tech' },
        { h: ['anthropic.com'], n: 'Anthropic', c: 'tech' },
        { h: ['deepseek.com'], n: 'DeepSeek', c: 'tech' },
        { h: ['csdn.net'], n: 'CSDN', c: 'tech' },
        { h: ['juejin.cn'], n: '掘金', c: 'tech' },
        { h: ['cnblogs.com'], n: '博客园', c: 'tech' },
        { h: ['segmentfault.com'], n: 'SegmentFault', c: 'tech' },
        { h: ['gitbook.io'], n: 'GitBook', c: 'tech' },
        { h: ['sourceforge.net'], n: 'SourceForge', c: 'tech' },
        { h: ['golang.org'], n: 'Go', c: 'tech' },
        { h: ['rust-lang.org'], n: 'Rust', c: 'tech' },
        { h: ['python.org'], n: 'Python', c: 'tech' },
        { h: ['nodejs.org'], n: 'Node.js', c: 'tech' },
        { h: ['react.dev'], n: 'React', c: 'tech' },
        { h: ['vuejs.org'], n: 'Vue.js', c: 'tech' },
        { h: ['tailwindcss.com'], n: 'Tailwind CSS', c: 'tech' },
        { h: ['stackblitz.com'], n: 'StackBlitz', c: 'tech' },
        { h: ['codepen.io'], n: 'CodePen', c: 'tech' },
        { h: ['codesandbox.io'], n: 'CodeSandbox', c: 'tech' },
        { h: ['replit.com'], n: 'Replit', c: 'tech' },

        /* ---------------- 新闻媒体 ---------------- */
        { h: ['bbc.com', 'bbc.co.uk'], n: 'BBC', c: 'news' },
        { h: ['cnn.com'], n: 'CNN', c: 'news' },
        { h: ['nytimes.com'], n: '纽约时报', c: 'news' },
        { h: ['theguardian.com'], n: '卫报', c: 'news' },
        { h: ['reuters.com'], n: '路透社', c: 'news' },
        { h: ['bloomberg.com'], n: '彭博', c: 'news' },
        { h: ['wsj.com'], n: '华尔街日报', c: 'news' },
        { h: ['forbes.com'], n: '福布斯', c: 'news' },
        { h: ['techcrunch.com'], n: 'TechCrunch', c: 'news' },
        { h: ['theverge.com'], n: 'The Verge', c: 'news' },
        { h: ['wired.com'], n: 'WIRED', c: 'news' },
        { h: ['arstechnica.com'], n: 'Ars Technica', c: 'news' },
        { h: ['engadget.com'], n: 'Engadget', c: 'news' },
        { h: ['cnet.com'], n: 'CNET', c: 'news' },
        { h: ['mashable.com'], n: 'Mashable', c: 'news' },
        { h: ['buzzfeed.com'], n: 'BuzzFeed', c: 'news' },
        { h: ['vice.com'], n: 'VICE', c: 'news' },
        { h: ['economist.com'], n: '经济学人', c: 'news' },
        { h: ['ft.com'], n: '金融时报', c: 'news' },
        { h: ['apnews.com'], n: '美联社', c: 'news' },
        { h: ['npr.org'], n: 'NPR', c: 'news' },
        { h: ['zaobao.com'], n: '联合早报', c: 'news' },
        { h: ['mingpao.com'], n: '明报', c: 'news' },
        { h: ['hk01.com'], n: '香港01', c: 'news' },
        { h: ['theinitium.com'], n: '端传媒', c: 'news' },
        { h: ['dw.com'], n: '德国之声', c: 'news' },
        { h: ['rfi.fr'], n: '法广', c: 'news' },
        { h: ['voanews.com'], n: '美国之音', c: 'news' },
        { h: ['36kr.com'], n: '36氪', c: 'news' },
        { h: ['huxiu.com'], n: '虎嗅', c: 'news' },
        { h: ['ifanr.com'], n: '爱范儿', c: 'news' },
        { h: ['sspai.com'], n: '少数派', c: 'news' },
        { h: ['guokr.com'], n: '果壳', c: 'news' },
        { h: ['thepaper.cn'], n: '澎湃新闻', c: 'news' },
        { h: ['people.com.cn'], n: '人民网', c: 'news' },
        { h: ['xinhuanet.com'], n: '新华网', c: 'news' },
        { h: ['cctv.com'], n: '央视网', c: 'news' },
        { h: ['ifeng.com'], n: '凤凰网', c: 'news' },
        { h: ['sina.com.cn'], n: '新浪', c: 'news' },
        { h: ['caixin.com'], n: '财新', c: 'news' },
        { h: ['yicai.com'], n: '第一财经', c: 'news' },
        { h: ['jiemian.com'], n: '界面新闻', c: 'news' },

        /* ---------------- 电商 ---------------- */
        { h: ['taobao.com'], n: '淘宝', c: 'shop' },
        { h: ['tmall.com'], n: '天猫', c: 'shop' },
        { h: ['jd.com'], n: '京东', c: 'shop' },
        { h: ['pinduoduo.com', 'yangkeduo.com'], n: '拼多多', c: 'shop' },
        { h: ['1688.com'], n: '1688', c: 'shop' },
        { h: ['aliexpress.com'], n: '速卖通', c: 'shop' },
        { h: ['shopify.com'], n: 'Shopify', c: 'shop' },
        { h: ['ebay.com'], n: 'eBay', c: 'shop' },
        { h: ['etsy.com'], n: 'Etsy', c: 'shop' },
        { h: ['walmart.com'], n: 'Walmart', c: 'shop' },
        { h: ['target.com'], n: 'Target', c: 'shop' },
        { h: ['bestbuy.com'], n: 'Best Buy', c: 'shop' },
        { h: ['alibaba.com'], n: '阿里巴巴国际站', c: 'shop' },
        { h: ['suning.com'], n: '苏宁', c: 'shop' },
        { h: ['vip.com'], n: '唯品会', c: 'shop' },
        { h: ['dangdang.com'], n: '当当', c: 'shop' },
        { h: ['temu.com'], n: 'Temu', c: 'shop' },
        { h: ['shein.com'], n: 'SHEIN', c: 'shop' },
        { h: ['rakuten.co.jp'], n: '乐天', c: 'shop' },
        { h: ['mercari.com'], n: 'Mercari', c: 'shop' },
        { h: ['yahoo.co.jp'], n: 'Yahoo Japan', c: 'shop' },
        { h: ['meituan.com'], n: '美团', c: 'shop' },
        { h: ['ele.me'], n: '饿了么', c: 'shop' },
        { h: ['ctrip.com'], n: '携程', c: 'shop' },
        { h: ['qunar.com'], n: '去哪儿', c: 'shop' },
        { h: ['fliggy.com'], n: '飞猪', c: 'shop' },
        { h: ['booking.com'], n: 'Booking.com', c: 'shop' },
        { h: ['airbnb.com'], n: 'Airbnb', c: 'shop' },
        { h: ['ikea.com'], n: '宜家', c: 'shop' },
        { h: ['uniqlo.com'], n: '优衣库', c: 'shop' },
        { h: ['nike.com'], n: 'Nike', c: 'shop' },
        { h: ['adidas.com'], n: 'Adidas', c: 'shop' },

        /* ---------------- 工具服务 ---------------- */
        { h: ['notion.so'], n: 'Notion', c: 'tool' },
        { h: ['miro.com'], n: 'Miro', c: 'tool' },
        { h: ['trello.com'], n: 'Trello', c: 'tool' },
        { h: ['asana.com'], n: 'Asana', c: 'tool' },
        { h: ['slack.com'], n: 'Slack', c: 'tool' },
        { h: ['zoom.us'], n: 'Zoom', c: 'tool' },
        { h: ['google.com'], n: 'Google', c: 'tool' },
        { h: ['dropbox.com'], n: 'Dropbox', c: 'tool' },
        { h: ['box.com'], n: 'Box', c: 'tool' },
        { h: ['evernote.com'], n: 'Evernote', c: 'tool' },
        { h: ['obsidian.md'], n: 'Obsidian', c: 'tool' },
        { h: ['airtable.com'], n: 'Airtable', c: 'tool' },
        { h: ['zapier.com'], n: 'Zapier', c: 'tool' },
        { h: ['ifttt.com'], n: 'IFTTT', c: 'tool' },
        { h: ['chatgpt.com'], n: 'ChatGPT', c: 'tool' },
        { h: ['claude.ai'], n: 'Claude', c: 'tool' },
        { h: ['midjourney.com'], n: 'Midjourney', c: 'tool' },
        { h: ['stability.ai'], n: 'Stability AI', c: 'tool' },
        { h: ['runwayml.com'], n: 'Runway', c: 'tool' },
        { h: ['elevenlabs.io'], n: 'ElevenLabs', c: 'tool' },
        { h: ['suno.com'], n: 'Suno', c: 'tool' },
        { h: ['smallpdf.com'], n: 'Smallpdf', c: 'tool' },
        { h: ['ilovepdf.com'], n: 'iLovePDF', c: 'tool' },
        { h: ['wetransfer.com'], n: 'WeTransfer', c: 'tool' },
        { h: ['speedtest.net'], n: 'Speedtest', c: 'tool' },
        { h: ['wolframalpha.com'], n: 'Wolfram Alpha', c: 'tool' },
        { h: ['moonshot.cn'], n: 'Kimi', c: 'tool' },
        { h: ['doubao.com'], n: '豆包', c: 'tool' },
        { h: ['wps.cn'], n: 'WPS', c: 'tool' },
        { h: ['feishu.cn'], n: '飞书', c: 'tool' },
        { h: ['dingtalk.com'], n: '钉钉', c: 'tool' },
        { h: ['yuque.com'], n: '语雀', c: 'tool' },
        { h: ['processon.com'], n: 'ProcessOn', c: 'tool' },
        { h: ['apple.com'], n: 'Apple', c: 'tool' },
        { h: ['calendly.com'], n: 'Calendly', c: 'tool' },
        { h: ['typeform.com'], n: 'Typeform', c: 'tool' },
        { h: ['surveymonkey.com'], n: 'SurveyMonkey', c: 'tool' },

        /* ---------------- 音乐音频 ---------------- */
        { h: ['music.163.com'], n: '网易云音乐', c: 'music' },
        { h: ['y.qq.com'], n: 'QQ音乐', c: 'music' },
        { h: ['kugou.com'], n: '酷狗音乐', c: 'music' },
        { h: ['kuwo.cn'], n: '酷我音乐', c: 'music' },
        { h: ['spotify.com'], n: 'Spotify', c: 'music' },
        { h: ['soundcloud.com'], n: 'SoundCloud', c: 'music' },
        { h: ['bandcamp.com'], n: 'Bandcamp', c: 'music' },
        { h: ['deezer.com'], n: 'Deezer', c: 'music' },
        { h: ['tidal.com'], n: 'TIDAL', c: 'music' },
        { h: ['joox.com'], n: 'JOOX', c: 'music' },
        { h: ['ximalaya.com'], n: '喜马拉雅', c: 'music' },
        { h: ['qingting.fm'], n: '蜻蜓FM', c: 'music' },
        { h: ['lizhi.fm'], n: '荔枝FM', c: 'music' },
        { h: ['audible.com'], n: 'Audible', c: 'music' },
        { h: ['audiomack.com'], n: 'Audiomack', c: 'music' },
        { h: ['mixcloud.com'], n: 'Mixcloud', c: 'music' },
        { h: ['last.fm'], n: 'Last.fm', c: 'music' },

        /* ---------------- 游戏 ---------------- */
        { h: ['steampowered.com'], n: 'Steam', c: 'game' },
        { h: ['epicgames.com'], n: 'Epic Games', c: 'game' },
        { h: ['gog.com'], n: 'GOG', c: 'game' },
        { h: ['itch.io'], n: 'itch.io', c: 'game' },
        { h: ['playstation.com'], n: 'PlayStation', c: 'game' },
        { h: ['xbox.com'], n: 'Xbox', c: 'game' },
        { h: ['nintendo.com'], n: 'Nintendo', c: 'game' },
        { h: ['ea.com'], n: 'EA', c: 'game' },
        { h: ['ubisoft.com'], n: 'Ubisoft', c: 'game' },
        { h: ['blizzard.com'], n: 'Blizzard', c: 'game' },
        { h: ['riotgames.com'], n: 'Riot Games', c: 'game' },
        { h: ['hoyoverse.com'], n: '米哈游', c: 'game' },
        { h: ['taptap.cn'], n: 'TapTap', c: 'game' },
        { h: ['3dmgame.com'], n: '3DM', c: 'game' },
        { h: ['gamersky.com'], n: '游民星空', c: 'game' },
        { h: ['ign.com'], n: 'IGN', c: 'game' },
        { h: ['gamespot.com'], n: 'GameSpot', c: 'game' },
        { h: ['nexusmods.com'], n: 'Nexus Mods', c: 'game' },
        { h: ['curseforge.com'], n: 'CurseForge', c: 'game' },
        { h: ['wegame.com.cn'], n: 'WeGame', c: 'game' },
        { h: ['4399.com'], n: '4399', c: 'game' },
        { h: ['battlenet.com.cn'], n: '战网', c: 'game' },

        /* ---------------- 教育知识 ---------------- */
        { h: ['wikipedia.org'], n: '维基百科', c: 'edu' },
        { h: ['coursera.org'], n: 'Coursera', c: 'edu' },
        { h: ['edx.org'], n: 'edX', c: 'edu' },
        { h: ['udemy.com'], n: 'Udemy', c: 'edu' },
        { h: ['khanacademy.org'], n: '可汗学院', c: 'edu' },
        { h: ['icourse163.org'], n: '中国大学MOOC', c: 'edu' },
        { h: ['xuetangx.com'], n: '学堂在线', c: 'edu' },
        { h: ['duolingo.com'], n: 'Duolingo', c: 'edu' },
        { h: ['nationalgeographic.com'], n: '国家地理', c: 'edu' },
        { h: ['researchgate.net'], n: 'ResearchGate', c: 'edu' },
        { h: ['arxiv.org'], n: 'arXiv', c: 'edu' },
        { h: ['semanticscholar.org'], n: 'Semantic Scholar', c: 'edu' },
        { h: ['sciencedirect.com'], n: 'ScienceDirect', c: 'edu' },
        { h: ['nature.com'], n: 'Nature', c: 'edu' },
        { h: ['science.org'], n: 'Science', c: 'edu' },
        { h: ['dedao.cn'], n: '得到', c: 'edu' },
        { h: ['xueersi.com'], n: '学而思', c: 'edu' },
        { h: ['jike.com'], n: '即刻', c: 'cn-social' },

        /* ---------------- 博客建站 ---------------- */
        { h: ['wordpress.com'], n: 'WordPress', c: 'blog' },
        { h: ['blogger.com', 'blogspot.com'], n: 'Blogger', c: 'blog' },
        { h: ['github.io'], n: 'GitHub Pages', c: 'blog' },
        { h: ['gitee.io'], n: 'Gitee Pages', c: 'blog' },
        { h: ['hexo.io'], n: 'Hexo', c: 'blog' },
        { h: ['hugo.io'], n: 'Hugo', c: 'blog' },
        { h: ['ghost.org'], n: 'Ghost', c: 'blog' },
        { h: ['weebly.com'], n: 'Weebly', c: 'blog' },
        { h: ['wix.com'], n: 'Wix', c: 'blog' },
        { h: ['squarespace.com'], n: 'Squarespace', c: 'blog' },
        { h: ['carrd.co'], n: 'Carrd', c: 'blog' },
        { h: ['linktr.ee'], n: 'Linktree', c: 'blog' },
        { h: ['about.me'], n: 'About.me', c: 'blog' },
        { h: ['halo.run'], n: 'Halo', c: 'blog' },

        /* ---------------- 云存储 ---------------- */
        { h: ['aliyundrive.com'], n: '阿里云盘', c: 'cloud' },
        { h: ['quark.cn'], n: '夸克网盘', c: 'cloud' },
        { h: ['123pan.com'], n: '123云盘', c: 'cloud' },
        { h: ['115.com'], n: '115网盘', c: 'cloud' },
        { h: ['mega.nz'], n: 'MEGA', c: 'cloud' },
        { h: ['mediafire.com'], n: 'MediaFire', c: 'cloud' },
        { h: ['icloud.com'], n: 'iCloud', c: 'cloud' }
    ];

    /* ---------------- 索引 ---------------- */

    var BY_HOST = null;
    var BY_NAME = null;

    function buildIndex() {
        if (BY_HOST) { return; }
        BY_HOST = Object.create(null);
        BY_NAME = Object.create(null);
        for (var i = 0; i < PRESET.length; i++) {
            var it = PRESET[i];
            if (!it || !it.n || !it.h) { continue; }
            if (!BY_NAME[it.n]) { BY_NAME[it.n] = it; }
            for (var j = 0; j < it.h.length; j++) {
                var h = String(it.h[j] || '').toLowerCase();
                if (!h || h.indexOf('/') >= 0) { continue; }
                if (!BY_HOST[h]) { BY_HOST[h] = it; }
            }
        }
    }

    /** 按 host 精确查（调用方负责先归一 host） */
    function byHost(host) {
        buildIndex();
        var h = String(host || '').toLowerCase().replace(/^www\./, '');
        return BY_HOST[h] || null;
    }

    /** 按显示名查（目录反解用） */
    function byName(name) {
        buildIndex();
        return BY_NAME[String(name || '').trim()] || null;
    }

    function list() {
        return PRESET.slice();
    }

    function categoryLabel(c) {
        return CAT[c] || '';
    }

    return {
        CAT: CAT,
        LIST: PRESET,
        list: list,
        byHost: byHost,
        byName: byName,
        categoryLabel: categoryLabel,
        size: function () { return PRESET.length; }
    };
});
