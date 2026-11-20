import assert from "node:assert/strict";
import { test } from "node:test";
import { orderVideos, parseVideoTitle } from "../src/u40-import.ts";

test("U40 播放清單影片標題判讀：日期、名稱（沒有適當名稱＝空）、主講人與獎銜", () => {
  const p = parseVideoTitle;
  assert.deepEqual(p("20231202-U40創業學院"), { date: "2023-12-02", name: "", seq: null, speaker: "", rank: "" });
  assert.equal(p("20230708-U40AI知識變現術").name, "");
  assert.deepEqual([p("20230422-U40-成功的八大習慣（1）自我成長").name, p("20230422-U40-成功的八大習慣（1）自我成長").seq], ["自我成長", 1]);
  assert.equal(p("20230311-U40視野造就財富-第一堂-ESG").name, "ESG");
  assert.equal(p("20230318-U40視野造就財富-第二堂-AI的演變&CHAT GPT").name, "AI的演變&CHAT GPT");
  assert.equal(p("20230107致富的黃金八法第一堂").name, "");
  assert.equal(p("20230114致富的黃金八法第二法").name, "");
  assert.deepEqual([p("20221029-U40創客九力1️⃣-夢想力").name, p("20221029-U40創客九力1️⃣-夢想力").seq], ["夢想力", 1]);
  assert.equal(p("20221119-U40創客九力-4️⃣共情力").name, "共情力");
  assert.equal(p("U40-規劃力").name, "規劃力");
  assert.equal(p("U40-王老師總結+整合力").name, "王老師總結+整合力");
  assert.equal(p("20220416U40創玩家創玩計畫").name, "");
  assert.equal(p("20220505創玩家培訓第三堂").name, "");
  assert.equal(p("20220924U40 不一樣的安麗").name, "不一樣的安麗");
  assert.equal(p("20240615-U40創客九力").name, "");
  const r = p("2025/11/1 蘇致豪翡翠、魏程緯白金、主持黃子芯（2025寰宇U40創業學院）");
  assert.deepEqual([r.date, r.name, r.speaker, r.rank], ["2025-11-01", "蘇致豪翡翠、魏程緯白金", "蘇致豪", "emerald"]);
  const r2 = p("2025/7/5 Nikki F白金、陳泰榮EDC、主持ViVi（2025寰宇U40創業學院）");
  assert.deepEqual([r2.speaker, r2.rank], ["Nikki", "f_platinum"]);
  const r3 = p("2025/5/3彭炫中白金、李育霖翡翠、主持潘佳琪（2025寰宇U40創業學院）");
  assert.deepEqual([r3.date, r3.speaker, r3.rank], ["2025-05-03", "彭炫中", "platinum"]);
  assert.equal(p("2025/2/15劉愛梅藍寶石、黃美蓁鑽石、主持巧茹（2025寰宇U40創業學院）").rank, "sapphire");
  assert.equal(p("2025/4/5陳宜觀F白金、吳佳諺鑽石、主持姿婷（2025寰宇U40創業學院）").rank, "f_platinum");
  assert.equal(p("➍工作熱忱由自己建立～總結王老師（2024/02/03 U40潮流創業）").name, "工作熱忱由自己建立～總結王老師");
});

test("影片排序：每支都有堂次依堂次；否則依日期，標題日期年份打錯（和上傳日差太多）改用上傳日", () => {
  const mk = (title: string, up: string | null) => ({ p: parseVideoTitle(title), up });
  const a = orderVideos([mk("20231202-U40創業學院", "2023-12-02"), mk("20241007-U40創業學院", "2023-10-07"), mk("20230909-U40創業學院", "2023-09-09")]);
  assert.deepEqual(a.map((x) => x.day), ["2023-09-09", "2023-10-07", "2023-12-02"]);
  // 事後才上傳的舊影片：標題日期早於上傳日是正常的，維持標題日期
  const late = orderVideos([mk("20220416U40創玩家創玩計畫", "2022-10-02"), mk("20220423U40創玩計劃第二堂", "2022-10-02")]);
  assert.deepEqual(late.map((x) => x.day), ["2022-04-16", "2022-04-23"]);
  const b = orderVideos([mk("20230610-U40-成功的八大習慣（7）全力以赴", "2023-06-10"), mk("20230603-U40-成功的八大習慣（8）價值觀的排序", "2023-06-03")]);
  assert.deepEqual(b.map((x) => x.p.seq), [7, 8]);
});
