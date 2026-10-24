/* ==========================================================
 * VRKeys —— 资源库统一键盘注册（S4）
 *
 * 口径：输入框 / 下拉 / 可编辑区域内不劫持；处理器返回 true 表示已消费。
 * 依赖：无，挂 self.VRKeys。
 * ========================================================== */
(function (root) {
    'use strict';

    var handlers = [];

    function isTyping(el) {
        if (!el) { return false; }
        var tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
            tag === 'BUTTON' || tag === 'A' || el.isContentEditable;
    }

    document.addEventListener('keydown', function (ev) {
        if (isTyping(ev.target)) { return; }
        // 组合键交给浏览器
        if (ev.ctrlKey || ev.metaKey || ev.altKey) { return; }

        for (var i = 0; i < handlers.length; i++) {
            var handled = false;
            try {
                handled = handlers[i](ev) === true;
            } catch (e) { /* 单个处理器异常不影响其他 */ }
            if (handled) {
                ev.preventDefault();
                return;
            }
        }
    });

    root.VRKeys = {
        on: function (fn) {
            if (typeof fn === 'function') { handlers.push(fn); }
        }
    };
})(typeof self !== 'undefined' ? self : this);
