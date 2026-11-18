/**
 * VRPeers 单测 —— 「同一个博主」判据
 *
 * 背景（苏哥 2026-11-18 报「只看此人的筛选规则好似不对」）：
 * 抖音 authorId 有「抖音号 / 数字 UID / sec_uid」三条回退路径，
 * 同一博主在不同下载批次会落到不同形态，库里因此出现三个目录：
 *   张见识(@4091707616143916) / 张见识(@56675926250) / 张见识(@MS4w...)
 * 旧判据「有 id 严格比对 id」把同一个人拆成互不可见的三队。
 *
 * 用法：node --test tools/test-peers.js
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { VRPeers } = require('../js/library/peers.js');

/* 真实库里「张见识」的三条（relPath 已按目录形态截断） */
const ZHANG = [
    { relPath: 'video-rod/抖音/张见识(@4091707616143916)/a.mp4', plat: 'douyin',
      author: '张见识', authorId: '4091707616143916' },
    { relPath: 'video-rod/抖音/张见识(@4091707616143916)/b.mp4', plat: 'douyin',
      author: '张见识', authorId: '4091707616143916' },
    { relPath: 'video-rod/抖音/张见识(@56675926250)/视频/c.mp4', plat: 'douyin',
      author: '张见识', authorId: '56675926250' },
    { relPath: 'video-rod/抖音/张见识(@MS4wLjABAAAA)/d.mp4', plat: 'douyin',
      author: '张见识', authorId: 'MS4wLjABAAAA' },
    { relPath: 'video-rod/抖音/张见识(@MS4wLjABAAAA)/e_01.mp4', plat: 'douyin',
      author: '张见识', authorId: 'MS4wLjABAAAA' }
];

test('ID 形态漂移：同平台同昵称应归为同一人', () => {
    const peers = VRPeers.peersOf(ZHANG, ZHANG[0]);
    assert.strictEqual(peers.length, 4, '除自己外应有 4 条');
    assert.ok(peers.every(p => p.author === '张见识'));
});

test('从任意一条出发都能看到全部同作者', () => {
    const bySec = VRPeers.peersOf(ZHANG, ZHANG[3]);
    assert.strictEqual(bySec.length, 4);
});

test('跨平台同名不算同一人', () => {
    const mixed = [
        { relPath: 'a/1.mp4', plat: 'douyin', author: '小王', authorId: '1' },
        { relPath: 'a/2.mp4', plat: 'bilibili', author: '小王', authorId: '1' }
    ];
    assert.strictEqual(VRPeers.peersOf(mixed, mixed[0]).length, 0);
});

test('占位昵称不参与合并（待整理横跨多平台）', () => {
    const ph = [
        { relPath: 'x/1.jpg', plat: 'x', author: '待整理', authorId: '' },
        { relPath: 'x/2.jpg', plat: 'x', author: '待整理', authorId: '' },
        { relPath: 'y/3.jpg', plat: 'xiaohongshu', author: '待整理', authorId: '' }
    ];
    assert.strictEqual(VRPeers.peersOf(ph, ph[0]).length, 0);
    assert.strictEqual(VRPeers.authorKeyOf(ph[0]), '');
});

test('空昵称 + 有 id 时仍能按 id 归队', () => {
    const rows = [
        { relPath: 'a/1.mp4', plat: 'weibo', author: '', authorId: 'u1' },
        { relPath: 'a/2.mp4', plat: 'weibo', author: '', authorId: 'u1' },
        { relPath: 'a/3.mp4', plat: 'weibo', author: '', authorId: 'u2' }
    ];
    assert.strictEqual(VRPeers.peersOf(rows, rows[0]).length, 1);
});

test('改昵称但 id 不变仍算同一人', () => {
    const rows = [
        { relPath: 'a/1.mp4', plat: 'bilibili', author: '旧名', authorId: '888' },
        { relPath: 'a/2.mp4', plat: 'bilibili', author: '新名', authorId: '888' }
    ];
    assert.strictEqual(VRPeers.peersOf(rows, rows[0]).length, 1);
});

test('无 id 与有 id 混存时按昵称归队（B 站实况）', () => {
    const rows = [
        { relPath: 'b/人民空军(@423429083)/1.mp4', plat: 'bilibili',
          author: '人民空军', authorId: '423429083' },
        { relPath: 'b/人民空军/2.mp4', plat: 'bilibili', author: '人民空军', authorId: '' }
    ];
    assert.strictEqual(VRPeers.peersOf(rows, rows[0]).length, 1);
});

test('不包含自己，且从不返回自己', () => {
    const peers = VRPeers.peersOf(ZHANG, ZHANG[2]);
    assert.ok(!peers.some(p => p.relPath === ZHANG[2].relPath));
});

test('空昵称且无 id：无同作者', () => {
    const rows = [{ relPath: 'a/1.mp4', plat: 'web', author: '', authorId: '' }];
    assert.strictEqual(VRPeers.peersOf(rows, rows[0]).length, 0);
});
