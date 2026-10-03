// 判定层:账本规则全部在这里,纯函数,不碰文件、不碰 HTTP。
// 批谱主线:回收液(来源/实测浓度/重量) → 再生缸再配 → 倒缸确认 → 玻璃板冲洗结论与入盒许可。

export const LIMITS = { concentrationMin: 0.08, concentrationMax: 0.15 };

export class DomainError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const fail = (status, code, message) => { throw new DomainError(status, code, message); };
const now = () => new Date().toISOString();
const round3 = n => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

function positive(value, code, label) {
  const n = Number(value);
  if (!(n > 0)) fail(400, code, label);
  return n;
}

const effectiveConcentration = batch => batch.measuredConcentration ?? batch.targetConcentration;

// ---- 回收液:先记来源、实测浓度和重量,余量只挂在来源桶这一处 ----

export function registerLiquid(db, input) {
  if (!input.source || !String(input.source).trim()) fail(400, "source_required", "回收液必须记来源");
  const concentration = positive(input.concentration, "concentration_required", "回收液必须记实测浓度");
  const weightKg = positive(input.weightKg, "weight_required", "回收液必须记重量");
  const id = "RL-" + String(++db.seq.liquid).padStart(3, "0");
  const liquid = {
    id,
    source: String(input.source).trim(),
    concentration,
    weightKg,
    remainingKg: weightKg,
    drawnKg: 0,
    status: "在库",
    by: input.by || "未署名",
    slipId: input.slipId || null,
    createdAt: now()
  };
  db.liquids[id] = liquid;
  return liquid;
}

// ---- 再配:先验后扣,来源桶当场扣量不再重复挂账;倒缸确认前不计入可用量 ----

export function createBatch(db, input) {
  if (!input.ratio || !String(input.ratio).trim()) fail(400, "ratio_required", "再配必须记配比");
  const targetConcentration = positive(input.targetConcentration, "concentration_required", "再配必须记目标浓度");
  const components = Array.isArray(input.components) ? input.components : [];
  if (!components.length) fail(400, "components_required", "再配至少抽一桶回收液");
  // 先整单校验,再统一扣量,任何一步失败都不留半截账
  const draws = components.map(c => {
    const liquid = db.liquids[c.liquidId];
    if (!liquid) fail(404, "liquid_not_found", "回收液不存在:" + c.liquidId);
    const drawnKg = positive(c.drawnKg, "draw_invalid", "抽取量需为正数");
    if (drawnKg > liquid.remainingKg) {
      fail(409, "insufficient_liquid", `回收液${c.liquidId}余量${liquid.remainingKg}kg,不够抽${drawnKg}kg`);
    }
    return { liquid, drawnKg: round3(drawnKg) };
  });
  const id = "B-" + String(++db.seq.batch).padStart(4, "0");
  const batch = {
    id,
    ratio: String(input.ratio).trim(),
    targetConcentration,
    measuredConcentration: null,
    components: draws.map(d => ({ liquidId: d.liquid.id, drawnKg: d.drawnKg })),
    stages: [{ step: "配料", at: now(), by: input.by || "未署名" }],
    status: "配制中",
    totalKg: round3(draws.reduce((n, d) => n + d.drawnKg, 0)),
    availableKg: 0,
    revision: 1,
    history: [],
    createdAt: now(),
    by: input.by || "未署名"
  };
  for (const d of draws) {
    d.liquid.remainingKg = round3(d.liquid.remainingKg - d.drawnKg);
    d.liquid.drawnKg = round3(d.liquid.drawnKg + d.drawnKg);
    if (d.liquid.remainingKg <= 0) d.liquid.status = "已耗尽";
  }
  db.batches[id] = batch;
  return batch;
}

