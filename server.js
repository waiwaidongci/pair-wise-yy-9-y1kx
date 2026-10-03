import http from "node:http";
import { loadDb, saveDb, newId, now } from "./lib/store.js";
import {
  submitReading,
  findDuplicateSource,
  confirmPour,
  useLiquid,
  invalidateByTankChange,
  recalculatePlate,
  pendingReadings,
  pendingRecalc,
} from "./lib/judgment.js";
import { archiveRecord } from "./lib/archive.js";
import { buildSpectrum, linkSpectrum } from "./lib/spectrum.js";
import { page } from "./lib/ui.js";

const port = Number(process.env.PORT || 3040);

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

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();

    if (req.method === "GET" && url.pathname === "/") return html(res, page());

    // ---- 批谱 ----
    if (req.method === "GET" && url.pathname === "/api/spectrum") {
      return send(res, 200, buildSpectrum(db));
    }

    // ---- 回流单 ----
    if (req.method === "GET" && url.pathname === "/api/reflux") {
      return send(res, 200, db.refluxOrders);
    }
    if (req.method === "POST" && url.pathname === "/api/reflux") {
      const input = await body(req);
      if (!input.source || input.concentration == null || input.weight == null) {
        return send(res, 400, { error: "missing_fields", message: "来源桶、实测浓度和重量必填" });
      }
      // 来源桶不能重复挂账：同一来源桶已有未取消的回流单时，后到读数留待核
      const dup = findDuplicateSource(db.refluxOrders, input.source);
      if (dup) {
        const result = submitReading(dup, {
          by: input.by,
          concentration: input.concentration,
          weight: input.weight,
        });
        archiveRecord(db, { type: "读数提交(后到)", orderId: dup.id, reading: result.reading, status: result.status });
        await saveDb(db);
        return send(res, 200, { order: dup, reading: result.reading, readingStatus: result.status, duplicated: true });
      }
      const order = {
        id: newId("HL"),
        source: input.source,
        concentration: Number(input.concentration),
        weight: Number(input.weight),
        status: "待核",
        readings: [],
        tankId: null,
        createdAt: now(),
      };
      // 先写入的读数生效
      const result = submitReading(order, {
        by: input.by,
        concentration: input.concentration,
        weight: input.weight,
      });
      db.refluxOrders.unshift(order);
      archiveRecord(db, { type: "回流单建档", orderId: order.id, source: order.source });
      await saveDb(db);
      return send(res, 201, { order, reading: result.reading, readingStatus: result.status });
    }
    const refluxReading = url.pathname.match(/^\/api\/reflux\/([^/]+)\/readings$/);
    if (refluxReading && req.method === "POST") {
      const order = db.refluxOrders.find((o) => o.id === refluxReading[1]);
      if (!order) return send(res, 404, { error: "order_not_found" });
      const input = await body(req);
      const result = submitReading(order, input);
      archiveRecord(db, { type: "读数提交", orderId: order.id, reading: result.reading, status: result.status });
      await saveDb(db);
      return send(res, 201, result);
    }
    const refluxConfirm = url.pathname.match(/^\/api\/reflux\/([^/]+)\/confirm$/);
    if (refluxConfirm && req.method === "POST") {
      const order = db.refluxOrders.find((o) => o.id === refluxConfirm[1]);
      if (!order) return send(res, 404, { error: "order_not_found" });
      const input = await body(req);
      order.status = "已确认";
      order.confirmedAt = now();
      order.tankId = input.tankId || null;
      // 进入再生缸，建立批谱节点
      if (order.tankId) {
        const tank = db.tanks.find((t) => t.id === order.tankId);
        if (tank) {
          tank._refluxOrders ||= [];
          tank._refluxOrders.push(order);
          linkSpectrum(db, order.id, tank.id);
        }
      }
      archiveRecord(db, { type: "回流确认", orderId: order.id, tankId: order.tankId });
      await saveDb(db);
      return send(res, 200, order);
    }

    // ---- 再生缸 ----
    if (req.method === "GET" && url.pathname === "/api/tanks") {
      return send(res, 200, db.tanks);
    }
    if (req.method === "POST" && url.pathname === "/api/tanks") {
      const input = await body(req);
      const tank = {
        id: newId("ZSG"),
        name: input.name || "再生缸",
        status: "配液中",
        ratio: input.ratio || "",
        targetConcentration: Number(input.targetConcentration) || 0,
        version: 1,
        availableWeight: 0,
        usedWeight: 0,
        operations: [],
        _refluxOrders: [],
        createdAt: now(),
      };
      db.tanks.unshift(tank);
      await saveDb(db);
      return send(res, 201, tank);
    }
    const tankPour = url.pathname.match(/^\/api\/tanks\/([^/]+)\/pour$/);
    if (tankPour && req.method === "POST") {
      const tank = db.tanks.find((t) => t.id === tankPour[1]);
      if (!tank) return send(res, 404, { error: "tank_not_found" });
      const input = await body(req);
      const opId = input.opId || ("pour-" + tank.id + "-" + Date.now());
      const result = confirmPour(tank, input.refluxOrderIds || tank._refluxOrders.map((o) => o.id), opId);
      if (result.status === "confirmed") archiveRecord(db, { type: "倒缸确认", tankId: tank.id, result: result.status, opId });
      await saveDb(db);
      return send(res, 200, result);
    }
    const tankRatio = url.pathname.match(/^\/api\/tanks\/([^/]+)\/ratio$/);
    if (tankRatio && req.method === "PATCH") {
      const tank = db.tanks.find((t) => t.id === tankRatio[1]);
      if (!tank) return send(res, 404, { error: "tank_not_found" });
      const input = await body(req);
      if (input.ratio !== undefined) tank.ratio = input.ratio;
      if (input.targetConcentration !== undefined) tank.targetConcentration = Number(input.targetConcentration);
      // 浓度或配比一改，按它做出的冲洗结论和入盒许可立即失效
      const result = invalidateByTankChange(tank, db.plates, db.archive);
      archiveRecord(db, { type: "配比变更", tankId: tank.id, version: tank.version, affectedCount: result.affectedCount });
      await saveDb(db);
      return send(res, 200, result);
    }

    // ---- 玻璃板 ----
    if (req.method === "GET" && url.pathname === "/api/plates") {
      return send(res, 200, db.plates);
    }
    if (req.method === "POST" && url.pathname === "/api/plates") {
      const input = await body(req);
      const plate = {
        id: newId("BL"),
        code: input.code || "",
        tankId: input.tankId || null,
        usedWeight: 0,
        conclusion: null,
        boxPermit: null,
        history: [],
        createdAt: now(),
      };
      db.plates.unshift(plate);
      await saveDb(db);
      return send(res, 201, plate);
    }
    const plateUse = url.pathname.match(/^\/api\/plates\/([^/]+)\/use$/);
    if (plateUse && req.method === "POST") {
      const plate = db.plates.find((p) => p.id === plateUse[1]);
      if (!plate) return send(res, 404, { error: "plate_not_found" });
      const input = await body(req);
      const tank = db.tanks.find((t) => t.id === input.tankId);
      if (!tank) return send(res, 404, { error: "tank_not_found" });
      const opId = input.opId || ("use-" + plate.id + "-" + Date.now());
      const result = useLiquid(plate, tank, Number(input.weight) || 0, opId);
      if (result.status !== "applied" && result.status !== "already_applied") {
        return send(res, 400, result);
      }
      // 用液后按当前缸浓度/配比算出结论和许可
      recalculatePlate(plate, tank);
      if (result.status === "applied") archiveRecord(db, { type: "玻璃板用液", plateId: plate.id, tankId: tank.id, weight: input.weight });
      await saveDb(db);
      return send(res, 200, { plate, result });
    }
    const plateRecalc = url.pathname.match(/^\/api\/plates\/([^/]+)\/recalc$/);
    if (plateRecalc && req.method === "POST") {
      const plate = db.plates.find((p) => p.id === plateRecalc[1]);
      if (!plate) return send(res, 404, { error: "plate_not_found" });
      const tank = db.tanks.find((t) => t.id === plate.tankId);
      if (!tank) return send(res, 404, { error: "tank_not_found" });
      recalculatePlate(plate, tank);
      archiveRecord(db, { type: "重算", plateId: plate.id, tankId: tank.id, version: tank.version });
      await saveDb(db);
      return send(res, 200, plate);
    }

    // ---- 待核 / 判定 / 存档 ----
    if (req.method === "GET" && url.pathname === "/api/pending") {
      return send(res, 200, { readings: pendingReadings(db.refluxOrders), recalc: pendingRecalc(db.plates) });
    }
    if (req.method === "GET" && url.pathname === "/api/archive") {
      return send(res, 200, { archive: db.archive });
    }

    // ---- 旧底片条目（保留原功能） ----
    if (req.method === "GET" && url.pathname === "/api/items") return send(res, 200, db.items);
    if (req.method === "POST" && url.pathname === "/api/items") {
      const input = await body(req);
      const item = { id: newId("CN"), ...input, logs: [{ at: now(), step: "建档", note: "创建底片" }] };
      db.items.unshift(item);
      await saveDb(db);
      return send(res, 201, item);
    }

    send(res, 404, { error: "not_found" });
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

server.listen(port, () => console.log("蓝晒整理室批谱 listening on http://localhost:" + port));
