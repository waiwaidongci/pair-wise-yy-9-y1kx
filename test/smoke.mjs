import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

// 冒烟测试:起一台独立实例(临时数据文件),把批谱的关键场景跑一遍。
const __dirname = dirname(fileURLToPath(import.meta.url));
const port = 3199;
const dir = mkdtempSync(join(tmpdir(), "cyanotype-"));
const server = spawn(process.execPath, [join(__dirname, "..", "server.js")], {
  env: { ...process.env, PORT: String(port), DATA_FILE: join(dir, "db.json") },
  stdio: "inherit"
});

const base = `http://localhost:${port}`;
async function api(path, opts = {}) {
  const res = await fetch(base + path, opts.body ? { ...opts, headers: { "Content-Type": "application/json" } } : opts);
  const data = await res.json();
  return { status: res.status, data };
}
const post = (p, body) => api(p, { method: "POST", body: JSON.stringify(body) });
const patch = (p, body) => api(p, { method: "PATCH", body: JSON.stringify(body) });

for (let i = 0; i < 50; i++) {
  try {
    const r = await fetch(base + "/api/items");
    if (r.ok) break;
  } catch {}
  await new Promise(r => setTimeout(r, 100));
}

let failed = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log("ok - " + name);
  } catch (error) {
    failed += 1;
    console.error("FAIL - " + name + "\n  " + error.message);
  }
}

// 1. 回收液登记:来源、实测浓度、重量;同一现场单重试不重复入账
await step("回收液登记 + 现场单重试幂等", async () => {
  const r1 = await post("/api/liquids", { requestId: "T-L1", source: "一号桶", concentration: 0.12, weightKg: 5, by: "张师傅" });
  assert.equal(r1.status, 201);
  assert.equal(r1.data.liquid.remainingKg, 5);
  const again = await post("/api/liquids", { requestId: "T-L1", source: "一号桶", concentration: 0.12, weightKg: 5, by: "张师傅" });
  assert.equal(again.data.replayed, true);
  assert.equal(again.data.liquid.id, r1.data.liquid.id);
  const lin = await api("/api/lineage");
  assert.equal(lin.data.liquids.length, 1, "重试不应多入账");
  const r2 = await post("/api/liquids", { requestId: "T-L2", source: "二号桶", concentration: 0.09, weightKg: 3, by: "李师傅" });
  assert.equal(r2.status, 201);
});

// 2. 再配:来源桶当场扣量;倒缸确认前不计入可用量
let batchId;
await step("再配扣来源余量,确认前不计可用", async () => {
  const r = await post("/api/batches", {
    requestId: "T-B1", ratio: "2:1", targetConcentration: 0.1, by: "张师傅",
    components: [{ liquidId: "RL-001", drawnKg: 2 }, { liquidId: "RL-002", drawnKg: 1 }]
  });
  assert.equal(r.status, 201);
  batchId = r.data.batch.id;
  assert.equal(r.data.batch.status, "配制中");
  assert.equal(r.data.batch.availableKg, 0);
  let lin = (await api("/api/lineage")).data;
  assert.equal(lin.liquids.find(l => l.id === "RL-001").remainingKg, 3);
  assert.equal(lin.liquids.find(l => l.id === "RL-002").remainingKg, 2);
  assert.deepEqual(lin.availability, { inStock: 5, inTanks: 0, mixing: 3, usable: 5 });
  // 写盘失败后按同一现场单重试:不重复扣量
  const replay = await post("/api/batches", {
    requestId: "T-B1", ratio: "2:1", targetConcentration: 0.1, by: "张师傅",
    components: [{ liquidId: "RL-001", drawnKg: 2 }, { liquidId: "RL-002", drawnKg: 1 }]
  });
  assert.equal(replay.data.replayed, true);
  lin = (await api("/api/lineage")).data;
  assert.equal(lin.liquids.find(l => l.id === "RL-001").remainingKg, 3, "重试不得重复扣量");
});

// 3. 倒缸确认后才计入可用量;重复确认不重复计入
await step("倒缸确认计入可用,重复确认幂等", async () => {
  const r = await post(`/api/batches/${batchId}/confirm-pour`, { requestId: "T-P1", by: "张师傅" });
  assert.equal(r.data.batch.status, "已确认");
  assert.equal(r.data.batch.availableKg, 3);
  const again = await post(`/api/batches/${batchId}/confirm-pour`, { requestId: "T-P2", by: "李师傅" });
  assert.equal(again.data.already, true);
  assert.equal(again.data.batch.availableKg, 3);
  const lin = (await api("/api/lineage")).data;
  assert.equal(lin.availability.inTanks, 3);
  assert.equal(lin.availability.usable, 8);
});

// 4. 玻璃板挂上批次即出结论
await step("玻璃板挂批次出冲洗结论与入盒许可", async () => {
  const r = await post("/api/items", { requestId: "T-I1", code: "CN-100", plateSize: "18x24cm", chemicalBatch: batchId, status: "冲洗中" });
  assert.equal(r.status, 201);
  assert.equal(r.data.conclusion.state, "生效");
  assert.equal(r.data.conclusion.wash, "合格");
  assert.equal(r.data.conclusion.boxPermit, "允许");
});

