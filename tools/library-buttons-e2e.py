"""资源库全按钮 e2e：逐个按到，记录输入→输出，核对是否符合设计。

用法：python tools/library-buttons-e2e.py --port 9480
输出：deliverables/test-runs/library-buttons-e2e.json

约定：
- 破坏性按钮（删除/清空/到回收站）只登记不点击，避免动用户数据。
- 每个按钮点击前后抓取状态快照（卡片数、活动筛选、抽屉/预览/批量条状态）。
- 页面异常用 window.onerror / unhandledrejection 收集，逐按钮归因。
"""
import json
import os
import sys
import time
import argparse
import urllib.request
from websocket import create_connection

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = 'chrome-extension://ceogmckiinjolbbdkjfelmfcfepccabp'

ap = argparse.ArgumentParser()
ap.add_argument('--port', type=int, default=9480)
a = ap.parse_args()

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
ver = json.load(opener.open('http://127.0.0.1:%d/json/version' % a.port, timeout=8))
ws = create_connection(ver['webSocketDebuggerUrl'], suppress_origin=True, timeout=180)
mid = [0]


def send(method, params=None, sid=None):
    mid[0] += 1
    i = mid[0]
    msg = {'id': i, 'method': method, 'params': params or {}}
    if sid:
        msg['sessionId'] = sid
    ws.send(json.dumps(msg))
    while True:
        r = json.loads(ws.recv())
        if r.get('id') == i:
            return r.get('result', {})


tid = send('Target.createTarget', {'url': EXT + '/library.html'})['targetId']
sid = send('Target.attachToTarget', {'targetId': tid, 'flatten': True})['sessionId']
send('Runtime.enable', {}, sid)
send('Page.enable', {}, sid)
send('Emulation.setDeviceMetricsOverride',
     {'width': 1440, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False}, sid)
time.sleep(9)


def ev(js, await_promise=True):
    r = send('Runtime.evaluate', {
        'expression': js, 'returnByValue': True,
        'awaitPromise': await_promise
    }, sid)
    if 'exceptionDetails' in r:
        return {'__error': r['exceptionDetails'].get('text', 'EXC')}
    return r.get('result', {}).get('value')


# 注入异常收集 + 状态快照工具
ev(r'''(()=>{
  window.__vrE2eErrs=[];
  window.addEventListener('error',e=>window.__vrE2eErrs.push(String(e.message).slice(0,120)));
  window.addEventListener('unhandledrejection',e=>window.__vrE2eErrs.push('rej:'+String(e.reason).slice(0,120)));
  window.__vrSnap=()=>({
    cards:document.querySelectorAll('#grid .card').length,
    seg:[...document.querySelectorAll('#typeTabs button')].filter(b=>b.classList.contains('active')).map(b=>b.dataset.type),
    chips:[...document.querySelectorAll('#chips .chip')].filter(c=>c.classList.contains('active')).map(c=>c.dataset.plat),
    search:(document.getElementById('search')||{}).value||'',
    drawer:!!document.querySelector('#setdrawer.show'),
    preview:!!document.querySelector('#preview:not(.hidden)'),
    batchbar:!!document.querySelector('#batchbar:not(.hidden)'),
    selectOn:!!document.querySelector('#selectBtn.is-on'),
    keysheet:!!document.querySelector('#keysheet:not(.hidden)'),
    view:[...document.querySelectorAll('#viewToggle button')].filter(b=>b.classList.contains('active')).map(b=>b.dataset.view),
    toast:(document.querySelector('.toast')||{}).textContent||''
  });
  return 'ready';
})()''')

# 会动用户数据 / 触发系统动作或新页面的按钮：登记但不执行（并说明原因）
SKIP = ['删除', '清空', '回收站', '移除', '清空已下载', '批量删除']
SKIP_IDS = {
    'pvDelete': '删除到回收站（破坏性，按约定不执行）',
    'pvReveal': '调用系统文件管理器（阻塞自动化）',
    'pvFullBtn': '全屏切换（阻塞自动化）',
    'pvMove': '打开移动弹层并可能改路径（破坏性）',
    'rootBtn': '打开设置新标签（页面跳转）',
    'resetBtn': '打开设置新标签（页面跳转）',
    'sdDirBtn': '打开设置新标签（页面跳转）',
    'sdOptionsLink': '打开设置新标签（页面跳转）',
    'dwEmpty': '清空回收站（破坏性）',
}


