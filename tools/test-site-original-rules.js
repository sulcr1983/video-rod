/**
 * 原图派生规则扩展包单测（审计 C1）
 *
 * 每条规则都用**真实形态的 URL** 验证「输入 → 输出」，
 * 而不是只测「函数存在」。同时验证两条安全约束：
 *   ① 非目标域名的 URL 绝不被改写（避免误伤）
 *   ② 已是最原始的 URL 返回 ''（让 originalOf 继续试下一条）
 *
 * 跑法：node tools/test-site-original-rules.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

require(path.join(__dirname, '..', 'js', 'site-original-rules.js'));
const R = globalThis.VRSiteOriginalRules;

assert.ok(R && typeof R === 'object', 'VRSiteOriginalRules 应已挂载');

/* ---------------- 逐条规则验证 ---------------- */

/** [规则键, 输入, 期望输出（'' 表示不命中）] */
const CASES = [
    /* 1 topit.me */
    ['topit', 'http://img.topit.me/m/abc.jpg', 'http://img.topit.me/l/abc.jpg'],
    ['topit', 'http://img.topit.me/l/abc.jpg', ''],

    /* 2 B站 hdslb：@ 尺寸后缀 */
    ['hdslb', 'https://i0.hdslb.com/bfs/album/abc.jpg@480w_270h.webp',
        'https://i0.hdslb.com/bfs/album/abc.jpg'],
    ['hdslb', 'https://i0.hdslb.com/bfs/album/abc.jpg', ''],

    /* 3 微博 sinaimg：多种小图前缀 → /large/ */
    ['sinaimgExt', 'https://wx1.sinaimg.cn/orj360/abc123.jpg',
        'https://wx1.sinaimg.cn/large/abc123.jpg'],
    ['sinaimgExt', 'https://wx2.sinaimg.cn/mw690/abc.jpg',
        'https://wx2.sinaimg.cn/large/abc.jpg'],
    ['sinaimgExt', 'https://wx3.sinaimg.cn/thumbnail/abc.jpg',
        'https://wx3.sinaimg.cn/large/abc.jpg'],
    ['sinaimgExt', 'https://wx3.sinaimg.cn/large/abc.jpg', ''],

    /* 4 QQ相册 */
    ['qqphoto', 'http://photo.store.qq.com/psb?/abc/m/xyz.jpg',
        'http://photo.store.qq.com/psb?/abc/o/xyz.jpg'],

    /* 5 qpic */
    ['qpic', 'https://gchat.qpic.cn/gchatpic_new/0/0-0-ABC/m/0',
        'https://gchat.qpic.cn/gchatpic_new/0/0-0-ABC/b/0'],

    /* 6 考拉 */
    ['kaola', 'https://nosdn.127.net/abc.jpg?imageView&thumbnail=200x200',
        'https://nosdn.127.net/abc.jpg'],

    /* 7 QQ群相册 */
    ['qqgroup', 'https://group.store.qq.com/a/400', 'https://group.store.qq.com/a/800'],

    /* 8 Twitter */
    ['twimg', 'https://pbs.twimg.com/media/ABC123?format=jpg',
        'https://pbs.twimg.com/media/ABC123?format=jpg&name=4096x4096'],
    ['twimg', 'https://pbs.twimg.com/media/ABC123?format=jpg&name=4096x4096', ''],

    /* 9 百度图趣 */
    ['baiduhp', 'https://hiphotos.baidu.com/album/abpic/item/abc.jpg',
        'https://hiphotos.baidu.com/album/pic/item/abc.jpg'],

    /* 10 豆瓣（补） */
    ['doubanExt', 'https://img1.doubanio.com/view/photo/m/public/p123.jpg',
        'https://img1.doubanio.com/view/photo/l/public/p123.jpg'],
    ['doubanExt', 'https://img1.doubanio.com/view/photo/thumb/public/p1.jpg',
        'https://img1.doubanio.com/view/photo/raw/public/p1.jpg'],

    /* 11 花瓣老 CDN */
    ['huabanAicdn', 'https://hb.aicdn.com/abc_fw480webp', 'https://hb.aicdn.com/abc'],

    /* 12 Flickr */
    ['flickr', 'https://live.staticflickr.com/1/abc_m.jpg',
        'https://live.staticflickr.com/1/abc_b.jpg'],

    /* 13 googleusercontent */
    ['googleusercontent', 'https://lh3.googleusercontent.com/abc/w200-h300-k/photo.jpg',
        'https://lh3.googleusercontent.com/abc/s1600/photo.jpg'],

    /* 14 迅雷方舟 */
    ['xlpan', 'https://pic.kanimg.com/a.jpg&s=100', 'https://pic.kanimg.com/a.jpg&s=1600'],

    /* 15 poco */
    ['poco', 'https://img.poco.cn/abc_123.jpg', 'https://img.poco.cn/abc.jpg'],

    /* 16 pconline */
    ['pconline', 'https://img.pconline.com.cn/abc_mthumb.jpg',
        'https://img.pconline.com.cn/abc.jpg'],

    /* 17 拼多多 */
    ['pdd', 'https://img.pddpic.com/a.jpg/webp', 'https://img.pddpic.com/a.jpgjpg'],

    /* 18 美丽说 */
    ['meilishuo', 'https://img.meilishuo.net/l/abc.jpg',
        'https://img.meilishuo.net/_o/abc.jpg'],

    /* 19 蘑菇街 */
    ['mogujie', 'https://s.mogujie.cn/a_100x200.jpg', 'https://s.mogujie.cn/a_468x468.jpg'],

    /* 20 又拍 */
    ['yupoo', 'https://photo.yupoo.com/a/square.jpg',
        'https://photo.yupoo.com/a/medish.jpg'],

    /* 21 brickvisual */
    ['brickvisual', 'https://brickvisual.com/a-300x200.jpg', 'https://brickvisual.com/a.jpg'],

    /* 22 archdaily */
    ['archdaily', 'https://images.adsttc.com/media/small/abc.jpg',
        'https://images.adsttc.com/media/large_jpg/abc.jpg'],

    /* 23 hao123 */
    ['hao123', 'https://img.hao123.com/a_310', 'https://img.hao123.com/a_0'],

    /* 24 Pinterest */
    ['pinimg', 'https://i.pinimg.com/236x/ab/cd/ef.jpg',
        'https://i.pinimg.com/originals/ab/cd/ef.jpg'],
    ['pinimg', 'https://i.pinimg.com/474x/ab/cd/ef.jpg',
        'https://i.pinimg.com/originals/ab/cd/ef.jpg'],

    /* 25 1688 alicdn */
    ['alicdn1688', 'https://cbu01.alicdn.com/img/abc_220x220.jpg',
        'https://cbu01.alicdn.com/img/abc.jpg'],
    ['alicdn1688', 'https://cbu01.alicdn.com/img/abc.jpg_.webp',
        'https://cbu01.alicdn.com/img/abc.jpg'],

    /* 26 京东 */
    ['jd', 'https://img14.360buyimg.com/n5/jfs/t1/abc.jpg',
        'https://img14.360buyimg.com/imgzone/jfs/t1/abc.jpg'],
    ['jd', 'https://img14.360buyimg.com/n0/s450x450_jfs/t1/abc.jpg',
        'https://img14.360buyimg.com/n0/jfs/t1/abc.jpg'],

    /* 27 唯品会 */
    ['vip', 'https://a.vpimg1.com/upload/a_100x200_300x400.jpg',
        'https://a.vpimg1.com/upload/a.jpg'],

    /* 28 Amazon */
    ['amazon', 'https://images-na.ssl-images-amazon.com/images/I/abc._AC_SX300_.jpg',
        'https://images-na.ssl-images-amazon.com/images/I/abc.jpg'],

    /* 29 小红书 */
    ['xhscdn', 'https://sns-img.xhscdn.com/a.jpg?imageView2/2/w/1080',
        'https://sns-img.xhscdn.com/a.jpg'],

    /* 30 airbnb */
    ['airbnb', 'https://a0.muscache.com/im/pic/abc.jpg?aki_policy=small',
        'https://a0.muscache.com/im/pic/abc.jpg?aki_policy=xx_large'],

    /* 31 shein */
    ['shein', 'https://img.ltwebstatic.com/a_thumbnail.jpg',
        'https://img.ltwebstatic.com/a.jpg'],

    /* 32 易派客 */
    ['epec', 'https://img.epec.com/a.jpg.300w_200h_1e_1c',
        'https://img.epec.com/a.jpg'],

    /* 33 微相册 */
    ['szwego', 'https://img.szwego.com/a.jpg?imageMogr2/thumbnail/200x200',
        'https://img.szwego.com/a.jpg'],

    /* 34 人人 */
    ['renren', 'https://fmn.rrfmn.com/fmn/head/p/abc_p', 'https://fmn.rrfmn.com/fmn/head/p/abc'],

    /* 35 知乎 */
    ['zhimg', 'https://pic1.zhimg.com/80/v2-abc_hd.jpg',
        'https://pic1.zhimg.com/v2-abc_r.jpg'],

    /* 37 pocoimg */
    ['pocoimg', 'https://img.pocoimg.cn/a_W500.jpg', 'https://img.pocoimg.cn/a.jpg'],

    /* 38 什么值得买 */
    ['smzdm', 'https://qimg.smzdm.com/a.jpg?imageView2/2/w/200',
        'https://qimg.smzdm.com/a.jpg'],

    /* 39 unsplash —— 处理参数全部剥掉，不留空 ? */
    ['unsplash', 'https://images.unsplash.com/photo-123?auto=format&w=400',
        'https://images.unsplash.com/photo-123'],
    ['unsplash', 'https://images.unsplash.com/photo-123', ''],

    /* 40 squarespace */
    ['squarespace', 'https://images.squarespace-cdn.com/a.jpg?format=500w',
        'https://images.squarespace-cdn.com/a.jpg'],

    /* 41 dhgate */
    ['dhgate', 'https://img.dhresource.com/a_100x100.jpg',
        'https://img.dhresource.com/a.jpg'],

    /* 42 淘宝/天猫自有图床（alicdn 上的淘宝图由 alicdn1688 覆盖，见上） */
    ['taobao', 'https://img.taobao.com/a_50x50.jpg', 'https://img.taobao.com/a.jpg'],
    ['alicdn1688', 'https://img.alicdn.com/a_50x50.jpg', 'https://img.alicdn.com/a.jpg'],

    /* 43 weibocdn */
    ['weibocdn', 'https://wx.weibocdn.com/a.jpg?x=1', 'https://wx.weibocdn.com/a.jpg'],

    /* 44 快手 */
    ['kuaishou', 'https://p1.kwaicdn.com/a.jpg~tplv-abc.webp',
        'https://p1.kwaicdn.com/a.jpg'],

    /* 46 腾讯视频 */
    ['qqvideo', 'https://puui.gtimg.cn/a.jpg?imageView&w=200&h=200',
        'https://puui.gtimg.cn/a.jpg'],

    /* 47 lofter */
    ['lofter', 'https://img.lofter.com/a.jpg?imageView&thumbnail=200x200',
        'https://img.lofter.com/a.jpg']
];

