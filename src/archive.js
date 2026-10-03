import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

// 存档层:只负责把整本账安全落盘,不懂业务。
// - 先写临时文件再改名,写盘失败不会留下半截账;
// - 变更串行执行,同一回流单两位师傅同时提交时,先到的先写;
// - 现场单号(requestId)的回执与数据同一次落盘:
//   写盘失败则变更与回执一起丢弃,按现场单重试即可;
//   写盘成功但回执丢失时,重试直接返回旧回执,液量不会重复扣。
export function createArchive(dbPath, seed) {
  let queue = Promise.resolve();
  const enqueue = job => {
    const run = queue.then(job);
    queue = run.catch(() => {});
    return run;
  };

  async function load() {
    if (!existsSync(dbPath)) {
      await mkdir(dirname(dbPath), { recursive: true });
      await save(structuredClone(seed));
    }
    return migrate(JSON.parse(await readFile(dbPath, "utf8")));
  }

  async function save(db) {
    await mkdir(dirname(dbPath), { recursive: true });
    const tmp = dbPath + ".tmp";
    await writeFile(tmp, JSON.stringify(db, null, 2));
    await rename(tmp, dbPath);
  }

  // 读账-变更-落盘串为一笔;同一 requestId 重放时直接给旧回执。
  async function transact(requestId, mutate) {
    return enqueue(async () => {
      const db = await load();
      db.journal ||= {};
      if (requestId && db.journal[requestId]) {
        return { db, result: db.journal[requestId].result, replayed: true };
      }
      const result = await mutate(db);
      if (requestId) db.journal[requestId] = { at: new Date().toISOString(), result };
      await save(db);
      return { db, result, replayed: false };
    });
  }

  // 对账:装载后补一次缺口,有变化才落盘。
  async function reconcile(fn) {
    return enqueue(async () => {
      const db = await load();
      if (await fn(db)) await save(db);
      return db;
    });
  }

  return { load, save, transact, reconcile };
}

// 旧档迁移:补齐新账本的各个分册;
// 旧底片引用过的药液批次补一条已确认批次,让老玻璃板能接上批谱。
function migrate(db) {
  db.items ||= [];
  db.liquids ||= {};
  db.batches ||= {};
  db.returnSlips ||= {};
  db.conclusions ||= [];
  db.journal ||= {};
  db.seq ||= {};
  for (const key of ["liquid", "batch", "reading", "conclusion"]) db.seq[key] ||= 0;
  for (const item of db.items) {
    const key = item.chemicalBatch;
    if (key && !db.batches[key]) {
      db.batches[key] = {
        id: key,
        ratio: "旧档沿用",
        targetConcentration: 0.1,
        measuredConcentration: null,
        components: [],
        stages: [{ step: "倒缸确认", at: "2026-06-20T00:00:00.000Z", by: "旧档迁移" }],
        status: "已确认",
        totalKg: 0,
        availableKg: 0,
        revision: 1,
        history: [],
        createdAt: "2026-06-20T00:00:00.000Z",
        by: "旧档迁移"
      };
    }
  }
  return db;
}
