"""
一键体检 —— 2026-11-12（测试方案落地的执行入口）

为什么要有这个：仓库里有 30 个 Node 单测、9 个界面套件、60+ 个真机脚本，
但没有一个「跑一下就知道现在能不能用」的入口。结果就是没人跑，
只有出问题才临时拼命令 —— 这就是「老是出问题」的组织性原因。

三档（默认冒烟）：
    python tools/health-check.py            # 冒烟 ~2 分钟：改完代码自检
    python tools/health-check.py --full     # 全量 ~5 分钟：发布前必跑
    python tools/health-check.py --live     # 全量 + 真实站点（需登录态，有风控风险）

每条结论都写进 deliverables/test-runs/health-<时间>.md，给自己/下次会话看。
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'deliverables', 'test-runs')

# 冒烟档跑这些纯逻辑单测：命名 / 路径 / 保存 / 选源 / 去重 / 图片
SMOKE_UNITS = [
    'test-naming.js', 'test-path.js', 'test-save.js', 'test-video-quality.js',
    'test-dedupe-key.js', 'test-image-util.js', 'test-image-batch.js', 'test-live-pair.js',
]
# 冒烟档的界面套件：只挑「坏了就一定不能发」的两条（最快）
SMOKE_SUITES = 'e2e-sw,dedup'

# 已知失败基线：这些套件失败是「已认账」的（别人正在改的功能 / 环境限制），
# 不算本次回归；**新**的失败才拦发布。红着红着没人看 = 等于没测，所以要显式登记。
BASELINE_PATH = os.path.join(ROOT, 'tools', 'health-baseline.json')

NODE_SKIP = re.compile(r'(^|/)(dist|node_modules|lib)/(.*min\.js|.*\.min\.js)$')


def run(cmd, timeout=600, cwd=ROOT):
    env = dict(os.environ)
    env.setdefault('PYTHONIOENCODING', 'utf-8')
    env.setdefault('PYTHONUTF8', '1')
    t0 = time.time()
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                           encoding='utf-8', errors='replace', timeout=timeout, env=env)
        return {
            'rc': p.returncode,
            'out': (p.stdout or '') + (p.stderr or ''),
            'dur': time.time() - t0,
            'timeout': False,
        }
    except subprocess.TimeoutExpired as e:
        out = e.stdout or ''
        if isinstance(out, bytes):
            out = out.decode('utf-8', 'replace')
        return {'rc': -1, 'out': out, 'dur': time.time() - t0, 'timeout': True}


def grab_counts(text):
    """从输出里尽量抽「X passed, Y failed / X 通过 / Y 失败 / PASSED X / Y」。"""
    pats = [
        r'(\d+)\s*passed,\s*(\d+)\s*failed',
        r'(\d+)\s*通过\s*/\s*(\d+)\s*失败',
        r'PASSED\s+(\d+)\s*/\s*(\d+)',
        r'(\d+)/(\d+)\s*PASS',
        r'✅\s*通过\s*(\d+)\s*/\s*(\d+)',
    ]
    for p in pats:
        m = re.findall(p, text)
        if m:
            got, total = m[-1]
            # 「X 通过 / Y 失败」是两个独立数，其余是 got/total
            if '失败' in p:
                return int(got), int(got) + int(total)
            return int(got), int(total)
    return None, None


def step(name, fn):
    print('\n' + '-' * 68)
    print('▶', name)
    t0 = time.time()
    ok, detail, extra = fn()
    dur = time.time() - t0
    print(('[PASS] ' if ok else '[FAIL] ') + name + '  %.1fs' % dur + ('  ' + detail if detail else ''))
    return {'name': name, 'ok': ok, 'detail': detail, 'dur': dur, 'extra': extra or {}}


# ---------------- 各步骤 ----------------

def s_syntax():
    bad = []
    files = []
    for base in ('js', 'tools'):
        for dirpath, _dn, fns in os.walk(os.path.join(ROOT, base)):
            for f in fns:
                if f.endswith('.js'):
                    files.append(os.path.join(dirpath, f))
    for f in files:
        r = run(['node', '--check', f], timeout=30)
        if r['rc'] != 0:
            bad.append(os.path.relpath(f, ROOT))
    return (not bad, '%d 个 js 语法正常' % len(files) if not bad else '语法错误：' + ', '.join(bad[:5]),
            {'files': len(files), 'bad': bad})


def s_manifest():
    p = os.path.join(ROOT, 'manifest.json')
    try:
        with open(p, encoding='utf-8') as f:
            m = json.load(f)
    except Exception as e:
        return (False, 'manifest.json 解析失败：%s' % e, {})
    need = ['name', 'version', 'manifest_version']
    miss = [k for k in need if not m.get(k)]
    ok = not miss
    return (ok, 'v%s（MV%s）' % (m.get('version', '?'), m.get('manifest_version', '?')),
            {'missing': miss})


def s_dom_contract():
    r = run([sys.executable, 'tools/check-assert-dom.py'], timeout=180)
    got, total = grab_counts(r['out'])
    ok = r['rc'] == 0
    detail = ('%d 个脚本的 DOM 引用全部有效' % got) if (ok and got) else ('通过' if ok else '有陈旧断言')
    return (ok, detail, {'out': r['out'][-1500:]})


def _unit(path_rel):
    r = run(['node', os.path.join('tools', path_rel)], timeout=180)
    got, total = grab_counts(r['out'])
    return {
        'name': path_rel, 'ok': r['rc'] == 0, 'rc': r['rc'],
        'got': got, 'total': total, 'dur': r['dur'],
        'tail': '\n'.join(r['out'].strip().splitlines()[-2:]),
    }


def s_units(full):
    if full:
        names = sorted(f for f in os.listdir(os.path.join(ROOT, 'tools'))
                       if f.startswith('test-') and f.endswith('.js'))
        if os.path.exists(os.path.join(ROOT, 'tools', 'dedup-test.mjs')):
            names.append('dedup-test.mjs')
    else:
        names = SMOKE_UNITS
    results = [_unit(n) for n in names]
    bad = [x for x in results if not x['ok']]
    total_asserts = sum(x['total'] or 0 for x in results)
    ok = not bad
    detail = '%d/%d 单测脚本通过，%d 条断言' % (len(results) - len(bad), len(results), total_asserts)
    if bad:
        detail += '｜失败：' + ', '.join(x['name'] for x in bad)
    return (ok, detail, {'units': results})


def load_baseline():
    try:
        with open(BASELINE_PATH, encoding='utf-8') as f:
            return json.load(f) or {}
    except Exception:
        return {}


def s_suites(full, live):
    cmd = [sys.executable, 'tools/e2e-all.py', '--isolated',
           '--reason', '健康体检（%s）' % ('全量' if full else '冒烟')]
    if full:
        if live:
            cmd.append('--live')
    else:
        cmd += ['--only', SMOKE_SUITES]
    r = run(cmd, timeout=1800)
    out = r['out']
    # e2e-all 自己会打印批次汇总
    m = re.search(r'批次汇总：(\d+)/(\d+)', out)
    got, total = (int(m.group(1)), int(m.group(2))) if m else (None, None)
    # 只认「批次汇总」里的套件级 FAIL（`  FAIL   e2e-buttons   30/32   56.5s`）。
    # 早先用宽松的 FAIL\s+(\S+) 会把断言名（「抽屉打开」）也当成套件，
    # 于是明明只有 2 个套件红，报告里冒出 10 个「新失败」。
    fails = sorted(set(n for n, _g, _t in re.findall(
        r'^\s+FAIL\s+(\S+)\s+(?:(\d+)/(\d+)|-)\s+[\d.]+s\s*$', out, re.M)))
    known = load_baseline().get('suites') or {}
    known_hit = [f for f in fails if f in known]
    fresh = [f for f in fails if f not in known]
    ok = r['rc'] == 0 or (fails and not fresh)
    detail = ('%s/%s 套件通过' % (got, total)) if got is not None else ('通过' if ok else '未拿到汇总')
    if fresh:
        detail += '｜新失败：' + ', '.join(fresh[:5])
    if known_hit:
        detail += '｜已知失败 %d（见 baseline）' % len(known_hit)
    return (ok, detail, {'tail': out[-2500:], 'fails': fails,
                         'fresh': fresh, 'known': known_hit})


def s_artifact(full):
    dist = os.path.join(ROOT, 'dist')
    has_dist = os.path.isdir(dist) and os.path.exists(os.path.join(dist, 'manifest.json'))
    if not has_dist:
        return (False, 'dist/ 不存在或没构建（发布前必须 build-dist --from-head）', {})
    zip_dir = os.path.join(os.path.dirname(ROOT), 'work', 'vr-release')
    zips = []
    if os.path.isdir(zip_dir):
        zips = sorted([f for f in os.listdir(zip_dir) if f.endswith('.zip')],
                      key=lambda f: os.path.getmtime(os.path.join(zip_dir, f)))
    newest = zips[-1] if zips else ''
    ok = bool(newest) or not full
    detail = 'dist 就绪' + (('，最新包 %s' % newest) if newest else '（还没打包）')
    return (ok, detail, {'dist': has_dist, 'zip': newest})


def main():
    ap = argparse.ArgumentParser(description='一键体检（默认冒烟）')
    ap.add_argument('--full', action='store_true', help='全量回归（发布前）')
    ap.add_argument('--live', action='store_true', help='追加真实站点套件')
    ap.add_argument('--update-baseline', action='store_true',
                    help='把当前失败套件登记为已知失败（需人工确认它们确实不是本次引入）')
    a = ap.parse_args()
    if a.live:
        a.full = True

    t0 = time.time()
    print('=' * 68)
    print('钓鱼竿体检 · %s · %s' % ('全量' if a.full else '冒烟',
                                  datetime.now().strftime('%Y-%m-%d %H:%M')))
    print('=' * 68)

    results = []
    results.append(step('1/5 源码语法（node --check）', s_syntax))
    results.append(step('2/5 manifest 合法性', s_manifest))
    results.append(step('3/5 测试断言契约（防测试腐烂）', s_dom_contract))
    results.append(step('4/5 单元测试（纯逻辑）', lambda: s_units(a.full)))
    results.append(step('5/5 界面套件（隔离实例）', lambda: s_suites(a.full, a.live)))
    results.append(step('附 发布物就绪', lambda: s_artifact(a.full)))

    total_dur = time.time() - t0

    if a.update_baseline:
        suite_res = next((r for r in results if '界面套件' in r['name']), None)
        fails = ((suite_res or {}).get('extra') or {}).get('fails') or []
        cur = load_baseline()
        cur['suites'] = {f: '人工确认于 %s：非本次改动引入' % datetime.now().strftime('%Y-%m-%d %H:%M')
                         for f in fails}
        cur['updated'] = datetime.now().strftime('%Y-%m-%d %H:%M')
        try:
            with open(BASELINE_PATH, 'w', encoding='utf-8', newline='\n') as f:
                json.dump(cur, f, ensure_ascii=False, indent=1)
            print('\n已更新已知失败基线：%d 项（%s）' % (len(fails), ', '.join(fails) or '无'))
        except Exception as e:
            print('基线写入失败：%s' % e)

    bad = [r for r in results if not r['ok']]

    print('\n' + '=' * 68)
    if bad:
        print('结论：不能发（%d 项未过）' % len(bad))
        for r in bad:
            print('  ✗ %s — %s' % (r['name'], r['detail']))
    else:
        print('结论：可以发（%d 项全过）' % len(results))
    print('总用时 %.1fs' % total_dur)
    print('=' * 68)

    # 归档
    try:
        os.makedirs(OUT_DIR, exist_ok=True)
        ts = datetime.now().strftime('%Y-%m-%d-%H%M')
        md = os.path.join(OUT_DIR, 'health-%s.md' % ts)
        lines = [
            '# 健康体检 %s' % ts,
            '',
            '- 档位：%s' % ('全量' + ('（含真实站点）' if a.live else '') if a.full else '冒烟'),
            '- 结论：**%s**' % ('不能发（%d 项未过）' % len(bad) if bad else '可以发'),
            '- 总用时：%.1fs' % total_dur,
            '',
            '| 步骤 | 结果 | 说明 | 用时(s) |',
            '|---|---|---|---|',
        ]
        for r in results:
            lines.append('| %s | %s | %s | %.1f |' % (
                r['name'], 'PASS' if r['ok'] else 'FAIL', r['detail'].replace('|', '/'), r['dur']))
        if bad:
            lines += ['', '## 失败明细']
            for r in bad:
                lines.append('### %s' % r['name'])
                lines.append('```')
                lines.append(str(r['extra'])[:3000])
                lines.append('```')
        with open(md, 'w', encoding='utf-8', newline='\n') as f:
            f.write('\n'.join(lines) + '\n')
        with open(md.replace('.md', '.json'), 'w', encoding='utf-8', newline='\n') as f:
            json.dump({'at': ts, 'full': a.full, 'live': a.live,
                       'ok': not bad, 'results': results}, f, ensure_ascii=False, indent=1)
        print('报告：%s' % os.path.relpath(md, ROOT))
    except Exception as e:
        print('（报告写入失败：%s）' % e)

    return 0 if not bad else 1


if __name__ == '__main__':
    sys.exit(main())