test('逐条规则：真实 URL → 原图 URL', () => {
    const fails = [];
    CASES.forEach(([key, input, want]) => {
        const fn = R[key];
        if (typeof fn !== 'function') { fails.push(`${key}: 规则不存在`); return; }
        let got;
        try { got = fn(input); } catch (e) { fails.push(`${key}: 抛错 ${e.message}`); return; }
        if (got !== want) {
            fails.push(`${key}\n    输入: ${input}\n    期望: ${JSON.stringify(want)}\n    实际: ${JSON.stringify(got)}`);
        }
    });
    assert.equal(fails.length, 0, '失败 ' + fails.length + ' 条:\n  ' + fails.join('\n  '));
});

/* ---------------- 安全约束 ---------------- */

test('安全：非目标域名绝不被改写', () => {
    const foreign = [
        'https://example.com/a.jpg',
        'https://myown.site/photo/thumb/x.jpg',
        'https://cdn.random.io/a_100x100.jpg',
        'https://notsinaimg.cn.evil.com/large/a.jpg'
    ];
    const fails = [];
    Object.keys(R).forEach((key) => {
        foreign.forEach((u) => {
            let got;
            try { got = R[key](u); } catch (e) { got = ''; }
            if (got) { fails.push(`${key} 误改了 ${u} → ${got}`); }
        });
    });
    assert.equal(fails.length, 0, '域名校验失效:\n  ' + fails.join('\n  '));
});

