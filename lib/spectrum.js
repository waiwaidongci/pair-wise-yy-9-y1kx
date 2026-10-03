// 批谱模块：回收液 → 再生缸 → 玻璃板 一条链

export function buildSpectrum(db) {
  return (db.spectrum || []).map((sp) => {
    const order = (db.refluxOrders || []).find((o) => o.id === sp.refluxOrderId);
    const tank = (db.tanks || []).find((t) => t.id === sp.tankId);
    const plates = (db.plates || []).filter((p) => p.tankId === sp.tankId);
    return { ...sp, order, tank, plates };
  });
}

// 回流单进入再生缸后，建立批谱节点
export function linkSpectrum(db, refluxOrderId, tankId) {
  db.spectrum ||= [];
  const existing = db.spectrum.find(
    (sp) => sp.refluxOrderId === refluxOrderId && sp.tankId === tankId
  );
  if (existing) return existing;
  const node = {
    id: "BP-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
    refluxOrderId,
    tankId,
    createdAt: new Date().toISOString(),
  };
  db.spectrum.push(node);
  return node;
}