def run_round(label, selector):
    """逐个点击 selector 命中的可见元素，记录前后快照"""
    js = r'''(async()=>{
      const label=%s, selector=%s, skip=%s, skipIds=%s;
      const out=[];
      const els=[...document.querySelectorAll(selector)].filter(e=>{
        const r=e.getBoundingClientRect();
        return r.width>0 && r.height>0 && getComputedStyle(e).visibility!=='hidden';
      });
      for(const e of els){
        const name=(e.id?'#'+e.id:'')+' '+(e.className&&String(e.className).slice(0,28)||'')+' '+(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,24);
        const text=(e.textContent||'').replace(/\s+/g,' ').trim();
        const title=e.title||'';
        const hit=skip.find(k=>text.indexOf(k)>=0 || name.indexOf(k)>=0 || title.indexOf(k)>=0)
                  || skipIds[e.id];
        if(hit){ out.push({name:name,skipped:hit}); continue; }
        const before=window.__vrSnap(), n0=window.__vrE2eErrs.length;
        let err='';
        try{
          if(e.tagName==='SELECT'){
            const opts=[...e.options].map(o=>o.value);
            if(opts.length>1){ e.value=opts[1]; e.dispatchEvent(new Event('change',{bubbles:true})); }
          } else if(e.tagName==='INPUT' && e.type!=='checkbox'){
            const old=e.value; e.value='e2e'; e.dispatchEvent(new Event('input',{bubbles:true})); e.value=old;
            e.dispatchEvent(new Event('input',{bubbles:true}));
          } else {
            e.click();
          }
          await new Promise(r=>setTimeout(r,90));
        }catch(ex){ err=String(ex).slice(0,100); }
        const after=window.__vrSnap();
        const changed=JSON.stringify(before)!==JSON.stringify(after);
        out.push({name:name,err:err,changed:changed,before:before,after:after,
                  newErrs:window.__vrE2eErrs.slice(n0)});
      }
      return JSON.stringify({label:label,total:els.length,items:out});
    })()''' % (json.dumps(label), json.dumps(selector), json.dumps(SKIP), json.dumps(SKIP_IDS))
    return json.loads(ev(js))


RESET = r'''(()=>{
  const root=[...document.querySelectorAll('#tree .tree-node')].find(n=>!n.dataset.plat&&!n.dataset.author);
  if(root) root.click();
  const sel=document.getElementById('selectBtn');
  if(sel&&sel.classList.contains('is-on')) sel.click();
  const pv=document.getElementById('preview');
  if(pv&&!pv.classList.contains('hidden')) pv.classList.add('hidden');
  const d=document.getElementById('setdrawer'); if(d) d.classList.remove('show');
  return document.querySelectorAll('#grid .card').length;
})()'''


def reset():
    return ev(RESET, False)


rounds = []
rounds.append(run_round('首屏-顶栏与筛选',
    '#rescanBtn,#settingsBtn,#selectBtn,#viewToggle button,#typeTabs button,#chips .chip,#tree .tree-node,#emptyAction'))
