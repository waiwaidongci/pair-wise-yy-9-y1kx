// 页面层:只负责展示和表单,判定与存档都在别的层。
// 页面分四块看账:批谱(回收液→再生缸→玻璃板)、待核读数、判定与重算结果、底片卡。
export function page() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>古法蓝晒底片整理室</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#20241f; --muted:#687066; --line:#d4ddd0; --accent:#526f43; --warn:#9b4937; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } h3 { margin:0; font-size:16px; }
    main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    form { margin-bottom:14px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; }
    input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; } textarea { min-height:68px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; margin-top:10px; } button.secondary { background:#69736a; }
    .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; }
    .toolbar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; } .toolbar select,.toolbar input { width:auto; min-width:160px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; } .card { display:grid; gap:8px; align-content:start; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .logs { border-top:1px solid var(--line); padding-top:8px; max-height:120px; overflow:auto; } .warn { color:var(--warn); font-weight:700; }
    .ok { color:var(--accent); font-weight:700; } .dead { opacity:.55; } .panel { margin-bottom:14px; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} }
  </style>
</head>
<body>
  <header><div><h1>古法蓝晒底片整理室</h1><div class="meta">回收液、再生缸与玻璃板接成一条批谱 · 判定与存档分离 · 写盘失败按现场单重试</div></div><button id="reload">刷新</button></header>
  <main>
    <section>
      <form id="createForm"><h2>新增底片</h2><div id="fields"></div><label>初始状态</label><select name="status" id="statusSelect"></select><button>保存底片</button></form>
      <form id="actionForm"><h2>记录工艺步骤</h2><label>选择底片</label><select name="id" id="itemSelect"></select><div id="extraFields"></div><button>提交记录</button></form>
      <form id="liquidForm"><h2>登记回收液</h2><label>来源(桶/缸)</label><input name="source" required><label>实测浓度</label><input name="concentration" type="number" step="0.001" min="0" required><label>重量 kg</label><input name="weightKg" type="number" step="0.1" min="0" required><label>经手人</label><input name="by"><button>登记入库</button></form>
      <form id="slipForm"><h2>提交回流单</h2><div class="meta">同一单号先写入的读数生效,后到值留待核。</div><label>现场单号</label><input name="slipId" required><label>来源</label><input name="source" required><label>实测浓度</label><input name="concentration" type="number" step="0.001" min="0" required><label>重量 kg</label><input name="weightKg" type="number" step="0.1" min="0" required><label>经手人</label><input name="by"><label>回流去向</label><select name="targetBatchId" id="slipBatchId"></select><button>提交回流单</button></form>
      <form id="mixForm"><h2>再配再生缸</h2><div class="meta">抽液即扣来源余量;倒缸确认前不计入可用量。</div><label>配比</label><input name="ratio" placeholder="如 2:1" required><label>目标浓度</label><input name="targetConcentration" type="number" step="0.001" min="0" required><label>经手人</label><input name="by"><div id="drawList"></div><button>配料开缸</button></form>
      <form id="reviseForm"><h2>修订批次</h2><div class="meta">浓度或配比一改,相关冲洗结论与入盒许可立即失效重算。</div><label>批次</label><select id="revBatchId"></select><label>新目标浓度(可空)</label><input name="targetConcentration" type="number" step="0.001" min="0"><label>新实测浓度(可空)</label><input name="measuredConcentration" type="number" step="0.001" min="0"><label>新配比(可空)</label><input name="ratio"><label>修订原因</label><input name="reason"><button>修订并重算</button></form>
    </section>
    <section>
      <div class="stats" id="stats"></div>
      <div class="stats" id="avail"></div>
      <div class="panel"><h2>批谱 · 再生缸</h2><div class="grid" id="batches"></div></div>
      <div class="panel"><h2>回收液库存</h2><div class="grid" id="liquids"></div></div>
      <div class="panel"><h2>待核读数</h2><div class="grid" id="pending"></div></div>
      <div class="panel"><h2>判定与重算结果</h2><div class="grid" id="conclusions"></div></div>
      <div class="toolbar"><select id="statusFilter"><option value="">全部状态</option></select><input id="search" placeholder="搜索编号或关键词"></div>
      <div class="panel"><h2>玻璃板底片</h2><div class="grid" id="cards"></div></div>
    </section>
  </main>
  <script>
    const fields = [["code","底片编号","text"],["plateSize","玻璃板尺寸","text"],["chemicalBatch","药液批次","text"],["exposure","曝光时间","text"],["waterSource","冲洗水源","text"],["box","存放盒位","text"]];
    const stages = ["待曝光","冲洗中","待入盒","已交付"];
    const extraFields = [["step","步骤"],["developStatus","显影状态"],["defect","缺陷类型"],["repair","修补记录"],["note","备注"]];
    const $ = s => document.querySelector(s);
    let items = [], lineage = { availability: {}, batches: [], liquids: [] }, pending = [], conclusions = [];
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ "Content-Type":"application/json" } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "请求失败");
      return data;
    }
    // 现场单号:提交失败保留原号,按同一单重试不会重复扣量;成功后换新号。
    const rid = () => "REQ-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    function bindForm(selector, url, buildBody, method) {
      const form = $(selector);
      form._rid = rid();
      form.onsubmit = async event => {
        event.preventDefault();
        try {
          const body = buildBody(new FormData(form));
          body.requestId = form._rid;
          await api(typeof url === "function" ? url() : url, { method: method || "POST", body: JSON.stringify(body) });
          form._rid = rid();
          form.reset();
          await loadAll();
        } catch (error) {
          alert(error.message + "\\n可按同一现场单号重试,液量不会重复扣。");
        }
      };
    }
    const obj = fd => Object.fromEntries(fd.entries());
    function renderForms() {
      $("#fields").innerHTML = fields.map(([key,label,type]) => "<label>"+label+"</label><input name='"+key+"' type='"+type+"' "+(key==="code"?"required":"")+">").join("");
      $("#extraFields").innerHTML = extraFields.map(([key,label]) => "<label>"+label+"</label><input name='"+key+"'>").join("");
      $("#statusSelect").innerHTML = stages.map(s => "<option>"+s+"</option>").join("");
      $("#statusFilter").innerHTML = '<option value="">全部状态</option>' + stages.map(s => "<option>"+s+"</option>").join("");
    }
    async function loadAll() {
      const [a, b, c, d] = await Promise.all([api("/api/items"), api("/api/lineage"), api("/api/pending"), api("/api/conclusions")]);
      items = a; lineage = b; pending = c; conclusions = d;
      render();
    }
    function render() {
      $("#itemSelect").innerHTML = items.map(item => '<option value="'+(item.id || item.code)+'">'+(item.code || item.id)+" · "+(item.plateSize || "")+"</option>").join("");
      const batchOpts = lineage.batches.map(b => '<option value="'+b.id+'">'+b.id+" · "+b.status+" · 修订#"+b.revision+"</option>").join("");
      $("#revBatchId").innerHTML = batchOpts;
      $("#slipBatchId").innerHTML = '<option value="">入库存为新回收液</option>' + batchOpts;
      $("#drawList").innerHTML = lineage.liquids.length
        ? lineage.liquids.map(l => "<label>"+l.id+" · "+l.source+" · 余 "+l.remainingKg+"kg</label><input name='draw_"+l.id+"' type='number' step='0.1' min='0' placeholder='抽取 kg(留空不抽)'>").join("")
        : '<div class="meta">暂无在库回收液,请先登记。</div>';
      renderStats(); renderAvail(); renderBatches(); renderLiquids(); renderPending(); renderConclusions(); renderCards();
      bindDynamic();
    }
    function renderStats() {
      const stats = Object.fromEntries(stages.map(s => [s, items.filter(i => i.status === s).length]));
      $("#stats").innerHTML = Object.entries(stats).map(([k,v]) => '<div class="stat"><span>'+k+"</span><strong>"+v+"</strong></div>").join("");
    }
    function renderAvail() {
      const a = lineage.availability;
      $("#avail").innerHTML = [["在库回收液", a.inStock], ["再生缸可用", a.inTanks], ["配制中(不计入)", a.mixing], ["合计可用", a.usable]]
        .map(([k,v]) => '<div class="stat"><span>'+k+'</span><strong>'+(v ?? 0)+"kg</strong></div>").join("");
    }
    function renderBatches() {
      $("#batches").innerHTML = lineage.batches.map(b => {
        const comps = b.components.length
          ? b.components.map(c => "<div>↳ "+c.liquidId+"("+c.source+") 抽 "+c.drawnKg+"kg</div>").join("")
          : '<div class="meta">旧档批次,无组分记录</div>';
        const stagesHtml = b.stages.map(s => '<div class="meta">'+s.step+" · "+s.by+" · "+String(s.at||"").slice(0,16).replace("T"," ")+"</div>").join("");
        const plates = b.plates.length ? b.plates.map(p => '<span class="pill">'+p.code+" "+p.status+"</span>").join(" ") : '<span class="meta">暂无玻璃板</span>';
        const hist = (b.history || []).map(h => '<div class="meta">修订#'+h.revision+": 目标"+h.targetConcentration+(h.measuredConcentration != null ? " 实测"+h.measuredConcentration : "")+" 配比"+h.ratio+" · "+(h.reason || "")+"</div>").join("");
        const pourBtn = b.status === "配制中" ? '<button data-pour="'+b.id+'">倒缸确认</button>' : "";
        return '<article class="card"><h3>'+b.id+' <span class="pill">'+b.status+'</span> <span class="pill">修订#'+b.revision+"</span></h3>"
          + "<div>配比 "+b.ratio+" · 目标浓度 "+b.targetConcentration+(b.measuredConcentration != null ? " · 实测 "+b.measuredConcentration : "")+"</div>"
          + "<div>总量 "+b.totalKg+"kg · 可用 "+b.availableKg+"kg</div>" + comps
          + "<div>"+plates+"</div>"
          + '<div class="meta">结论:生效 '+b.activeConclusions+" · 已失效 "+b.invalidatedConclusions+"</div>"
          + stagesHtml + pourBtn + (hist ? '<div class="logs">'+hist+"</div>" : "") + "</article>";
      }).join("") || '<div class="meta">暂无批次</div>';
    }
    function renderLiquids() {
      $("#liquids").innerHTML = lineage.liquids.map(l =>
        '<article class="card"><h3>'+l.id+' <span class="pill">'+l.status+"</span></h3>"
        + "<div>来源 "+l.source+(l.slipId ? " · 回流单 "+l.slipId : "")+"</div>"
        + "<div>实测浓度 "+l.concentration+" · 入库 "+l.weightKg+"kg · 余量 "+l.remainingKg+"kg</div></article>"
      ).join("") || '<div class="meta">暂无回收液</div>';
    }
    function renderPending() {
      $("#pending").innerHTML = pending.map(p =>
        '<article class="card"><h3>回流单 '+p.slipId+' <span class="pill warn">待核</span></h3>'
        + "<div>读数 "+p.id+":浓度 "+p.concentration+" · "+p.weightKg+"kg · "+p.by+"</div>"
        + '<div class="meta">提交于 '+String(p.at).slice(0,16).replace("T"," ")+"</div>"
        + '<div><button data-adopt="'+p.slipId+"|"+p.id+'">采纳</button> <button class="secondary" data-reject="'+p.slipId+"|"+p.id+'">驳回</button></div></article>'
      ).join("") || '<div class="meta">暂无待核读数</div>';
    }
    function renderConclusions() {
      $("#conclusions").innerHTML = conclusions.slice(0, 30).map(c =>
        '<article class="card'+(c.state === "已失效" ? " dead" : "")+'"><h3>'+c.itemCode+' <span class="pill">'+c.state+"</span></h3>"
        + "<div>批次 "+c.batchId+"#"+c.batchRevision+" · 浓度 "+c.concentration+"</div>"
        + '<div>冲洗:<b class="'+(c.wash === "合格" ? "ok" : "warn")+'">'+c.wash+"</b> · 入盒:<b>"+c.boxPermit+"</b></div>"
        + '<div class="meta">'+c.reason+(c.invalidateReason ? " · 失效原因:"+c.invalidateReason : "")+" · "+String(c.computedAt).slice(0,16).replace("T"," ")+"</div></article>"
      ).join("") || '<div class="meta">暂无判定</div>';
    }
    function renderCards() {
      const status = $("#statusFilter").value;
      const q = $("#search").value.trim();
      const visible = items.filter(item => (!status || item.status === status) && (!q || JSON.stringify(item).includes(q)));
      $("#cards").innerHTML = visible.map(item => {
        const main = fields.slice(0,4).map(([key,label]) => "<div><b>"+label+"</b> "+(item[key] ?? "")+"</div>").join("");
        const logs = (item.logs || []).slice(-4).map(l => "<div>"+l.step+":"+l.note+"</div>").join("");
        const concl = conclusions.find(c => c.itemCode === item.code && c.state === "生效");
        const conclHtml = concl ? '<div><span class="pill">冲洗 '+concl.wash+" · 入盒 "+concl.boxPermit+"</span></div>" : "";
        return '<article class="card"><h3>'+(item.code || item.id)+'</h3><span class="pill">'+item.status+"</span>"+main+conclHtml
          + '<label>状态</label><select data-status="'+(item.id || item.code)+'">'+stages.map(s => "<option "+(s===item.status?"selected":"")+">"+s+"</option>").join("")+"</select>"
          + '<button class="secondary" data-note="'+(item.id || item.code)+'">追加备注</button><div class="logs meta">'+(logs || "暂无记录")+"</div></article>";
      }).join("");
    }
    function bindDynamic() {
      document.querySelectorAll("[data-status]").forEach(sel => sel.onchange = async () => { await api("/api/items/"+sel.dataset.status, { method:"PATCH", body: JSON.stringify({ status: sel.value, requestId: rid() }) }); await loadAll(); });
      document.querySelectorAll("[data-note]").forEach(btn => btn.onclick = async () => { const note = prompt("记录备注"); if (note) { await api("/api/items/"+btn.dataset.note+"/logs", { method:"POST", body: JSON.stringify({ step:"备注", note, requestId: rid() }) }); await loadAll(); } });
      document.querySelectorAll("[data-pour]").forEach(btn => btn.onclick = async () => { await api("/api/batches/"+btn.dataset.pour+"/confirm-pour", { method:"POST", body: JSON.stringify({ by:"页面确认", requestId: rid() }) }); await loadAll(); });
      document.querySelectorAll("[data-adopt]").forEach(btn => btn.onclick = () => review(btn.dataset.adopt, "adopt"));
      document.querySelectorAll("[data-reject]").forEach(btn => btn.onclick = () => review(btn.dataset.reject, "reject"));
    }
    async function review(key, action) {
      const [slipId, readingId] = key.split("|");
      await api("/api/return-slips/"+slipId+"/readings/"+readingId+"/review", { method:"POST", body: JSON.stringify({ action, by:"页面复核", requestId: rid() }) });
      await loadAll();
    }
    bindForm("#createForm", "/api/items", obj);
    bindForm("#actionForm", () => "/api/items/"+$("#itemSelect").value+"/action", obj);
    bindForm("#liquidForm", "/api/liquids", fd => ({ source: fd.get("source"), concentration: Number(fd.get("concentration")), weightKg: Number(fd.get("weightKg")), by: fd.get("by") }));
    bindForm("#slipForm", "/api/return-slips", fd => {
      const body = { slipId: fd.get("slipId"), source: fd.get("source"), concentration: Number(fd.get("concentration")), weightKg: Number(fd.get("weightKg")), by: fd.get("by") };
      if (fd.get("targetBatchId")) body.targetBatchId = fd.get("targetBatchId");
      return body;
    });
    bindForm("#mixForm", "/api/batches", fd => {
      const components = [];
      for (const [key, value] of fd.entries()) if (key.startsWith("draw_") && Number(value) > 0) components.push({ liquidId: key.slice(5), drawnKg: Number(value) });
      return { ratio: fd.get("ratio"), targetConcentration: Number(fd.get("targetConcentration")), by: fd.get("by"), components };
    });
    bindForm("#reviseForm", () => "/api/batches/"+$("#revBatchId").value, fd => {
      const body = { reason: fd.get("reason") || "页面修订" };
      if (fd.get("targetConcentration")) body.targetConcentration = Number(fd.get("targetConcentration"));
      if (fd.get("measuredConcentration")) body.measuredConcentration = Number(fd.get("measuredConcentration"));
      if (fd.get("ratio")) body.ratio = fd.get("ratio");
      return body;
    }, "PATCH");
    $("#statusFilter").onchange = renderCards; $("#search").oninput = renderCards; $("#reload").onclick = loadAll;
    renderForms(); loadAll();
  </script>
</body>
</html>`;
}
