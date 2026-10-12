const { databaseForPath } = require("./database-registry.cjs");

class SessionHistoryStore {
  constructor(directory, database = databaseForPath(directory)) {
    this.database = database;
    this.key = this.database?.relative(directory);
  }

  async save(item) {
    if (!this.database || !item?.id) return Promise.resolve();
    return (await this.database.transaction(async () => {
      const existing = await this.database.client.sessionItem.findUnique({ where: { runPath_itemId: { runPath: this.key, itemId: item.id } } });
      const fields = { turnId: item.turnId || null, data: JSON.parse(JSON.stringify(item)) };
      if (existing) {
        return this.database.client.sessionItem.update({ where: { id: existing.id }, data: fields });
      } else {
        const latest = await this.database.client.sessionItem.aggregate({ where: { runPath: this.key }, _max: { sortOrder: true } });
        return this.database.client.sessionItem.create({ data: { runPath: this.key, itemId: item.id,
          sortOrder: (latest._max.sortOrder || 0) + 1, ...fields } });
      }
    }));
  }

  async reconcile(items, startedAt) {
    if (!this.database) return Promise.resolve();
    const cutoff = new Date(startedAt);
    if (!Number.isFinite(cutoff.getTime())) throw new Error("历史同步时间无效。");
    return (await this.database.transaction(async () => {
      const saved = await this.database.client.sessionItem.findMany({ where: { runPath: this.key }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
      const byId = new Map(saved.map((row) => [row.itemId, row]));
      const canonical = new Map(items.map((item) => [item.id, item]));
      let order = 0;
      for (const [itemId, item] of canonical) {
        const previous = byId.get(itemId);
        const current = !previous || previous.updatedAt < cutoff ? await this.save(item) : previous;
        await this.database.client.sessionItem.update({ where: { runPath_itemId: { runPath: this.key, itemId } },
          data: { sortOrder: ++order, updatedAt: current.updatedAt } });
      }
      for (const row of saved) if (!canonical.has(row.itemId))
        await this.database.client.sessionItem.update({ where: { id: row.id }, data: { sortOrder: ++order, updatedAt: row.updatedAt } });
    }));
  }

  async idsBefore(itemIds, beforeId) {
    if (!this.database || !itemIds.length || !beforeId) return new Set();
    const boundary = await this.database.client.sessionItem.findUnique({ where: { runPath_itemId: { runPath: this.key, itemId: beforeId } } });
    if (!boundary) return new Set();
    const rows = await this.database.client.sessionItem.findMany({ where: { runPath: this.key, itemId: { in: itemIds },
      OR: [{ sortOrder: { lt: boundary.sortOrder } }, { sortOrder: boundary.sortOrder, id: { lt: boundary.id } }] }, select: { itemId: true } });
    return new Set(rows.map(({ itemId }) => itemId));
  }

  async list(cursor) {
    if (!this.database) return null;
    if (cursor != null && !/^db:\d+$/.test(cursor)) throw new Error("无效的历史分页游标。");
    let before;
    if (cursor) {
      const id = Number(cursor.slice(3));
      if (!Number.isSafeInteger(id) || id > 2147483647) throw new Error("无效的历史分页游标。");
      const marker = await this.database.client.sessionItem.findFirst({ where: { runPath: this.key, id } });
      if (!marker) throw new Error("历史分页游标不属于当前任务。");
      before = [{ sortOrder: { lt: marker.sortOrder } }, { sortOrder: marker.sortOrder, id: { lt: id } }];
    }
    const rows = await this.database.client.sessionItem.findMany({ where: { runPath: this.key, ...(before ? { OR: before } : {}) },
      orderBy: [{ sortOrder: "desc" }, { id: "desc" }], take: 51, select: { id: true, data: true } });
    const page = rows.slice(0, 50);
    return { items: page.map((row) => row.data).reverse(), nextCursor: rows.length > 50 ? `db:${page.at(-1).id}` : null };
  }
}

module.exports = { SessionHistoryStore };
