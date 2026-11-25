import assert from "node:assert/strict";
import test from "node:test";
import { phoneticSearch, resetPhoneticCache } from "../src/phonetic-search.ts";

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

test("口語長句：去掉「如何」等虛詞，「一心空氣清淨機濾網如何安裝」找得到逸新的濾網單元", async () => {
  const db2 = {
    prepare(sql: string) {
      const q = {
        bind: () => q,
        first: async () => null,
        all: async () =>
          /FROM courses/.test(sql) && !/lessons/.test(sql)
            ? { results: [{ id: "c1", title: "逸新 atmosphere", series: "", teacher: "" }] }
            : { results: [{ id: "l1", course_id: "c1", title: "安麗抗過敏保健室｜為什濾網要定期清潔、更換及使用原廠耗材的重要性", ct: "逸新 atmosphere", cs: "" }, { id: "l2", course_id: "c2", title: "美護髮的重點", ct: "美護髮", cs: "" }] },
      };
      return q;
    },
  } as never;
  resetPhoneticCache();
  const r = await phoneticSearch(db2, "一心空氣清淨機濾網如何安裝");
  assert.deepEqual(r.lessons, ["l1"]);
});

test("口語長句：多個關鍵詞串在一起（淨水器…空氣清淨機…濾網…）也找得到包含其中詞的單元，沒有關聯的不列", async () => {
  const db3 = {
    prepare(sql: string) {
      const q = {
        bind: () => q,
        first: async () => null,
        all: async () =>
          /FROM courses/.test(sql) && !/lessons/.test(sql)
            ? { results: [] }
            : { results: [{ id: "l1", course_id: "c1", title: "eSpring淨水器濾網更換教學", ct: "益之源 eSpring", cs: "" }, { id: "l2", course_id: "c2", title: "逸新空氣清淨機濾網介紹", ct: "逸新", cs: "" }, { id: "l3", course_id: "c3", title: "美護髮的重點", ct: "美護髮", cs: "" }] },
      };
      return q;
    },
  } as never;
  resetPhoneticCache();
  const r = await phoneticSearch(db3, "淨水器空氣清淨機產品示範濾網濾心優劣勢分析比較廣告醫生專家");
  assert.ok(r.lessons.includes("l1") && r.lessons.includes("l2"));
  assert.ok(!r.lessons.includes("l3"));
});
