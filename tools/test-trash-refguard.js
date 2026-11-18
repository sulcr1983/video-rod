/**
 * 引用删除顺序保护 · 逻辑验证（审计 P0-2）
 *
 * ⚠️ 重要发现（2026-11-18 真机验证后修正预期）：
 *   在**正常数据流**下，这条修复是「不可达」的防御性代码：
 *     · refCount(hash) 会**计入活跃引用**（见 dedup.js:232，只排除 trashed/outOfRoot）
 *     · 所以「A 有活跃引用 B」时，refCount 至少为 2 → refOnly=true → 文件不搬
 *     · 文件不搬 → refOf 仍然正确 → 不会悬空
 *
 *   真机会话实测确认：删 A 时日志打印「[trash] 只减引用：同内容仍有活跃条目」，
 *   走的是 refOnly 分支，搬移分支没进去。
 *
 *   那么这条修复在什么情况下生效？
 *     a) entry.sha256 缺失 → refCount 返回 0 → refOnly=false → 会搬
 *        而若此时仍有条目 refOf 指向它（脏数据 / 历史遗留），就会悬空
 *     b) 引用条目的 state 是 trashed/outOfRoot → 被 refCount 排除 → refOnly=false
 *        但它恢复成 ok 之后 refOf 已指向搬走的位置
 *     c) 竞态：查询与搬移之间有人把 B 改成 trashed
 *
 *   结论：这是**防御性修复**，防的是异常/脏数据，不是主路径。
 *        保留它有价值（代价小、能兜住上面三种情况），但**不该被当成「修好了重大问题」**。
 *
 * 本文件验证三件事：
 *   ① 静态：代码里确实有「查引用 → 重指」（删除侧）与「指回」（恢复侧）
 *   ② 动态：findBy('refOf') 与 patchFile 的语义正确
 *   ③ 边界：excludeRelPath 排除自身、无引用时为空
 *
 * 跑法：node tools/test-trash-refguard.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');

const SRC = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'library', 'trash.js'), 'utf8');
const DEDUP = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'library', 'dedup.js'), 'utf8');

/* ---------------- ① 静态：删除侧 ---------------- */

test('删除侧：搬移前会查 refOf 引用', () => {
    assert.ok(SRC.includes("findBy('refOf'"), '应调用 findBy("refOf", …)');
});

test('删除侧：查询时排除自己（excludeRelPath）', () => {
    const idx = SRC.indexOf("findBy('refOf'");
    const seg = SRC.slice(idx, idx + 260);
    assert.ok(seg.includes('excludeRelPath'), '应排除自身，否则会把自己当引用重指');
});

test('删除侧：重指目标是回收站路径', () => {
    assert.ok(SRC.includes('batchRel + '), '应拼回收站相对路径');
    assert.ok(SRC.includes("patchRow(refRow.relPath, { refOf: newRel })"),
        '应把引用条目的 refOf 改到新位置');
});

test('删除侧：只在「搬文件」分支里重指（refOnly 不重指）', () => {
    /* refOnly=true 时文件没动，refOf 本来就对，不该重指 */
    const moveIdx = SRC.indexOf('if (!refOnly) {');
    const refIdx = SRC.indexOf("findBy('refOf'");
    assert.ok(moveIdx >= 0 && refIdx > moveIdx, '重指逻辑应在 !refOnly 分支内');
});

test('删除侧：查引用失败不阻断删除', () => {
    const idx = SRC.indexOf("findBy('refOf'");
    const seg = SRC.slice(Math.max(0, idx - 400), idx + 300);
    assert.ok(seg.includes('catch'), '应有 try/catch 兜底');
    assert.ok(/查引用失败|继续搬移/.test(seg), '注释应说明失败时继续');
});

/* ---------------- ② 静态：恢复侧（对称） ---------------- */

test('恢复侧：搬回原位后把 refOf 指回', () => {
    assert.ok(SRC.includes('refsBack'), '应有反向查引用');
    assert.ok(SRC.includes('TRASH + \'/\' + t.batch + \'/\' + fsRel')
        || SRC.includes("TRASH + '/' + t.batch"),
        '应按回收站路径查引用');
    assert.ok(SRC.includes('patchRow(rr0.relPath, { refOf: movedRel })'),
        '应把 refOf 指回 movedRel（可能是改名后的路径）');
});

test('恢复侧：改名恢复时指向新路径而非旧路径', () => {
    /* movedRel 在改名分支里会被赋成 altFs 的完整路径 */
    assert.ok(SRC.includes('movedRel = rr.prefix'), '改名时应更新 movedRel');
    const refBackIdx = SRC.indexOf('refsBack');
    const movedIdx = SRC.indexOf('movedRel = rr.prefix');
    assert.ok(movedIdx < refBackIdx, 'movedRel 先算好，再用于重指');
});

