import assert from "node:assert/strict";
import { test } from "node:test";
import { itemIconType, classifyUrl } from "../src/link-rules.ts";

test("連結類型規則：網域與路徑判斷、順序、預設", () => {
  const t = (s: string) => classifyUrl(new URL(s));
  assert.equal(t("https://youtu.be/abc"), "youtube");
  assert.equal(t("https://www.youtube.com/watch?v=1"), "youtube");
  assert.equal(t("https://docs.google.com/presentation/d/1/edit"), "google_slides");
  assert.equal(t("https://docs.google.com/document/d/1"), "google_docs");
  assert.equal(t("https://docs.google.com/spreadsheets/d/1"), "google_sheets");
  assert.equal(t("https://docs.google.com/forms/d/1"), "google_forms");
  assert.equal(t("https://docs.google.com/other"), "web");
  assert.equal(t("https://forms.gle/x"), "google_forms");
  assert.equal(t("https://drive.google.com/drive/folders/1"), "google_drive");
  assert.equal(t("https://my.notion.site/a"), "notion");
  assert.equal(t("https://example.com/a/B.PDF"), "pdf");
  assert.equal(t("https://bit.ly/x"), "web");
  assert.equal(itemIconType(undefined, "youtube", true), "youtube");
  assert.equal(itemIconType(undefined, "youtube", false), undefined);
  assert.equal(itemIconType("canva", "demo", true), "canva");
});
