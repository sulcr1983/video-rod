/* ==========================================================
 * 博主枚举 · Adapter 接口与注册表
 *
 * 设计目标（2026-11-18）：
 *   把「每个站点怎么枚举」收敛成统一接口，让「枚举流程」只写一次。
 *
 * 三层分工：
 *   ① 通用层：网络嗅探 / DOM 扫描 / 命名 / 归档      —— 与站点无关
 *   ② 适配层：本文件注册的每个 adapter               —— 每站一个
 *   ③ 枚举层：targets → pager → normalize（已建）     —— 与站点无关
 *
 * 为什么 adapter 只做两件事：
 *   实测 12 家竞品后确认，「取哪个 URL」和「怎么解析响应」是站点特化的全部；
 *   其余（重试、限速、断点、去重、落盘）都是通用的。把通用逻辑放进 adapter
 *   会导致每改一处通用行为要改 N 个站点。
 * ========================================================== */
(function (root) {
    'use strict';

    var adapters = Object.create(null);

    /**
     * 注册一个 adapter。
     *
     * @param {object} spec
     * @param {string} spec.platform     平台键（与 VRPath.detectPlatform 一致）
     * @param {string[]} spec.supports   支持的目标类型：'owner' | 'collection' | 'video'
     * @param {boolean} spec.requiresAuth 是否需要登录态
     * @param {function} spec.firstPage  (state) → url|null   纯构造，不发请求
     * @param {function} spec.parsePage  (json) → {items, cursor, hasMore}  纯函数
     * @param {object} [spec.helpers]    站点私有辅助（如签名器名字）
     *
     * @returns {boolean} 是否注册成功
     */
    function register(spec) {
        var s = spec || {};
        if (!s.platform || typeof s.platform !== 'string') { return false; }
        if (typeof s.firstPage !== 'function') { return false; }
        if (typeof s.parsePage !== 'function') { return false; }
        adapters[s.platform] = {
            platform: s.platform,
            supports: Array.isArray(s.supports) ? s.supports.slice() : ['owner'],
            requiresAuth: !!s.requiresAuth,
            firstPage: s.firstPage,
            parsePage: s.parsePage,
            helpers: s.helpers || {}
        };
        return true;
    }

    /** 取一个 adapter（没有就是 null，绝不返回半个对象） */
    function get(platform) {
        var k = String(platform || '');
        return adapters[k] || null;
    }

    /** 判断是否支持某能力 */
    function supports(platform, capability) {
        var a = get(platform);
        if (!a) { return false; }
        if (!capability) { return true; }
        return a.supports.indexOf(capability) >= 0;
    }

    /** 列出已注册的平台（便于诊断「为什么这个站跑不了」） */
    function platforms() {
        return Object.keys(adapters);
    }

    /**
     * 清空注册表（**仅供单测**）。
     * 生产代码不该调用：adapter 是启动时静态注册的。
     */
    function _reset() {
        adapters = Object.create(null);
    }

    root.VREnumAdapters = {
        register: register,
        get: get,
        supports: supports,
        platforms: platforms,
        _reset: _reset
    };
})(typeof self !== 'undefined' ? self : this);