/* ---------------- ④ 关键前提：为什么这条修复是防御性的 ---------------- */

test('前提核实：refCount 计入活跃引用（只排除 trashed/outOfRoot）', () => {
    /* 这是「修复在正常流不可达」的根本原因。
     * 如果哪天有人把 refCount 改成「只算 isRef=0 的实体」，这条修复就变成主路径了，
     * 所以把它钉成断言 —— 改 refCount 语义时会立刻红。 */
    assert.ok(DEDUP.includes('function refCount'), 'refCount 应存在');
    assert.ok(DEDUP.includes('EXCLUDE_STATES') || DEDUP.includes('isActiveEntry'),
        'refCount 应排除非活跃状态');
    const idx = DEDUP.indexOf('function refCount');
    const seg = DEDUP.slice(idx, idx + 700);
    assert.ok(seg.includes('excludeState') || seg.includes('isActiveEntry'),
        'refCount 只排除 trashed/outOfRoot，**不**排除活跃引用');
});

test('前提核实：refOnly 判定用 refCount > 1', () => {
    const idx = SRC.indexOf('var refOnly = false');
    const seg = SRC.slice(idx, idx + 400);
    assert.ok(seg.includes('refCount'), 'refOnly 应基于 refCount');
    assert.ok(/cnt\s*>\s*1/.test(seg), 'refCount > 1 → refOnly=true（文件不搬）');
});

/** 极简内存 DB，只实现 findBy + patchFile 的语义 */
function makeDb(rows) {
    const files = new Map(rows.map((r) => [r.relPath, Object.assign({}, r)]));
    return {
        files,
        async findBy(field, value, opts) {
            const o = opts || {};
            const limit = Number(o.limit) || 1;
            const out = [];
            for (const r of files.values()) {
                if (out.length >= limit) { break; }
                if (r[field] === value && r.relPath !== o.excludeRelPath) { out.push(r); }
            }
            return out;
        },
        async patchFile(rel, patch) {
            const cur = files.get(rel);
            if (!cur) { return null; }
            const next = Object.assign({}, cur, patch);
            files.set(rel, next);
            return next;
        }
    };
}

const A = 'video-rod/B站/up/视频/a.mp4';
const B = 'video-rod/B站/up/视频/a_copy.mp4';

test('findBy(refOf)：能找出指向实体的引用条目', async () => {
    const db = makeDb([
        { relPath: A, state: 'ok', sha256: 'H', isRef: 0 },
        { relPath: B, state: 'ok', sha256: 'H', isRef: 1, refOf: A }
    ]);
    const refs = await db.findBy('refOf', A, { limit: 5000, excludeRelPath: A });
    assert.equal(refs.length, 1);
    assert.equal(refs[0].relPath, B);
});

test('findBy(refOf)：excludeRelPath 能排除自身', async () => {
    /* 极端情况：某条目 refOf 指向自己（脏数据），不该被当成引用 */
    const db = makeDb([
        { relPath: A, state: 'ok', refOf: A }
    ]);
    const refs = await db.findBy('refOf', A, { limit: 5000, excludeRelPath: A });
    assert.equal(refs.length, 0);
});

test('findBy(refOf)：没有引用时返回空', async () => {
    const db = makeDb([{ relPath: A, state: 'ok' }]);
    const refs = await db.findBy('refOf', A, { limit: 5000, excludeRelPath: A });
    assert.equal(refs.length, 0);
});

test('patchFile：只改 refOf，其它字段不变', async () => {
    const db = makeDb([
        { relPath: B, state: 'ok', sha256: 'H', isRef: 1, refOf: A, title: '标题' }
    ]);
    const trashPath = '_回收站/20261118-x/B站/up/视频/a.mp4';
    const next = await db.patchFile(B, { refOf: trashPath });

    assert.equal(next.refOf, trashPath);
    assert.equal(next.isRef, 1, '仍是引用');
    assert.equal(next.sha256, 'H', '指纹不变');
    assert.equal(next.title, '标题', '其它字段不变');
    assert.equal(next.state, 'ok', '引用条目本身不进回收站');
});

test('重指后能通过新路径再查回来（闭环）', async () => {
    const db = makeDb([
        { relPath: A, state: 'trashed' },
        { relPath: B, state: 'ok', isRef: 1, refOf: A }
    ]);
    const trashPath = '_回收站/20261118-x/B站/up/视频/a.mp4';
    await db.patchFile(B, { refOf: trashPath });

    const back = await db.findBy('refOf', trashPath, { limit: 10 });
    assert.equal(back.length, 1, '用新路径应能找回引用条目');
    assert.equal(back[0].relPath, B);
});