// 倒缸确认:只有走完这一步,再配液才计入可用量。
// 已确认的批次再确认是空操作,重试不会重复计入。
export function confirmPour(db, batchId, by) {
  const batch = db.batches[batchId];
  if (!batch) fail(404, "batch_not_found", "再生缸批次不存在:" + batchId);
  if (batch.status === "已确认") return { batch, already: true };
  if (batch.status !== "配制中") fail(409, "bad_state", `批次${batchId}当前状态${batch.status},不能确认倒缸`);
  batch.stages.push({ step: "倒缸确认", at: now(), by: by || "未署名" });
  batch.status = "已确认";
  batch.availableKg = batch.totalKg;
  recalcConclusions(db, batchId, "倒缸确认");
  return { batch, already: false };
}

// ---- 浓度或配比一改:旧结论立即失效重算,旧履历留在批次履历里 ----

export function reviseBatch(db, batch, changes, reason) {
  const next = {};
  if (changes.targetConcentration !== undefined) {
    next.targetConcentration = positive(changes.targetConcentration, "concentration_invalid", "目标浓度需为正数");
  }
  if (changes.measuredConcentration !== undefined) {
    next.measuredConcentration = positive(changes.measuredConcentration, "concentration_invalid", "实测浓度需为正数");
  }
  if (changes.ratio !== undefined) {
    if (!String(changes.ratio).trim()) fail(400, "ratio_invalid", "配比不能为空");
    next.ratio = String(changes.ratio).trim();
  }
  if (changes.returnedKg !== undefined) {
    next.returnedKg = positive(changes.returnedKg, "weight_invalid", "回流重量需为正数");
  }
  if (!Object.keys(next).length) fail(400, "no_change", "至少改一项浓度或配比");
  batch.history ||= [];
  batch.history.push({
    revision: batch.revision,
    targetConcentration: batch.targetConcentration,
    measuredConcentration: batch.measuredConcentration ?? null,
    ratio: batch.ratio,
    at: now(),
    reason: reason || "修订"
  });
  if (next.targetConcentration !== undefined) batch.targetConcentration = next.targetConcentration;
  if (next.measuredConcentration !== undefined) batch.measuredConcentration = next.measuredConcentration;
  if (next.ratio !== undefined) batch.ratio = next.ratio;
  if (next.returnedKg !== undefined) {
    batch.totalKg = round3(batch.totalKg + next.returnedKg);
    if (batch.status === "已确认") batch.availableKg = round3(batch.availableKg + next.returnedKg);
  }
  batch.revision += 1;
  recalcConclusions(db, batch.id, reason || "批次修订");
  return batch;
}

// 重算:同批次的生效结论全部作废留痕,再按当前批次状态逐块玻璃板重判。
export function recalcConclusions(db, batchId, reason) {
  const batch = db.batches[batchId];
  if (!batch) return;
  const at = now();
  for (const c of db.conclusions) {
    if (c.batchId === batchId && c.state === "生效") {
      c.state = "已失效";
      c.invalidatedAt = at;
      c.invalidateReason = reason;
    }
  }
  for (const item of db.items.filter(i => i.chemicalBatch === batchId)) {
    pushConclusion(db, item, batch, at);
  }
}

// 底片侧变化(缺陷、换批次)同步重判该块玻璃板;内容没变就不动账。
export function syncItemConclusion(db, item, reason = "底片记录变更") {
  const batch = db.batches[item.chemicalBatch];
  if (!batch) return null;
  const active = db.conclusions.find(c => c.itemCode === item.code && c.state === "生效");
  if (
    active &&
    active.batchId === batch.id &&
    active.batchRevision === batch.revision &&
    (active.defectSnapshot || "") === (item.defect || "")
  ) {
    return active;
  }
  const at = now();
  for (const c of db.conclusions) {
    if (c.itemCode === item.code && c.state === "生效") {
      c.state = "已失效";
      c.invalidatedAt = at;
      c.invalidateReason = reason;
    }
  }
  return pushConclusion(db, item, batch, at);
}

