/** 寰宇繳作業系統 API 網址：人員與分組（杜杜龍 2026-11-27 從 api.ts 拆出；這個檔被載入時就把網址登記進路由表）。 */
import { type Row, access, body, fail, needTeacher, on, people, personAction, rid, str } from "../core.ts";

// 人員與分組
on("GET", "/activities/:id/people", async (c, [id]) => people(c, id));
on("POST", "/activities/:id/people/:member", async (c, [id, member], req) => {
  await personAction(c, id, decodeURIComponent(member), await body(req));
  return { ok: true };
});
on("POST", "/activities/:id/groups", async (c, [id], req) => {
  needTeacher(await access(c, id));
  const n = Number((await c.env.DB.prepare("SELECT COUNT(*) AS n FROM groups WHERE activity_id = ?").bind(id).first<Row>())?.n ?? 0);
  const gid = rid();
  await c.env.DB.prepare("INSERT INTO groups (id, activity_id, name, position, join_code) VALUES (?, ?, ?, ?, ?)").bind(gid, id, str((await body(req)).name, 30) || `第 ${n + 1} 組`, n + 1, rid(8)).run();
  return { id: gid };
});
on("PATCH", "/groups/:id", async (c, [id], req) => {
  const g = await c.env.DB.prepare("SELECT * FROM groups WHERE id = ?").bind(id).first<Row>();
  if (!g) fail(404, "找不到這一組");
  const a = await access(c, String(g!.activity_id));
  if (!a.teacher && !(a.m?.isLeader && a.m.groupId === id)) fail(403, "只有老師或本組組長可以改組名");
  const name = str((await body(req)).name, 30);
  if (!name) fail(400, "請填組名");
  await c.env.DB.prepare("UPDATE groups SET name = ? WHERE id = ?").bind(name, id).run();
  return { ok: true };
});
on("DELETE", "/groups/:id", async (c, [id]) => {
  const g = await c.env.DB.prepare("SELECT * FROM groups WHERE id = ?").bind(id).first<Row>();
  if (!g) fail(404, "找不到這一組");
  needTeacher(await access(c, String(g!.activity_id)));
  await c.env.DB.batch([c.env.DB.prepare("UPDATE members SET group_id = NULL, is_leader = 0 WHERE group_id = ?").bind(id), c.env.DB.prepare("DELETE FROM groups WHERE id = ?").bind(id)]);
  return { ok: true };
});
on("POST", "/groups/:id/join-code", async (c, [id]) => {
  const g = await c.env.DB.prepare("SELECT * FROM groups WHERE id = ?").bind(id).first<Row>();
  if (!g) fail(404, "找不到這一組");
  needTeacher(await access(c, String(g!.activity_id)));
  const code = rid(8);
  await c.env.DB.prepare("UPDATE groups SET join_code = ? WHERE id = ?").bind(code, id).run();
  return { joinCode: code };
});
