// 页面模块：批谱、待核、判定、存档 四个视图分别承载

export function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>蓝晒整理室 · 批谱</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; --pending:#b5791b; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:18px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; flex-wrap:wrap; }
    h1 { margin:0; font-size:22px; } h2 { margin:0 0 12px; font-size:17px; } h3 { margin:0 0 8px; font-size:15px; }
    nav { display:flex; gap:6px; flex-wrap:wrap; } nav button { background:#eef1ea; color:var(--ink); border:1px solid var(--line); padding:8px 14px; border-radius:6px; cursor:pointer; font-weight:600; } nav button.active { background:var(--accent); color:#fff; border-color:var(--accent); }
    main { padding:22px 28px; }
    .panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; margin-bottom:16px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; }
    .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; display:grid; gap:6px; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:2px 8px; font-size:12px; }
    .pill.ok { background:#e6efe0; color:var(--accent); border-color:var(--accent); } .pill.warn { background:#f6e3de; color:var(--warn); border-color:var(--warn); } .pill.pending { background:#f7eedc; color:var(--pending); border-color:var(--pending); }
    label { display:block; margin:8px 0 4px; color:var(--muted); font-size:13px; } input,select { width:100%; border:1px solid var(--line); border-radius:6px; padding:8px; font:inherit; background:#fff; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:9px 14px; font-weight:700; cursor:pointer; } button.secondary { background:#69736a; } button.small { padding:5px 9px; font-size:12px; }
    .row { display:flex; gap:8px; flex-wrap:wrap; align-items:flex-end; } .row > div { flex:1; min-width:140px; }
    table { width:100%; border-collapse:collapse; font-size:14px; } th,td { text-align:left; padding:7px 8px; border-bottom:1px solid var(--line); } th { color:var(--muted); font-weight:600; }
    .chain { display:flex; gap:8px; align-items:center; flex-wrap:wrap; } .chain .arrow { color:var(--muted); }
    .warn { color:var(--warn); font-weight:700; } .muted { color:var(--muted); }
    .hidden { display:none; }
  </style>
</head>
<body>
  <header>
    <div><h1>蓝晒整理室 · 批谱</h1><div class="meta">回收液 → 再生缸 → 玻璃板 一条链</div></div>
    <nav>
      <button data-view="spectrum" class="active">批谱</button>
      <button data-view="pending">待核</button>
      <button data-view="judgment">判定</button>
      <button data-view="archive">存档</button>
    </nav>
  </header>
  <main>
    <section id="view-spectrum">
      <div class="panel">
        <h2>新增回流单</h2>
        <div class="row">
          <div><label>来源桶</label><input id="rf-source" placeholder="如 回收桶A-07"></div>
          <div><label>实测浓度</label><input id="rf-conc" type="number" placeholder="如 12.5"></div>
          <div><label>重量(kg)</label><input id="rf-weight" type="number" placeholder="如 3.2"></div>
          <div><label>读数人</label><input id="rf-by" placeholder="如 张师傅"></div>
          <div><button id="rf-submit">记录回流</button></div>
        </div>
      </div>
      <div class="panel">
        <h2>批谱链</h2><div id="spectrum-list" class="grid"></div>
      </div>
      <div class="panel">
        <h2>回流单</h2><div id="reflux-list"></div>
      </div>
      <div class="panel">
        <h2>再生缸</h2><div id="tank-list"></div>
      </div>
      <div class="panel">
        <h2>玻璃板</h2><div id="plate-list"></div>
      </div>
    </section>

    <section id="view-pending" class="hidden">
      <div class="panel"><h2>待核读数（后到值留待核）</h2><div id="pending-readings"></div></div>
      <div class="panel"><h2>待重算（浓度/配比变更后失效）</h2><div id="pending-recalc"></div></div>
    </section>

    <section id="view-judgment" class="hidden">
      <div class="panel"><h2>判定结果</h2><div id="judgment-list"></div></div>
    </section>

    <section id="view-archive" class="hidden">
      <div class="panel"><h2>存档（旧履历仍可追查）</h2><div id="archive-list"></div></div>
    </section>
  </main>

<script>
const api = async (path, opts) => {
  const res = await fetch(path, opts && opts.body ? { ...opts, headers:{'Content-Type':'application/json'} } : opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
};
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&','<':'<','>':'>','"':'"'}[c]));
const fmt = v => v === undefined || v === null ? '—' : v;

async function loadSpectrum() {
  const [spectrum, reflux, tanks, plates] = await Promise.all([
    api('/api/spectrum'), api('/api/reflux'), api('/api/tanks'), api('/api/plates')
  ]);
  document.querySelector('#spectrum-list').innerHTML = spectrum.length ? spectrum.map(sp => {
    const o = sp.order, t = sp.tank;
    return '<div class="card"><div class="chain"><span class="pill">'+esc(o?.source||'?')+'</span><span class="arrow">→</span><span class="pill '+(t?.status==='可用'?'ok':'pending')+'">'+esc(t?.name||'未入缸')+'</span><span class="arrow">→</span><span class="pill">'+(sp.plates?.length||0)+' 块板</span></div>'+
      '<div class="meta">浓度 '+fmt(o?.concentration)+' · 重量 '+fmt(o?.weight)+'kg · 缸版本 v'+fmt(t?.version)+'</div></div>';
  }).join('') : '<div class="meta">暂无批谱</div>';

  document.querySelector('#reflux-list').innerHTML = reflux.length ? '<table><thead><tr><th>来源桶</th><th>浓度</th><th>重量</th><th>读数</th><th>状态</th><th>操作</th></tr></thead><tbody>'+reflux.map(o => {
    const pending = (o.readings||[]).filter(r=>r.pending).length;
    return '<tr><td>'+esc(o.source)+'</td><td>'+fmt(o.concentration)+'</td><td>'+fmt(o.weight)+'</td><td>'+(o.readings||[]).length+' 条'+(pending?' · <span class="warn">待核'+pending+'</span>':'')+'</td><td>'+esc(o.status||'待核')+'</td>'+
      '<td><button class="small secondary" data-reading="'+o.id+'">补读数</button> <button class="small" data-confirm="'+o.id+'">确认入缸</button></td></tr>';
  }).join('')+'</tbody></table>' : '<div class="meta">暂无回流单</div>';

  document.querySelector('#tank-list').innerHTML = tanks.length ? tanks.map(t => {
    const left = (t.availableWeight||0) - (t.usedWeight||0);
    return '<div class="card"><h3>'+esc(t.name)+' <span class="pill '+(t.status==='可用'?'ok':'pending')+'">'+esc(t.status)+'</span></h3>'+
      '<div class="meta">配比 '+esc(t.ratio||'—')+' · 目标浓度 '+fmt(t.targetConcentration)+' · 版本 v'+fmt(t.version)+'</div>'+
      '<div class="meta">可用 '+fmt(t.availableWeight)+'kg · 已用 '+fmt(t.usedWeight)+'kg · 剩余 '+fmt(left)+'kg</div>'+
      '<div class="row"><div><label>新配比</label><input id="ratio-'+t.id+'" placeholder="如 1:2"></div>'+
      '<div><label>新目标浓度</label><input id="conc-'+t.id+'" type="number" placeholder="如 10"></div>'+
      '<div><button class="small" data-ratio="'+t.id+'">改配比</button></div></div>'+
      '<div class="row"><div><label>倒缸确认(幂等)</label><input id="op-'+t.id+'" placeholder="现场单号"></div>'+
      '<div><button class="small" data-pour="'+t.id+'">倒缸确认</button></div></div></div>';
  }).join('') : '<div class="meta">暂无再生缸</div>';

  document.querySelector('#plate-list').innerHTML = plates.length ? plates.map(p => {
    const c = p.conclusion||{}, b = p.boxPermit||{};
    return '<div class="card"><h3>'+esc(p.code||p.id)+'</h3>'+
      '<div class="meta">用液 '+fmt(p.usedWeight)+'kg · 缸版本 v'+fmt(c.tankVersion)+'</div>'+
      '<div>冲洗结论：<span class="pill '+(c.valid?'ok':'warn')+'">'+esc(c.text||'—')+'</span></div>'+
      '<div>入盒许可：<span class="pill '+(b.valid?'ok':'warn')+'">'+esc(b.text||'—')+'</span></div>'+
      (c.pendingRecalc||b.pendingRecalc ? '<button class="small" data-recalc="'+p.id+'">重算</button>' : '')+
      '<div class="meta">履历 '+(p.history||[]).length+' 条</div></div>';
  }).join('') : '<div class="meta">暂无玻璃板</div>';

  document.querySelectorAll('[data-reading]').forEach(b => b.onclick = async () => {
    const by = prompt('读数人'), conc = prompt('实测浓度'), w = prompt('重量(kg)');
    if (conc && w) { await api('/api/reflux/'+b.dataset.reading+'/readings', { method:'POST', body: JSON.stringify({ by, concentration: conc, weight: w }) }); await loadAll(); }
  });
  document.querySelectorAll('[data-confirm]').forEach(b => b.onclick = async () => {
    const tankId = prompt('进入哪个再生缸(缸号)');
    if (tankId) { await api('/api/reflux/'+b.dataset.confirm+'/confirm', { method:'POST', body: JSON.stringify({ tankId }) }); await loadAll(); }
  });
  document.querySelectorAll('[data-pour]').forEach(b => b.onclick = async () => {
    const opId = document.querySelector('#op-'+b.dataset.pour).value || ('pour-'+Date.now());
    await api('/api/tanks/'+b.dataset.pour+'/pour', { method:'POST', body: JSON.stringify({ opId }) }); await loadAll();
  });
  document.querySelectorAll('[data-ratio]').forEach(b => b.onclick = async () => {
    const ratio = document.querySelector('#ratio-'+b.dataset.ratio).value;
    const conc = document.querySelector('#conc-'+b.dataset.ratio).value;
    await api('/api/tanks/'+b.dataset.ratio+'/ratio', { method:'PATCH', body: JSON.stringify({ ratio, targetConcentration: conc }) }); await loadAll();
  });
  document.querySelectorAll('[data-recalc]').forEach(b => b.onclick = async () => {
    await api('/api/plates/'+b.dataset.recalc+'/recalc', { method:'POST' }); await loadAll();
  });
}

async function loadPending() {
  const data = await api('/api/pending');
  document.querySelector('#pending-readings').innerHTML = (data.readings||[]).length ? '<table><thead><tr><th>回流单</th><th>来源桶</th><th>读数人</th><th>浓度</th><th>重量</th><th>状态</th></tr></thead><tbody>'+data.readings.map(r=>'<tr><td>'+esc(r.orderId)+'</td><td>'+esc(r.source)+'</td><td>'+esc(r.reading.by)+'</td><td>'+fmt(r.reading.concentration)+'</td><td>'+fmt(r.reading.weight)+'</td><td><span class="pill pending">待核</span></td></tr>').join('')+'</tbody></table>' : '<div class="meta">无待核读数</div>';
  document.querySelector('#pending-recalc').innerHTML = (data.recalc||[]).length ? data.recalc.map(p=>'<div class="card"><h3>'+esc(p.code||p.id)+'</h3><div class="warn">浓度/配比已变更，结论待重算</div><button class="small" data-recalc2="'+p.id+'">重算</button></div>').join('') : '<div class="meta">无待重算</div>';
  document.querySelectorAll('[data-recalc2]').forEach(b => b.onclick = async () => { await api('/api/plates/'+b.dataset.recalc2+'/recalc', { method:'POST' }); await loadAll(); });
}

async function loadJudgment() {
  const plates = await api('/api/plates');
  document.querySelector('#judgment-list').innerHTML = plates.length ? plates.map(p => {
    const c = p.conclusion||{}, b = p.boxPermit||{};
    return '<div class="card"><h3>'+esc(p.code||p.id)+'</h3>'+
      '<div>冲洗结论：<span class="pill '+(c.valid?'ok':'warn')+'">'+esc(c.text||'—')+'</span> <span class="meta">v'+fmt(c.tankVersion)+(c.recalcAt?' · 重算于 '+esc(c.recalcAt.slice(0,10)):'')+'</span></div>'+
      '<div>入盒许可：<span class="pill '+(b.valid?'ok':'warn')+'">'+esc(b.text||'—')+'</span> <span class="meta">v'+fmt(b.tankVersion)+(b.recalcAt?' · 重算于 '+esc(b.recalcAt.slice(0,10)):'')+'</span></div></div>';
  }).join('') : '<div class="meta">暂无判定</div>';
}

async function loadArchive() {
  const data = await api('/api/archive');
  document.querySelector('#archive-list').innerHTML = (data.archive||[]).length ? '<table><thead><tr><th>时间</th><th>类型</th><th>对象</th><th>内容</th></tr></thead><tbody>'+data.archive.map(a=>'<tr><td>'+esc((a.archivedAt||'').slice(0,19))+'</td><td>'+esc(a.type)+'</td><td>'+esc(a.plateId||a.orderId||a.tankId||'')+'</td><td class="meta">'+esc(a.reason||JSON.stringify(a.conclusion||''))+'</td></tr>').join('')+'</tbody></table>' : '<div class="meta">暂无存档</div>';
}

async function loadAll() {
  await loadSpectrum();
  const view = document.querySelector('nav button.active').dataset.view;
  if (view==='pending') await loadPending();
  if (view==='judgment') await loadJudgment();
  if (view==='archive') await loadArchive();
}

document.querySelector('#rf-submit').onclick = async () => {
  const source = document.querySelector('#rf-source').value.trim();
  const concentration = document.querySelector('#rf-conc').value;
  const weight = document.querySelector('#rf-weight').value;
  const by = document.querySelector('#rf-by').value.trim();
  if (!source || !concentration || !weight) return alert('请填来源桶、浓度和重量');
  try { await api('/api/reflux', { method:'POST', body: JSON.stringify({ source, concentration, weight, by }) }); }
  catch(e) { alert(e.message); return; }
  document.querySelector('#rf-source').value=''; document.querySelector('#rf-conc').value=''; document.querySelector('#rf-weight').value=''; document.querySelector('#rf-by').value='';
  await loadAll();
};

document.querySelectorAll('nav button').forEach(b => b.onclick = async () => {
  document.querySelectorAll('nav button').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  document.querySelectorAll('main section').forEach(s=>s.classList.add('hidden'));
  document.querySelector('#view-'+b.dataset.view).classList.remove('hidden');
  if (b.dataset.view==='pending') await loadPending();
  if (b.dataset.view==='judgment') await loadJudgment();
  if (b.dataset.view==='archive') await loadArchive();
});

loadAll();
</script>
</body>
</html>`;
}
