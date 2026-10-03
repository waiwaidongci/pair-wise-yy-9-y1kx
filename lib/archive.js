// 存档模块：旧履历仍可追查，页面、判定、存档分别承载

import { now } from "./store.js";

export function archiveRecord(db, record) {
  db.archive ||= [];
  db.archive.push({ ...record, archivedAt: now() });
}

// 玻璃板的完整履历：建档、用液、失效、重算
export function plateHistory(plate) {
  return plate.history || [];
}

// 回流单的读数履历
export function orderReadings(order) {
  return order.readings || [];
}

// 缸的操作履历（倒缸、用液）
export function tankOperations(tank) {
  return tank.operations || [];
}

// 全量存档查询：按类型
export function queryArchive(db, type) {
  if (!type) return db.archive || [];
  return (db.archive || []).filter((a) => a.type === type);
}
