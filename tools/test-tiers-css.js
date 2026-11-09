/* 侧边栏尺寸档位的 CSS 契约（纯文本，不依赖浏览器）
跑法：node tools/test-tiers-css.js

为什么需要：2026-11-09 苏哥截图报「大 ≥1200 右边被切掉，不知道后面还有没有别的」。
根因不是逻辑，是 `.ip-tiers` 用了单行 nowrap + `overflow-x:auto` 且**隐藏滚动条** ——
侧边栏 380px 放不下 5 个档位，「超大」被裁掉且没有任何可滚动提示。
这类缺陷单测抓不到、真机验证慢，所以用文本契约钉住：档位行必须换行、不得隐藏溢出。
*/
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'css', 'image-page.css'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '..', 'js', 'image-page.js'), 'utf8');

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
    if (cond) { pass++; return; }
    fail++; fails.push(name);
    console.log('FAIL  ' + name + (extra ? '  ' + extra : ''));
}

function ruleBody(selector) {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(esc + '\\s*\\{([^}]*)\\}', 'g');
    let m, last = null;
    while ((m = re.exec(CSS)) !== null) { last = m[1]; }
    return last || '';
}

/* 注释里会提到旧写法（overflow-x:auto），断言前先剥掉注释，避免自证式误报 */
const tiers = ruleBody('.ip-tiers').replace(/\/\*[\s\S]*?\*\//g, '');

ok('T1 .ip-tiers 存在', !!tiers);
ok('T2 档位行允许换行（flex-wrap: wrap）', /flex-wrap\s*:\s*wrap/.test(tiers), tiers.slice(0, 80));
ok('T3 档位行不再横向滚动（禁 overflow-x:auto）', !/overflow-x\s*:\s*auto/.test(tiers));
ok('T4 档位行不隐藏溢出', !/overflow\s*:\s*hidden/.test(tiers));
ok('T5 单个档位不压缩', /\.ip-tier\s*\{[^}]*flex\s*:\s*0\s+0\s+auto/.test(CSS));
ok('T6 档位标签不折行（white-space: nowrap）', /\.ip-tier\s*\{[^}]*white-space\s*:\s*nowrap/.test(CSS));

/* 2026-11-09 同批修的逻辑坑：点「全部」档时 parseInt('0') || 100 会把门槛变成 100 */
ok('T7 「全部」档支持 0（不得用 || 100 兜底）',
    !/parseInt\([^)]*data-min[^)]*\)\s*\|\|\s*100/.test(JS));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) {
    console.log('失败用例：' + fails.join(', '));
    process.exit(1);
}