// 5. 浓度一改:旧结论立即失效重算,旧履历可追查
await step("批次修订触发失效重算,履历留痕", async () => {
  const r = await patch(`/api/batches/${batchId}`, { requestId: "T-R1", targetConcentration: 0.2, reason: "试纸偏高" });
  assert.equal(r.data.batch.revision, 2);
  assert.equal(r.data.batch.history.length, 1);
  const list = (await api("/api/conclusions")).data.filter(c => c.itemCode === "CN-100");
  const dead = list.filter(c => c.state === "已失效");
  const live = list.filter(c => c.state === "生效");
  assert.equal(dead.length, 1);
  assert.equal(dead[0].invalidateReason, "试纸偏高");
  assert.equal(live.length, 1);
  assert.equal(live[0].wash, "返洗");
  assert.equal(live[0].boxPermit, "禁止");
  assert.equal(live[0].concentration, 0.2);
});

// 6. 回流单:先写入生效;两人同时提交同一单,后到值留待核
await step("同一回流单先到生效、后到待核", async () => {
  const first = await post("/api/return-slips", { requestId: "T-S1", slipId: "HS-77", source: "三号线回流", concentration: 0.11, weightKg: 4, by: "张师傅" });
  assert.equal(first.data.applied.state, "生效");
  const [a, b] = await Promise.all([
    post("/api/return-slips", { requestId: "T-S2a", slipId: "HS-88", source: "四号线回流", concentration: 0.1, weightKg: 2, by: "张师傅" }),
    post("/api/return-slips", { requestId: "T-S2b", slipId: "HS-88", source: "四号线回流", concentration: 0.14, weightKg: 2.5, by: "李师傅" })
  ]);
  const applied = [a, b].filter(r => r.data.applied);
  const held = [a, b].filter(r => !r.data.applied);
  assert.equal(applied.length, 1, "只有先写入的生效");
  assert.equal(held.length, 1, "后到值留待核");
  assert.equal(held[0].data.pending.length, 1);
  const pending = (await api("/api/pending")).data;
  assert.equal(pending.filter(p => p.slipId === "HS-88").length, 1);
});

// 7. 待核读数采纳后替换生效值;驳回不动账
await step("待核读数采纳替换、驳回不动账", async () => {
  const p88 = (await api("/api/pending")).data.find(p => p.slipId === "HS-88");
  const adopted = await post(`/api/return-slips/HS-88/readings/${p88.id}/review`, { requestId: "T-A1", action: "adopt", by: "组长" });
  assert.equal(adopted.data.reading.state, "生效");
  const lin = (await api("/api/lineage")).data;
  const liquid = lin.liquids.find(l => l.slipId === "HS-88");
  assert.equal(liquid.concentration, p88.concentration, "采纳后库存读数以新值为准");
  // 再补一条待核然后驳回,库存不动
  await post("/api/return-slips", { requestId: "T-S3", slipId: "HS-77", source: "三号线回流", concentration: 0.5, weightKg: 9, by: "李师傅" });
  const p77 = (await api("/api/pending")).data.find(p => p.slipId === "HS-77");
  const before = (await api("/api/lineage")).data.liquids.find(l => l.slipId === "HS-77");
  const rejected = await post(`/api/return-slips/HS-77/readings/${p77.id}/review`, { requestId: "T-A2", action: "reject", by: "组长" });
  assert.equal(rejected.data.reading.state, "已驳回");
  const after = (await api("/api/lineage")).data.liquids.find(l => l.slipId === "HS-77");
  assert.equal(after.concentration, before.concentration);
  assert.equal(after.remainingKg, before.remainingKg);
});

// 8. 回流进再生缸:浓度一落即失效重算,液量只加一次
await step("回流进缸触发重算且液量不重复", async () => {
  const r = await post("/api/return-slips", { requestId: "T-S4", slipId: "HS-99", targetBatchId: batchId, source: "缸边回收", concentration: 0.13, weightKg: 0.5, by: "李师傅" });
  assert.equal(r.data.applied.state, "生效");
  const lin = (await api("/api/lineage")).data;
  const batch = lin.batches.find(b => b.id === batchId);
  assert.equal(batch.measuredConcentration, 0.13);
  assert.equal(batch.revision, 3);
  assert.equal(batch.availableKg, 3.5);
  const live = (await api("/api/conclusions")).data.filter(c => c.itemCode === "CN-100" && c.state === "生效");
  assert.equal(live.length, 1);
  assert.equal(live[0].wash, "合格");
  assert.equal(live[0].boxPermit, "允许");
  const replay = await post("/api/return-slips", { requestId: "T-S4", slipId: "HS-99", targetBatchId: batchId, source: "缸边回收", concentration: 0.13, weightKg: 0.5, by: "李师傅" });
  assert.equal(replay.data.replayed, true);
  const batch2 = (await api("/api/lineage")).data.batches.find(b => b.id === batchId);
  assert.equal(batch2.availableKg, 3.5, "重试不得重复加液量");
});

server.kill();
console.log(failed ? `\n${failed} 项未过` : "\n全部通过");
process.exit(failed ? 1 : 0);
