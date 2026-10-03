// 判定模块：回流读数、倒缸确认、来源桶防重、浓度/配比变更失效重算、幂等重试

import { now } from "./store.js";

// 两名师傅同时提交同一回流单：先写入的读数生效，后到值留待核
export function submitReading(order, reading) {
  order.readings ||= [];
  const hasEffective = order.readings.some((r) => r.effective);
  const entry = {
    at: now(),
    by: reading.by || "未记名",
    concentration: Number(reading.concentration),
    weight: Number(reading.weight),
  };
  if (hasEffective) {
    entry.effective = false;
    entry.pending = true;
    order.readings.push(entry);
    return { status: "pending", reading: entry };
  }
  entry.effective = true;
  entry.pending = false;
  order.readings.push(entry);
  order.concentration = entry.concentration;
  order.weight = entry.weight;
  return { status: "effective", reading: entry };
}

// 来源桶不能重复挂账：同一来源桶只能有一张未取消的回流单
export function findDuplicateSource(orders, source) {
  return orders.find(
    (o) => o.source === source && o.status !== "已取消"
  );
}

// 倒缸确认：只有完成倒缸确认后，再配液才计入可用量
// 幂等：同一 opId 不重复执行，液量不重复扣
export function confirmPour(tank, refluxOrderIds, opId) {
  tank.operations ||= [];
  const existing = tank.operations.find((op) => op.opId === opId);
  if (existing) {
    return { status: "already_confirmed", operation: existing };
  }
  const orders = (tank._refluxOrders || []).filter((o) =>
    refluxOrderIds.includes(o.id)
  );
  const totalWeight = orders.reduce((sum, o) => sum + (o.weight || 0), 0);
  tank.status = "可用";
  tank.availableWeight = totalWeight;
  tank.pouredAt = now();
  tank.pouredBy = tank.pouredBy || "未记名";
  const operation = {
    opId,
    type: "倒缸确认",
    at: tank.pouredAt,
    weight: totalWeight,
    refluxOrderIds,
  };
  tank.operations.push(operation);
  return { status: "confirmed", operation };
}

// 玻璃板用液：从已确认的倒缸步骤接着办，液量不能重复扣
export function useLiquid(plate, tank, weight, opId) {
  tank.operations ||= [];
  const existing = tank.operations.find((op) => op.opId === opId);
  if (existing) {
    return { status: "already_applied", operation: existing };
  }
  if (tank.status !== "可用") {
    return { status: "tank_not_ready", error: "倒缸未确认，液量不可用" };
  }
  if (weight > tank.availableWeight - (tank.usedWeight || 0)) {
    return { status: "insufficient", error: "可用量不足" };
  }
  tank.usedWeight = (tank.usedWeight || 0) + weight;
  plate.usedWeight = weight;
  plate.usedAt = now();
  const operation = {
    opId,
    type: "玻璃板用液",
    at: plate.usedAt,
    weight,
    plateId: plate.id,
  };
  tank.operations.push(operation);
  return { status: "applied", operation };
}

// 浓度或配比一改，按它做出的冲洗结论和入盒许可立即失效
export function invalidateByTankChange(tank, plates, archive) {
  tank.version = (tank.version || 1) + 1;
  const affected = plates.filter((p) => p.tankId === tank.id);
  for (const plate of affected) {
    plate.history ||= [];
    // 旧履历仍可追查：存档旧结论
    const snapshot = {
      at: now(),
      reason: "浓度/配比变更",
      tankVersion: tank.version - 1,
      conclusion: { ...(plate.conclusion || {}) },
      boxPermit: { ...(plate.boxPermit || {}) },
    };
    plate.history.push(snapshot);
    if (archive) archive.push({ type: "失效", plateId: plate.id, ...snapshot });
    if (plate.conclusion) {
      plate.conclusion.valid = false;
      plate.conclusion.pendingRecalc = true;
    }
    if (plate.boxPermit) {
      plate.boxPermit.valid = false;
      plate.boxPermit.pendingRecalc = true;
    }
  }
  return { tank, affectedCount: affected.length };
}

// 重算：按当前缸的浓度/配比重新算出冲洗结论和入盒许可
export function recalculatePlate(plate, tank) {
  const conclusionText = computeConclusion(tank);
  const permitText = computePermit(tank);
  plate.conclusion = {
    text: conclusionText,
    tankVersion: tank.version || 1,
    valid: true,
    pendingRecalc: false,
    recalcAt: now(),
  };
  plate.boxPermit = {
    text: permitText,
    tankVersion: tank.version || 1,
    valid: true,
    pendingRecalc: false,
    recalcAt: now(),
  };
  return plate;
}

function computeConclusion(tank) {
  const c = tank.targetConcentration || 0;
  if (c <= 0) return "待判定";
  if (c < 8) return "浓度不足，需复洗";
  if (c > 15) return "浓度过高，需稀释";
  return "合格";
}

function computePermit(tank) {
  const c = tank.targetConcentration || 0;
  if (c <= 0) return "待判定";
  if (c >= 8 && c <= 15) return "准予入盒";
  return "暂缓入盒";
}

// 待核读数：后到值留待核
export function pendingReadings(orders) {
  const result = [];
  for (const o of orders) {
    for (const r of o.readings || []) {
      if (r.pending) result.push({ orderId: o.id, source: o.source, reading: r });
    }
  }
  return result;
}

// 待重算：浓度/配比变更后失效的结论和许可
export function pendingRecalc(plates) {
  return plates.filter(
    (p) =>
      (p.conclusion && p.conclusion.pendingRecalc) ||
      (p.boxPermit && p.boxPermit.pendingRecalc)
  );
}