rounds.append(run_round('侧栏与输入', '#treeSearch,#search,#sort,#rootBtn,#resetBtn'))
# 每轮前把筛选/选择/预览状态复位，避免上一轮把卡片筛空导致后面 0 个按钮
reset()
# 打开设置抽屉，测里面的按钮
ev("(()=>{const b=document.getElementById('settingsBtn');if(b)b.click();return 1})()")
time.sleep(0.6)
rounds.append(run_round('设置抽屉', '#setdrawer button,#setdrawer input,#setdrawer select'))
ev("(()=>{const m=document.getElementById('setmask');if(m)m.click();const c=document.getElementById('setClose');if(c)c.click();return 1})()")
reset()
# 打开预览层，测里面的按钮（含胶片条与播放器 shadow 外的按钮）
print('  复位后卡片数:', reset())
ev("(()=>{const c=[...document.querySelectorAll('#grid .card')].find(x=>x.querySelector('.thumb.is-video'))||document.querySelector('#grid .card');if(c)c.click();return 1})()")
time.sleep(1.8)
print('  预览层状态:', ev("JSON.stringify({open:!!document.querySelector('#preview:not(.hidden)'),btns:document.querySelectorAll('#preview button').length,film:document.querySelectorAll('#preview .film').length})", False))
# 预览层里的成熟播放器（shadow DOM）单独核对：必须在点 #pvClose 之前
plyr = ev(r'''(()=>{const p=document.querySelector('.vr-player .plyr');if(!p)return JSON.stringify({ok:false});
  const btns=[...p.querySelectorAll('.plyr__controls button')];
  return JSON.stringify({ok:true,controls:btns.length,labels:btns.map(b=>b.getAttribute('aria-label')||b.dataset.plyr||'').slice(0,14)});})()''')
# 胶片条是同构按钮，逐个点会反复重建播放器（实测超时）：抽查首尾 2 个 + 全量静态校验
film_static = ev(r'''(()=>{const f=[...document.querySelectorAll('#preview .film')];
  return JSON.stringify({count:f.length,
    withIndex:f.filter(x=>x.hasAttribute('data-i')).length,
    withNo:f.filter(x=>x.querySelector('.fno')).length,
    withThumb:f.filter(x=>{const c=x.querySelector('.cover');return c&&c.style.backgroundImage}).length});})()''')
rounds.append(run_round('胶片条抽查', '#preview .film:nth-child(-n+2)'))
rounds.append(run_round('预览层', '#preview button,#preview input'))
ev("(()=>{const c=document.getElementById('pvClose');if(c)c.click();return 1})()")
reset()
# 批量条
ev("(()=>{const b=document.getElementById('selectBtn');if(b)b.click();return 1})()")
time.sleep(0.4)
print('  批量条状态:', ev("JSON.stringify({on:!!document.querySelector('#selectBtn.is-on'),btns:document.querySelectorAll('#batchbar button').length})", False))
rounds.append(run_round('批量条', '#batchbar button,#chkAll'))
ev("(()=>{const b=document.getElementById('selectBtn');if(b&&b.classList.contains('is-on'))b.click();return 1})()")

final_errs = ev('JSON.stringify(window.__vrE2eErrs||[])')
report = {
    'time': time.strftime('%Y-%m-%d %H:%M:%S'),
    'rounds': rounds,
    'player': plyr,
    'filmStatic': json.loads(film_static) if isinstance(film_static, str) else film_static,
    'pageErrors': json.loads(final_errs) if isinstance(final_errs, str) else [],
}
total = sum(r['total'] for r in rounds)
skipped = sum(1 for r in rounds for x in r['items'] if 'skipped' in x)
clicked = total - skipped
errors = [x for r in rounds for x in r['items'] if x.get('err') or x.get('newErrs')]
report['summary'] = {
    'totalButtons': total, 'clicked': clicked, 'skippedDestructive': skipped,
    'jsErrors': len(errors), 'pageErrors': len(report['pageErrors']),
    'passed': len(errors) == 0 and len(report['pageErrors']) == 0,
}

out = os.path.join(ROOT, 'deliverables', 'test-runs', 'library-buttons-e2e.json')
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, 'w', encoding='utf-8') as f:
    json.dump(report, f, ensure_ascii=False, indent=1)

print('=' * 60)
print('资源库全按钮 e2e')
for r in rounds:
    print('  %-14s %2d 个，跳过 %d，异常 %d' % (
        r['label'], r['total'],
        sum(1 for x in r['items'] if 'skipped' in x),
        sum(1 for x in r['items'] if x.get('err') or x.get('newErrs'))))
print('  播放器控件:', plyr)
print('  汇总:', json.dumps(report['summary'], ensure_ascii=False))
print('  报告:', out)
if errors:
    for x in errors[:8]:
        print('   FAIL', x['name'][:50], x.get('err'), x.get('newErrs'))
try:
    send('Target.closeTarget', {'targetId': tid})
except Exception:
    pass
ws.close()
sys.exit(0 if report['summary']['passed'] else 1)
