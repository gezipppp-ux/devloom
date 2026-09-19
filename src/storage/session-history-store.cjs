const { databaseForPath } = require("./database-registry.cjs");

class SessionHistoryStore {
  constructor(directory) {
    this.database = databaseForPath(directory);
    this.key = this.database?.relative(directory);
  }

  save(item) {
    if (!this.database || !item?.id) return;
    this.database.handle.prepare(`INSERT INTO session_items(run_path,item_id,turn_id,data,updated_at,sort_order)
      VALUES (?,?,?,?,?,(SELECT COALESCE(MAX(sort_order),0)+1 FROM session_items WHERE run_path=?)) ON CONFLICT(run_path,item_id) DO UPDATE SET
      turn_id=excluded.turn_id,data=excluded.data,updated_at=excluded.updated_at`)
      .run(this.key, item.id, item.turnId || null, JSON.stringify(item), new Date().toISOString(), this.key);
  }

  reconcile(items, startedAt) {
    if (!this.database) return;
    this.database.transaction(() => {
      const saved = this.database.handle.prepare("SELECT * FROM session_items WHERE run_path=? ORDER BY sort_order,id").all(this.key);
      const byId = new Map(saved.map((row) => [row.item_id, row]));
      const canonical = new Map(items.map((item) => [item.id, item]));
      let order = 0;
      const reorder = this.database.handle.prepare("UPDATE session_items SET sort_order=? WHERE run_path=? AND item_id=?");
      for (const [id, item] of canonical) {
        const previous = byId.get(id);
        if (!previous || previous.updated_at < startedAt) this.save(item);
        reorder.run(++order, this.key, id);
      }
      for (const row of saved) if (!canonical.has(row.item_id)) reorder.run(++order, this.key, row.item_id);
    });
  }

  list(cursor) {
    if (!this.database) return null;
    if (cursor != null && !/^db:\d+$/.test(cursor)) throw new Error("无效的历史分页游标。");
    const id = cursor ? Number(cursor.slice(3)) : Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(id)) throw new Error("无效的历史分页游标。");
    const marker = cursor ? this.database.handle.prepare("SELECT sort_order FROM session_items WHERE run_path=? AND id=?").get(this.key, id) : null;
    if (cursor && !marker) throw new Error("历史分页游标不属于当前任务。");
    const before = marker?.sort_order ?? Number.MAX_SAFE_INTEGER;
    const rows = this.database.handle.prepare(
      "SELECT id,data FROM session_items WHERE run_path=? AND (sort_order<? OR (sort_order=? AND id<?)) ORDER BY sort_order DESC,id DESC LIMIT 51")
      .all(this.key, before, before, id);
    const page = rows.slice(0, 50);
    return { items: page.map((row) => JSON.parse(row.data)).reverse(),
      nextCursor: rows.length > 50 ? `db:${page.at(-1).id}` : null };
  }
}

module.exports = { SessionHistoryStore };
