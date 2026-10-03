import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createArchive } from "./src/archive.js";
import * as J from "./src/judgment.js";
import { page } from "./src/page.js";

// 接线层:只负责 HTTP 路由,页面、判定、存档分别在 src/ 下。
const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATA_FILE || join(__dirname, "data", "cyanotype-negative-room.json");
const port = Number(process.env.PORT || 3040);

const seed = {
  items: [
    {
      code: "CN-001",
      plateSize: "18x24cm",
      chemicalBatch: "B-0620",
      exposure: "8分钟",
      waterSource: "井水过滤",
      box: "蓝盒A-03",
      status: "冲洗中",
      defect: "边角显影不均",
      logs: [{ at: "2026-06-20", step: "曝光", note: "阴天补时2分钟" }]
    }
  ]
};

const archive = createArchive(dbPath, seed);
const statLabels = ["待曝光", "冲洗中", "待入盒", "已交付"];

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
function html(res, text) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(text);
}
function newId() { return "CN-" + Date.now(); }
function computeStats(items) {
  const stats = Object.fromEntries(statLabels.map(label => [label, 0]));
  for (const item of items) {
    if (stats[item.status] !== undefined) stats[item.status] += 1;
  }
  return stats;
}
function summarize(item) {
  const logCount = (item.logs || []).length + (item.tasks || []).reduce((n, t) => n + (t.logs || []).length, 0);
  return { ...item, logCount };
}
const findItem = (db, key) => db.items.find(x => x.id === key || x.code === key);

// 所有写操作走同一扇门:剥离现场单号交给存档层,重放时直接回旧执。
async function mutate(req, res, fn, successStatus = 200) {
  const input = await body(req);
  const { requestId = null, ...fields } = input;
  const { result, replayed } = await archive.transact(requestId, db => fn(db, fields));
  send(res, replayed ? 200 : successStatus, { ...result, replayed });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = url.pathname;

    // ---- 读 ----
    if (req.method === "GET" && p === "/") return html(res, page());
    if (req.method === "GET" && p === "/api/items") return send(res, 200, (await archive.load()).items.map(summarize));
    if (req.method === "GET" && p === "/api/stats") return send(res, 200, computeStats((await archive.load()).items));
    if (req.method === "GET" && p === "/api/lineage") {
      const db = await archive.load();
      return send(res, 200, { availability: J.availability(db), batches: J.lineage(db), liquids: Object.values(db.liquids) });
    }
    if (req.method === "GET" && p === "/api/pending") return send(res, 200, J.pendingReadings(await archive.load()));
    if (req.method === "GET" && p === "/api/conclusions") return send(res, 200, J.listConclusions(await archive.load()));

    // ---- 玻璃板底片 ----
    if (req.method === "POST" && p === "/api/items") {
      return mutate(req, res, (db, f) => {
        const item = { id: newId(), ...f, logs: [{ at: new Date().toISOString(), step: "建档", note: "创建底片" }] };
        db.items.unshift(item);
        return { item, conclusion: J.syncItemConclusion(db, item) };
      }, 201);
    }
    const patch = p.match(/^\/api\/items\/([^/]+)$/);
    if (patch && req.method === "PATCH") {
      return mutate(req, res, (db, f) => {
        const item = findItem(db, patch[1]);
        if (!item) throw new J.DomainError(404, "item_not_found", "底片不存在:" + patch[1]);
        Object.assign(item, f);
        item.logs ||= [];
        item.logs.push({ at: new Date().toISOString(), step: "状态", note: "更新为" + item.status });
        return { item, conclusion: J.syncItemConclusion(db, item) };
      });
    }
    const log = p.match(/^\/api\/items\/([^/]+)\/logs$/);
    if (log && req.method === "POST") {
      return mutate(req, res, (db, f) => {
        const item = findItem(db, log[1]);
        if (!item) throw new J.DomainError(404, "item_not_found", "底片不存在:" + log[1]);
        item.logs ||= [];
        item.logs.push({ at: new Date().toISOString(), step: f.step || "记录", note: f.note || "" });
        return { item };
      }, 201);
    }
    const action = p.match(/^\/api\/items\/([^/]+)\/action$/);
    if (action && req.method === "POST") {
      return mutate(req, res, (db, f) => {
        const item = findItem(db, action[1]);
        if (!item) throw new J.DomainError(404, "item_not_found", "底片不存在:" + action[1]);
        item.logs ||= [];
        item.steps ||= [];
        item.steps.push({ at: new Date().toISOString(), ...f });
        if (f.defect) item.defect = f.defect;
        if (f.step === "冲洗") item.status = "冲洗中";
        else if (f.step === "入盒") item.status = "待入盒";
        else if (f.step === "交付") item.status = "已交付";
        else item.status = "待曝光";
        item.logs.push({ at: new Date().toISOString(), step: f.step || "工艺", note: f.note || f.developStatus || "步骤记录" });
        return { item, conclusion: J.syncItemConclusion(db, item) };
      }, 201);
    }

    // ---- 回收液与再生缸 ----
    if (req.method === "POST" && p === "/api/liquids") {
      return mutate(req, res, (db, f) => ({ liquid: J.registerLiquid(db, f) }), 201);
    }
    if (req.method === "POST" && p === "/api/batches") {
      return mutate(req, res, (db, f) => ({ batch: J.createBatch(db, f) }), 201);
    }
    const pour = p.match(/^\/api\/batches\/([^/]+)\/confirm-pour$/);
    if (pour && req.method === "POST") {
      return mutate(req, res, (db, f) => J.confirmPour(db, pour[1], f.by));
    }
    const batchPatch = p.match(/^\/api\/batches\/([^/]+)$/);
    if (batchPatch && req.method === "PATCH") {
      return mutate(req, res, (db, f) => {
        const batch = db.batches[batchPatch[1]];
        if (!batch) throw new J.DomainError(404, "batch_not_found", "再生缸批次不存在:" + batchPatch[1]);
        const changes = {};
        if (f.targetConcentration !== undefined && f.targetConcentration !== "") changes.targetConcentration = f.targetConcentration;
        if (f.measuredConcentration !== undefined && f.measuredConcentration !== "") changes.measuredConcentration = f.measuredConcentration;
        if (f.ratio) changes.ratio = f.ratio;
        J.reviseBatch(db, batch, changes, f.reason || "页面修订");
        return { batch };
      });
    }

    // ---- 回流单 ----
    if (req.method === "POST" && p === "/api/return-slips") {
      return mutate(req, res, (db, f) => J.submitReturnSlip(db, f), 201);
    }
    const review = p.match(/^\/api\/return-slips\/([^/]+)\/readings\/([^/]+)\/review$/);
    if (review && req.method === "POST") {
      return mutate(req, res, (db, f) => J.reviewReading(db, review[1], review[2], f.action, f.by));
    }

    send(res, 404, { error: "not_found" });
  } catch (error) {
    send(res, error.status || 500, { error: error.code || "internal_error", message: error.message });
  }
});

// 开工前对账:旧档玻璃板缺结论的补齐,有变化才落盘。
await archive.reconcile(db => J.ensureConclusions(db));

server.listen(port, () => console.log("古法蓝晒底片整理室 listening on http://localhost:" + port));
