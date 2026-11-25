import assert from "node:assert/strict";
import test from "node:test";
import { phoneticSearch } from "../src/phonetic-search.ts";

// 最小的假資料庫：課程「益之源 eSpring」，章節「eSpring益之源淨水器Pro | 分流器安裝方式」「連接APP與註冊教學」。
const db = {
  prepare(sql: string) {
    const q = {
      bind: () => q,
      first: async () => null,
      all: async () =>
        /FROM courses/.test(sql) && !/lessons/.test(sql)
          ? { results: [{ id: "c1", title: "益之源 eSpring", series: "", teacher: "" }] }
          : { results: [{ id: "l1", course_id: "c1", title: "eSpring益之源淨水器Pro | 分流器安裝方式", ct: "益之源 eSpring", cs: "" }, { id: "l2", course_id: "c1", title: "美護髮的重點", ct: "美護髮", cs: "" }] },
    };
    return q;
  },
} as never;

test("同音搜尋拆片段：「一支援安裝」＝益之源（同音錯字）＋安裝，中間隔著別的字也找得到，沒有的字不亂配", async () => {
  const r = await phoneticSearch(db, "一支援安裝");
  assert.deepEqual(r.lessons, ["l1"]);
});