// 开工对账:缺生效结论的玻璃板补齐,返回是否有变化。
export function ensureConclusions(db) {
  let changed = false;
  for (const item of db.items) {
    const batch = db.batches[item.chemicalBatch];
    if (!batch) continue;
    const hasActive = db.conclusions.some(
      c => c.itemCode === item.code && c.state === "生效" && c.batchRevision === batch.revision
    );
    if (!hasActive) {
      syncItemConclusion(db, item, "对账补算");
      changed = true;
    }
  }
  return changed;
}

function pushConclusion(db, item, batch, at = now()) {
  const verdict = washVerdict(item, batch);
  const conclusion = {
    id: "JL-" + String(++db.seq.conclusion).padStart(3, "0"),
    itemCode: item.code,
    batchId: batch.id,
    batchRevision: batch.revision,
    concentration: effectiveConcentration(batch),
    defectSnapshot: item.defect || "",
    ...verdict,
    state: "生效",
    computedAt: at
  };
  db.conclusions.push(conclusion);
  return conclusion;
}

export function washVerdict(item, batch) {
  if (batch.status !== "已确认") {
    return { wash: "待倒缸", boxPermit: "禁止", reason: "批次未完成倒缸确认,不计入可用量" };
  }
  const c = effectiveConcentration(batch);
  if (c < LIMITS.concentrationMin) {
    return { wash: "返洗", boxPermit: "禁止", reason: `浓度${c}低于下限${LIMITS.concentrationMin}` };
  }
  if (c > LIMITS.concentrationMax) {
    return { wash: "返洗", boxPermit: "禁止", reason: `浓度${c}高于上限${LIMITS.concentrationMax}` };
  }
  if (item.defect) {
    return { wash: "合格", boxPermit: "暂缓", reason: "浓度在窗口内,存在缺陷:" + item.defect };
  }
  return { wash: "合格", boxPermit: "允许", reason: "浓度在工艺窗口内" };
}

// ---- 回流单:同一单号先写入的读数生效,后到值留待核,采纳后替换重算 ----

export function submitReturnSlip(db, input) {
  const slipId = String(input.slipId || "").trim();
  if (!slipId) fail(400, "slip_required", "回流单必须有现场单号");
  const reading = {
    id: "RD-" + String(++db.seq.reading).padStart(3, "0"),
    concentration: positive(input.concentration, "concentration_required", "回流单必须记实测浓度"),
    weightKg: positive(input.weightKg, "weight_required", "回流单必须记重量"),
    by: input.by || "未署名",
    at: now(),
    state: "待核"
  };
  let slip = db.returnSlips[slipId];
  if (!slip) {
    // 先写入的读数生效,当场入账
    reading.state = "生效";
    slip = {
      id: slipId,
      source: String(input.source || "回流").trim(),
      target: input.targetBatchId
        ? { type: "batch", id: String(input.targetBatchId) }
        : { type: "liquid", id: null },
      readings: [reading],
      createdAt: now()
    };
    db.returnSlips[slipId] = slip;
    applyReading(db, slip, reading);
    return { slip, applied: reading, pending: [] };
  }
  // 后到值留待核,不覆盖生效读数、不动液量
  slip.readings.push(reading);
  return { slip, applied: null, pending: slip.readings.filter(r => r.state === "待核") };
}

export function reviewReading(db, slipId, readingId, action, by) {
  const slip = db.returnSlips[slipId];
  if (!slip) fail(404, "slip_not_found", "回流单不存在:" + slipId);
  const reading = slip.readings.find(r => r.id === readingId);
  if (!reading) fail(404, "reading_not_found", "读数不存在:" + readingId);
  if (reading.state !== "待核") fail(409, "not_pending", `读数${readingId}当前状态${reading.state},不在待核`);
  if (action === "reject") {
    reading.state = "已驳回";
    reading.reviewedBy = by || "未署名";
    return { slip, reading };
  }
  if (action !== "adopt") fail(400, "action_invalid", "复核动作只能是 adopt 或 reject");
  const current = slip.readings.find(r => r.state === "生效");
  if (current) current.state = "已替换";
  reading.state = "生效";
  reading.reviewedBy = by || "未署名";
  applyReading(db, slip, reading);
  return { slip, reading };
}