test('安全：已是最原始的 URL 返回空串', () => {
    /* 这些输入已经无后缀可剥，规则必须返回 '' 而不是原样返回，
     * 否则 originalOf 会把它当成「命中」，拿不到真正的原图。 */
    const pristine = [
        ['hdslb', 'https://i0.hdslb.com/bfs/album/abc.jpg'],
        ['sinaimgExt', 'https://wx1.sinaimg.cn/large/abc.jpg'],
        ['alicdn1688', 'https://cbu01.alicdn.com/img/abc.jpg'],
        ['pinimg', 'https://i.pinimg.com/originals/ab/cd.jpg']
    ];
    const fails = [];
    pristine.forEach(([key, u]) => {
        const got = R[key](u);
        if (got) { fails.push(`${key}: ${u} → ${got}（应为空）`); }
    });
    assert.equal(fails.length, 0, fails.join('\n'));
});

test('安全：空输入与非法输入不抛错', () => {
    const bad = ['', null, undefined, 'not a url', 'ftp://x.com/a.jpg'];
    Object.keys(R).forEach((key) => {
        bad.forEach((u) => {
            assert.doesNotThrow(() => R[key](u), `${key} 处理 ${JSON.stringify(u)} 抛错`);
        });
    });
});

/* ---------------- 覆盖面 ---------------- */

test('规则数量与键名唯一', () => {
    const keys = Object.keys(R);
    assert.ok(keys.length >= 40, '至少 40 组规则，实际 ' + keys.length);
    assert.equal(new Set(keys).size, keys.length, '键名不应重复');
});

test('每条规则都是函数', () => {
    Object.keys(R).forEach((k) => {
        assert.equal(typeof R[k], 'function', k + ' 不是函数');
    });
});

console.log('规则组数：' + Object.keys(R).length + '，用例：' + CASES.length);
