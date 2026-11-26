// 建立「美力之星 第二屆」的 6 堂與作業項目（依 2026 第一屆作業計分表）。
// 用法：node scripts/seed-meili.mjs <網址> <Access Token> [作業編號]
// 沒給作業編號就新增一份；給了就把各堂與項目加進那份作業。
const [base, token, existing] = process.argv.slice(2);
if (!base || !token) throw new Error("用法：node scripts/seed-meili.mjs <網址> <Access Token> [作業編號]");
const call = async (method, path, body) => {
  const r = await fetch(`${base}/api${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${t}`);
  return JSON.parse(t);
};
const tw = (d) => new Date(`${d}T23:59:00+08:00`).toISOString();
const LESSONS = [
  ["第一堂", "2026-12-12", [
    { name: "肌膚諮詢單", mode: "count", per: 1, unit: "張", kinds: ["photo", "file"] },
    { name: "保養", mode: "count", per: 1, unit: "次", kinds: ["photo", "video"] },
    { name: "修眉", mode: "count", per: 1, unit: "次", kinds: ["photo"] },
    { name: "彩妝", mode: "count", per: 1, unit: "次", kinds: ["photo"] },
  ]],
  ["第二堂", "2026-12-26", [
    { name: "撥筋", mode: "count", per: 5, unit: "人", minCount: 5, kinds: ["photo", "video", "text"], note: "目標 5 人" },
    { name: "穴位圖筆試", mode: "onsite", fullScore: 100, inTotal: false },
  ]],
  ["第三堂", "2027-01-09", [
    { name: "社群個人開營", mode: "fixed", points: 5, kinds: ["link", "photo"] },
    { name: "邀約新人", mode: "count", per: 3, unit: "人", kinds: ["text", "photo"] },
    { name: "示範影片", mode: "fixed", points: 10, kinds: ["video", "link"] },
    { name: "卸妝乳示範照", mode: "count", per: 1, unit: "張", maxPoints: 5, kinds: ["photo"] },
    { name: "洗面乳示範照", mode: "count", per: 1, unit: "張", maxPoints: 5, kinds: ["photo"] },
  ]],
  ["第四堂", "2027-01-23", [
    { name: "自辦美容或美髮聚會", mode: "count", per: 10, unit: "場", minCount: 2, kinds: ["photo", "video", "text"], note: "至少二場，可加碼辦理" },
  ]],
  ["第五堂", "2027-02-06", [
    { name: "自辦美容＋美髮半日體驗營", mode: "count", per: 20, unit: "人", kinds: ["photo", "video", "text"], note: "為中心或白金小組舉辦" },
    { name: "花絮影片", mode: "stars", per: 1, kinds: ["video", "link"], note: "額外加分" },
    { name: "驗收：真人畫眉", mode: "pass", points: 5, kinds: ["photo", "video"] },
    { name: "驗收：紙圖畫眉", mode: "pass", points: 5, kinds: ["photo"] },
  ]],
  ["第六堂", "2027-02-20", [
    { name: "分享簡報：美力之路蛻變＋雅芝故事", mode: "score", fullScore: 30, kinds: ["file", "video", "link"], note: "各 5 分鐘" },
  ]],
];
const id = existing || (await call("POST", "/activities", { title: "美力之星 第二屆", startsOn: "2026-12-05", endsOn: "2027-02-20" })).id;
for (const [title, due, items] of LESSONS) {
  const l = await call("POST", `/activities/${id}/lessons`, { title, dueAt: tw(due) });
  for (const it of items) await call("POST", `/lessons/${l.id}/items`, it);
}
console.log("完成，作業編號：", id);