function applyReading(db, slip, reading) {
  if (slip.target.type === "batch") {
    // 回流进再生缸:实测浓度落到批次上,按"浓度一改"立即失效重算
    const batch = db.batches[slip.target.id];
    if (!batch) fail(404, "batch_not_found", "再生缸批次不存在:" + slip.target.id);
    reviseBatch(
      db,
      batch,
      { measuredConcentration: reading.concentration, returnedKg: reading.weightKg },
      "回流单 " + slip.id
    );
    return;
  }
  if (!slip.target.id) {
    // 回流入库:以生效读数建回收液档案
    const liquid = registerLiquid(db, {
      source: slip.source,
      concentration: reading.concentration,
      weightKg: reading.weightKg,
      by: reading.by,
      slipId: slip.id
    });
    slip.target.id = liquid.id;
    return;
  }
  // 采纳后到读数:改库存读数,余量按重量差调整,已抽走的部分不动
  const liquid = db.liquids[slip.target.id];
  if (!liquid) fail(404, "liquid_not_found", "回收液不存在:" + slip.target.id);
  const delta = round3(reading.weightKg - liquid.weightKg);
  liquid.concentration = reading.concentration;
  liquid.weightKg = reading.weightKg;
  liquid.remainingKg = round3(Math.max(0, liquid.remainingKg + delta));
  liquid.status = liquid.remainingKg > 0 ? "在库" : "已耗尽";
}

// ---- 视图:批谱、待核、可用量、结论 ----

// 可用量只算两处:在库回收液余量 + 已确认批次的可用量;
// 配制中的批次单列展示,不计入,来源桶抽走的部分也不再挂账。
export function availability(db) {
  const liquids = Object.values(db.liquids);
  const batches = Object.values(db.batches);
  const inStock = round3(liquids.reduce((n, l) => n + l.remainingKg, 0));
  const inTanks = round3(batches.filter(b => b.status === "已确认").reduce((n, b) => n + b.availableKg, 0));
  const mixing = round3(batches.filter(b => b.status === "配制中").reduce((n, b) => n + b.totalKg, 0));
  return { inStock, inTanks, mixing, usable: round3(inStock + inTanks) };
}

export function lineage(db) {
  return Object.values(db.batches).map(b => ({
    id: b.id,
    status: b.status,
    ratio: b.ratio,
    revision: b.revision,
    targetConcentration: b.targetConcentration,
    measuredConcentration: b.measuredConcentration ?? null,
    totalKg: b.totalKg,
    availableKg: b.availableKg,
    components: b.components.map(c => ({
      ...c,
      source: db.liquids[c.liquidId]?.source || c.liquidId,
      slipId: db.liquids[c.liquidId]?.slipId || null
    })),
    stages: b.stages,
    plates: db.items.filter(i => i.chemicalBatch === b.id).map(i => ({ code: i.code, status: i.status })),
    activeConclusions: db.conclusions.filter(c => c.batchId === b.id && c.state === "生效").length,
    invalidatedConclusions: db.conclusions.filter(c => c.batchId === b.id && c.state === "已失效").length,
    history: b.history || []
  }));
}

export function pendingReadings(db) {
  const out = [];
  for (const slip of Object.values(db.returnSlips)) {
    for (const r of slip.readings) {
      if (r.state === "待核") out.push({ slipId: slip.id, source: slip.source, target: slip.target, ...r });
    }
  }
  return out;
}

export function listConclusions(db) {
  return [...db.conclusions].sort((a, b) => b.computedAt.localeCompare(a.computedAt) || b.id.localeCompare(a.id));
}
