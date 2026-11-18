/* ==========================================================
 * 枚举层 · 任务状态存储（断点续跑）
 * 设计要点：
 *   ① 存储后端**注入**，不直接调 chrome.storage → Node 单测可传内存桩
 *   ② 字段参照 Chrono 的断点设计：finishedBytes / etag / resume
 *   ③ 与 P1-2「批量任务状态持久化」共用同一套基础设施
 * ========================================================== */
(function (root, factory) {
    'use strict';
    var api = factory();
    if (typeof module === 'object' && module.exports) { module.exports = api; }
    if (root) { root.VREnumStore = api; }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
    'use strict';

    var PREFIX = 'vrEnumTask:';
    var DEFAULT_TTL = 7 * 24 * 3600 * 1000;   // 7 天
    /* 单任务最多记多少个作品 ID（masterIds / disappeared 共用同一上限）。
     * 2000 条 × 约 12 字符 ≈ 24KB，session+local 双写也扛得住；
     * 大 UP 主（数千作品）超出部分按「最近的优先」保留。 */
    var MAX_IDS = 2000;

    function now() { return Date.now(); }

    /**
     * 内存存储桩（Node 单测 / 无 chrome 环境）
     * 接口与 chrome.storage.session 一致：get(key) → Promise<{[key]:value}>
     */
    function createMemoryBackend() {
        var mem = Object.create(null);
        return {
            kind: 'memory',
            get: function (keys) {
                return new Promise(function (res) {
                    if (keys === null || keys === undefined) { return res(Object.assign({}, mem)); }
                    var list = Array.isArray(keys) ? keys : [keys];
                    var out = {};
                    list.forEach(function (k) { if (k in mem) { out[k] = mem[k]; } });
                    res(out);
                });
            },
            set: function (obj) {
                return new Promise(function (res) {
                    Object.keys(obj || {}).forEach(function (k) { mem[k] = obj[k]; });
                    res();
                });
            },
            remove: function (keys) {
                return new Promise(function (res) {
                    var list = Array.isArray(keys) ? keys : [keys];
                    list.forEach(function (k) { delete mem[k]; });
                    res();
                });
            },
            _raw: mem
        };
    }

    /** chrome.storage.session 后端（SW / 扩展页可用） */
    function createChromeSessionBackend() {
        var area = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session)
            ? chrome.storage.session : null;
        if (!area) { return null; }
        return {
            kind: 'chrome.session',
            get: function (keys) {
                return new Promise(function (res) {
                    try { area.get(keys, function (x) { res(x || {}); }); }
                    catch (e) { res({}); }
                });
            },
            set: function (obj) {
                return new Promise(function (res) {
                    try { area.set(obj, function () { res(); }); }
                    catch (e) { res(); }
                });
            },
            remove: function (keys) {
                return new Promise(function (res) {
                    try { area.remove(keys, function () { res(); }); }
                    catch (e) { res(); }
                });
            }
        };
    }

    /**
     * chrome.storage.local 后端 —— **活过 SW 重启**。
     *
     * 2026-11-18（审计 C3，参照 MAX Video Downloader 的双写做法）：
     *   session 会在 SW 被回收时清空，于是「批量任务跑到一半 SW 休眠」
     *   在用户侧完全无感知：进度条停住、没有「已中断」提示、也没有续跑入口。
     *   加一个 local 备份，markInterrupted() 才有东西可标。
     *
     * 为什么不只用 local：session 读写更快且不落盘，热路径（每页翻页都 save）
     * 用 session 更合适；local 作为持久副本，容错优先。
     */
    function createChromeLocalBackend() {
        var area = (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local)
            ? chrome.storage.local : null;
        if (!area) { return null; }
        return {
            kind: 'chrome.local',
            get: function (keys) {
                return new Promise(function (res) {
                    try { area.get(keys, function (x) { res(x || {}); }); }
                    catch (e) { res({}); }
                });
            },
            set: function (obj) {
                return new Promise(function (res) {
                    try { area.set(obj, function () { res(); }); }
                    catch (e) { res(); }
                });
            },
            remove: function (keys) {
                return new Promise(function (res) {
                    try { area.remove(keys, function () { res(); }); }
                    catch (e) { res(); }
                });
            }
        };
    }

    /**
     * 双写后端：primary（session，快）+ backup（local，耐 SW 重启）。
     *
     * 语义：
     *   · set    两边都写；任一边失败不影响另一边（以「至少一边成功」为准）
     *   · get    先读 primary；缺失的键回落到 backup，并**回填 primary**
     *            （SW 重启后的第一次读就恢复热路径）
     *   · remove 两边都删，避免 backup 里的旧数据让「已删任务」复活
     *   · 全量 get（keys=null）时按 primary 优先合并两边
     */
    function createDualBackend(primary, backup) {
        if (!primary) { return backup || null; }
        if (!backup) { return primary; }
        return {
            kind: primary.kind + '+' + backup.kind,
            get: function (keys) {
                return Promise.resolve().then(function () {
                    return primary.get(keys);
                }).then(function (got) {
                    var have = got || {};
                    if (keys === null || keys === undefined) {
                        return backup.get(null).then(function (bak) {
                            var out = Object.assign({}, bak || {});
                            Object.keys(have).forEach(function (k) { out[k] = have[k]; });
                            return out;
                        });
                    }
                    var list = Array.isArray(keys) ? keys : [keys];
                    var miss = list.filter(function (k) { return !(k in have); });
                    if (!miss.length) { return have; }
                    return backup.get(miss).then(function (bak) {
                        var b = bak || {};
                        var out = Object.assign({}, have);
                        var backfill = {};
                        Object.keys(b).forEach(function (k) {
                            out[k] = b[k];
                            backfill[k] = b[k];
                        });
                        if (Object.keys(backfill).length) {
                            try { primary.set(backfill); } catch (e) { /* 回填失败不影响读 */ }
                        }
                        return out;
                    });
                });
            },
            set: function (obj) {
                return Promise.resolve().then(function () {
                    var jobs = [];
                    try { jobs.push(primary.set(obj)); } catch (e) { /* ignore */ }
                    try { jobs.push(backup.set(obj)); } catch (e) { /* ignore */ }
                    return Promise.all(jobs);
                }).then(function () { /* 返回值无关紧要 */ });
            },
            remove: function (keys) {
                return Promise.resolve().then(function () {
                    var jobs = [];
                    try { jobs.push(primary.remove(keys)); } catch (e) { /* ignore */ }
                    try { jobs.push(backup.remove(keys)); } catch (e) { /* ignore */ }
                    return Promise.all(jobs);
                }).then(function () { /* ignore */ });
            }
        };
    }

    /** 选后端：session + local 双写；缺一个就单用；都没有退化到内存（标记 degraded） */
    function pickBackend() {
        var s = createChromeSessionBackend();
        var l = createChromeLocalBackend();
        if (s && l) { return createDualBackend(s, l); }
        if (s) { return s; }
        if (l) { return l; }
        return createMemoryBackend();
    }

    /** 稳定任务键（与 targets.targetKey 同规则，两边必须一致）。
     *
     * 为什么 store 也要自己实现一份：store 是独立模块（Node 单测可注入 backend），
     * 不该反向依赖 targets；但键的**规则**必须和 targets 完全一样，
     * 否则 runner 用 targets 算键、store.start 用自己算键，两边对不上 ——
     * 表现为「刚存进去的任务立刻读不到」，是最难查的一类静默失败。
     *
     * 规则（2026-11-18，D10 连带修复）：
     *   · 整博主       platform:ownerId              （保持原样，不破坏已有断点）
     *   · 合集         platform:ownerId:c<collectionId>
     *   · 番剧         platform:ownerId:b
     * 不加后缀的后果：同一 UP 主的整博主与它的某个合集共用一个键，
     * 断点 cursor 与 masterIds 快照会互相覆盖（合集只 11 条，会把上千条的快照压掉）。
     */
    function buildKey(t) {
        if (!t) { return ''; }
        var base = String(t.platform || '') + ':' + String(t.ownerId || '');
        var kind = String(t.targetKind || 'owner');
        if (kind === 'collection' && String(t.collectionId || '')) {
            return base + ':c' + String(t.collectionId);
        }
        if (kind === 'bangumi') { return base + ':b'; }
        return base;
    }

    function keyOf(targetKey) { return PREFIX + String(targetKey || ''); }

    /**
     * 创建存储。backend 可选；不给则自动选。
     * @param {{backend?:object, ttl?:number, clock?:function}} opt
     */
    function create(opt) {
        var o = opt || {};
        var backend = o.backend || pickBackend();
        var ttl = Number.isFinite(o.ttl) ? o.ttl : DEFAULT_TTL;
        var clock = typeof o.clock === 'function' ? o.clock : now;

        /** 新建任务（覆盖同博主旧任务） */
        async function start(target, extra) {
            var t = target || {};
            var taskKey = buildKey(t);
            var task = {
                taskId: 'e-' + clock() + '-' + Math.random().toString(36).slice(2, 8),
                key: taskKey,
                platform: String(t.platform || ''),
                ownerId: String(t.ownerId || ''),
                /* 2026-11-18（D10 连带）：任务键要能区分「整博主 / 合集 / 番剧」，
                 * 否则同一 UP 主的整博主与它的某个合集共用一个任务键，
                 * 断点与 masterIds 快照会互相覆盖。见 buildKey 注释。 */
                targetKind: String(t.targetKind || 'owner'),
                collectionId: String(t.collectionId || ''),
                seasonId: String(t.seasonId || ''),
                epId: String(t.epId || ''),
                ownerName: String(t.ownerName || ''),
                pageUrl: String(t.pageUrl || ''),
                status: 'running',              /* running|paused|done|interrupted|failed */
                cursor: {},
                total: 0, done: 0, ok: 0, fail: 0, skipped: 0,
                finishedBytes: 0,               /* 参照 Chrono */
                etag: '',
                resume: false,
                items: [],                      /* 已枚举未下载（上限保护） */
                errors: [],                     /* 最近错误（上限 50） */
                /* 2026-11-18（审计 D3，借鉴抖珍藏的 masterList/disappeared）：
                 * masterIds  = 上一次枚举到的作品 ID 全集（权威快照）
                 * disappeared = 上次有、这次没了的 ID（**博主删了，本地还留着**）
                 * 为什么需要：用户存下来的东西，源站删了就再也找不回来 ——
                 * 这是「备份」相对「在线收藏」唯一的实质优势。
                 * 上限：单个任务最多记 MAX_IDS 个，防上万条作品把 storage 撑爆。 */
                masterIds: [],
                disappeared: [],
                lastRun: 0,                     /* 上次枚举完成时间（参照抖珍藏 lastRun） */
                startedAt: clock(),
                updatedAt: clock()
            };
            if (extra && typeof extra === 'object') {
                Object.keys(extra).forEach(function (k) {
                    if (!(k in task)) { task[k] = extra[k]; }
                });
            }
            var obj = {};
            obj[keyOf(taskKey)] = task;
            await backend.set(obj);
            return task;
        }

        async function get(targetKey) {
            var k = keyOf(targetKey);
            var got = await backend.get([k]);
            return (got && got[k]) || null;
        }

        async function save(task) {
            if (!task || !task.key) { return null; }
            task.updatedAt = clock();
            var obj = {};
            obj[keyOf(task.key)] = task;
            await backend.set(obj);
            return task;
        }

        /** 局部更新（读-改-写），返回更新后的任务 */
        async function patch(targetKey, fields) {
            var task = await get(targetKey);
            if (!task) { return null; }
            Object.keys(fields || {}).forEach(function (k) { task[k] = fields[k]; });
            return save(task);
        }

        /** 追加错误（保留最近 50 条，防止状态无限膨胀） */
        async function pushError(targetKey, err) {
            var task = await get(targetKey);
            if (!task) { return null; }
            task.errors = Array.isArray(task.errors) ? task.errors : [];
            task.errors.push({
                at: clock(),
                code: String((err && err.code) || ''),
                message: String((err && err.message) || err || '').slice(0, 200)
            });
            if (task.errors.length > 50) { task.errors = task.errors.slice(-50); }
            return save(task);
        }

        async function remove(targetKey) {
            await backend.remove([keyOf(targetKey)]);
        }

        /** 列出全部任务（按 updatedAt 降序） */
        async function list() {
            var all = await backend.get(null);
            var out = [];
            Object.keys(all || {}).forEach(function (k) {
                if (k.indexOf(PREFIX) === 0) { out.push(all[k]); }
            });
            out.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
            return out;
        }

        /**
         * SW 启动时调用：把遗留的 running 标记为 interrupted。
         * 这是「用户能看见任务已中断」的唯一入口。
         */
        async function markInterrupted() {
            var tasks = await list();
            var changed = [];
            for (var i = 0; i < tasks.length; i++) {
                if (tasks[i].status === 'running') {
                    tasks[i].status = 'interrupted';
                    tasks[i].updatedAt = clock();
                    changed.push(tasks[i]);
                }
            }
            if (changed.length) {
                var obj = {};
                changed.forEach(function (t) { obj[keyOf(t.key)] = t; });
                await backend.set(obj);
            }
            return changed;
        }

        /** 清理过期任务（默认 7 天） */
        async function prune(olderThan) {
            var limit = clock() - (Number.isFinite(olderThan) ? olderThan : ttl);
            var tasks = await list();
            var dead = tasks.filter(function (t) { return (t.updatedAt || 0) < limit; });
            for (var i = 0; i < dead.length; i++) {
                await backend.remove([keyOf(dead[i].key)]);
            }
            return dead.length;
        }

        return {
            backend: backend,
            start: start,
            get: get,
            save: save,
            patch: patch,
            pushError: pushError,
            remove: remove,
            list: list,
            markInterrupted: markInterrupted,
            prune: prune
        };
    }

    return {
        create: create,
        createMemoryBackend: createMemoryBackend,
        createChromeSessionBackend: createChromeSessionBackend,
        /* 2026-11-18（C3）：local 备份 + 双写组合，供单测注入 */
        createChromeLocalBackend: createChromeLocalBackend,
        createDualBackend: createDualBackend,
        pickBackend: pickBackend,
        keyOf: keyOf,
        /* 2026-11-18（D10 连带）：任务键构造统一出口。
         * runner 必须用这个，不能自己拼 —— 否则整博主/合集/番剧会撞键。 */
        buildKey: buildKey,
        PREFIX: PREFIX,
        DEFAULT_TTL: DEFAULT_TTL
    };
});