import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { api, HQ_UNIT, UNCATEGORIZED, RequestError, VIEW_SCOPE_LABEL, VIEW_SCOPES, type ViewScope, type CourseDetail, type InviteInfo, type Rank } from "@/api/client";
import { RankTitleRow, useRankOptions } from "@/features/admin/person-extra";
import { confirmSheet } from "@/features/confirm";
import { centerTitle, dateTime, eventDays, ntd, parseLocal, placeText, toLocal } from "@/features/format";
import { isSuperAdmin } from "@/lib/roles";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { AppText, Button, Card, Chips, DateSelect, Field, FormBlock, ListRow, NoticeBox, Pill } from "@/ui";
import { flashText } from "@/ui/flash-notice";
import { Check } from "@/ui/check";
import { EditSheet } from "./edit-sheet";
import { BrandField, CategoryField, HostField } from "./field-groups";
import { ReviewDeskBlock } from "./review-desk";
import { RosterSheet } from "./roster-sheet";
import { YoutubeSyncSheet } from "./youtube-import";
import { afterSheetClose } from "@/lib/sheet-back";

/** 編輯面板的種類（每一區各自一個底部面板、各自儲存）。 */
export type SectionKey = "basics" | "when" | "price" | "enroll" | "advanced" | "status" | "roster" | "youtube";

/** 一次儲存（只送這一區的欄位）：帶 ifUpdatedAt，別人剛改過就先問「重新載入」或「仍要覆蓋」；重要資訊有人報名時先提醒。 */
export function useCourseSave(course: CourseDetail, onSaved: (d: CourseDetail) => void) {
  const { invalidate } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (body: Record<string, unknown>, opts: { important?: string[]; done?: string } = {}): Promise<boolean> => {
    const n = course.admin?.registrations ?? 0;
    if (n > 0 && opts.important?.length) {
      const ok = await confirmSheet({
        title: "這門課已經有人報名",
        message: `已有 ${n} 筆報名。你改了${opts.important.join("、")}；已報名的人照原本的報名內容與金額，不受影響。確定要儲存嗎？`,
        confirmLabel: "確定儲存",
        cancelLabel: "再想想",
      });
      if (!ok) return false;
    }
    setBusy(true);
    setError(null);
    const send = (force: boolean) => api<CourseDetail>("PATCH", `/admin/courses/${course.id}`, { ...body, ifUpdatedAt: course.admin?.updatedAt, ...(force ? { force: true } : {}) });
    try {
      let d: CourseDetail;
      try {
        d = await send(false);
      } catch (e) {
        if (!(e instanceof RequestError) || e.code !== "edit_conflict") throw e;
        const overwrite = await confirmSheet({ title: "剛被別人修改過", message: `${e.message}。`, cancelLabel: "重新載入", confirmLabel: "仍要覆蓋", danger: true });
        if (!overwrite) {
          invalidate();
          return false;
        }
        d = await send(true);
      }
      invalidate();
      onSaved(d);
      flashText(opts.done ?? "已儲存");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { save, busy, error, setError };
}




/** 可複選的圓角選項（分類、主辦單位）。值是「、」分隔文字。 */
export function MultiChips({ options, value, onChange, counts }: { options: string[]; value: string; onChange: (v: string) => void; /** 各選項已有幾堂課（顯示在名稱後面）。 */ counts?: Record<string, number> }) {
  const { c } = useTheme();
  const cur = value.split(/[、,，]+/).map((v) => v.trim()).filter(Boolean);
  return (
    <View style={styles.chips}>
      {options.map((x) => {
        const on = cur.includes(x);
        return (
          <Pressable
            key={x}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            onPress={() => onChange((on ? cur.filter((v) => v !== x) : [...cur, x]).join("、"))}
            style={[styles.catChip, { borderColor: on ? c.accent : c.border, backgroundColor: on ? c.accentSoft : c.surface }]}
          >
            <Ionicons name={on ? "checkbox" : "square-outline"} size={20} color={on ? c.accent : c.textMuted} />
            <AppText variant="callout" style={{ color: on ? c.accentText : c.text, fontWeight: on ? "700" : "400" }}>
              {counts ? `${x === HQ_UNIT ? x : centerTitle(x)}（${counts[x] ?? 0}）` : x}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <AppText variant="callout" tone="muted">
      {children}
    </AppText>
  );
}

const same = (a: Record<string, unknown>, b: Record<string, unknown>) => JSON.stringify(a) === JSON.stringify(b);

// ---------- 基本資料：名稱、主講人、分類、系列（封面顏色已刪除，無 EDM 時文字封面顏色自動隨機） ----------
/** 基本資料欄位（杜杜龍 2026-11-17）：編輯面板「基本資料」與「新增課程」是同一組欄位，只在這裡維護。 */
export type BasicsForm = { isShorts: boolean; title: string; /** 勾了「無」：沒有主講人、獎銜、職稱（杜杜龍 2026-11-19）。 */ noSpeaker: boolean; /** 套裝課程（杜杜龍 2026-11-19）：只是分類篩選用途；日期區間 7 天以上自動勾選，可手動取消。 */ isPackage: boolean; teacher: string; teacherRank: string; teacherTitle: string; eventStart: string; eventEnd: string; category: string; series: string; brandId: string; /** 專區（只有超級管理員能改）。 */ zone: string };
const DAY_MS = 86_400_000;
/** 開始到結束相差幾天（沒有結束日期＝0）。 */
const spanDays = (start: string, end: string) => (start && end ? Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS) : 0);

/**
 * 課程日期（杜杜龍 2026-11-19）：勾「修改日期」才顯示開始日期欄位；填了開始日期才出現「＋輸入結束日期」；有日期就有「清除日期」；
 * 取消勾選只收起欄位、日期保留；已經讀到日期（影片或素材系統帶入）時，日期以純文字顯示在勾選框右邊，勾了「修改日期」才能改。
 * 日期區間從不到 7 天變成 7 天以上時，自動勾選「套裝課程」（之後可手動取消）。
 */
function DateEditor({ f, setF }: { f: BasicsForm; setF: React.Dispatch<React.SetStateAction<BasicsForm>> }) {
  const { c } = useTheme();
  const [editing, setEditing] = useState(false);
  const [showEnd, setShowEnd] = useState(false);
  const apply = (start: string, end: string) =>
    setF((x) => ({ ...x, eventStart: start, eventEnd: start ? end : "", ...(spanDays(start, end) >= 7 && spanDays(x.eventStart, x.eventEnd) < 7 ? { isPackage: true } : {}) }));
  const toggle = () => {
    setEditing(!editing); // 取消勾選只是收起編輯欄位，已設定的日期保留
  };
  const shown = f.eventStart ? `${f.eventStart}${f.eventEnd ? ` ～ ${f.eventEnd}` : ""}` : "";
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: editing }} onPress={toggle} style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44 }}>
          <Ionicons name={editing ? "checkbox" : "square-outline"} size={28} color={editing ? c.accent : c.textMuted} />
          <AppText variant="body">修改日期</AppText>
        </Pressable>
        {!editing && shown ? <AppText variant="body" tone="muted">{shown}</AppText> : null}
      </View>
      {editing ? (
        <>
          <DateSelect label="開始日期" value={f.eventStart} onChange={(v) => apply(v, f.eventEnd)} />
          {f.eventStart && (showEnd || f.eventEnd) ? <DateSelect label="結束日期" value={f.eventEnd} defaultValue={f.eventStart} onChange={(v) => apply(f.eventStart, v)} /> : null}
          {f.eventStart && !showEnd && !f.eventEnd ? <Button variant="secondary" label="＋輸入結束日期" onPress={() => setShowEnd(true)} fullWidth /> : null}
          {f.eventStart ? (
            <View style={{ alignItems: "flex-end" }}>
              <Pressable accessibilityRole="button" accessibilityLabel="清除日期" onPress={() => (apply("", ""), setShowEnd(false))} style={{ paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radius.md, borderWidth: 1, borderColor: c.danger }}>
                <AppText variant="caption" style={{ color: c.danger, fontWeight: "700" }}>
                  清除日期
                </AppText>
              </Pressable>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

export function BasicsFields({ isList, f, setF }: { isList: boolean; f: BasicsForm; setF: React.Dispatch<React.SetStateAction<BasicsForm>> }) {
  const { member } = useSession();
  const isSuper = isSuperAdmin(member);
  const set = <K extends keyof BasicsForm>(k: K) => (v: BasicsForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const rankOptions = useRankOptions();
  const series = useApi<string[]>(isSuper ? "/admin/series" : null);
  return (
    <>
      <Field label={"教材卡名稱（必填）"} value={f.title} onChange={set("title")} placeholder={isList ? "例如：美力之星精彩回顧" : "例如：翡翠達標班"} />
      {/* 教材卡只剩一種（杜杜龍 2026-11-20）：主講人、日期、套裝課程欄位一律都有。 */}
      {(
        <>
          {/* 沒有主講人（杜杜龍 2026-11-19）：勾「無」＝主講人、獎銜、職稱三個欄位隱藏並清空，專屬網址改用課程名稱的英譯＋編號。 */}
          <Check label="無（這門課沒有主講人、獎銜、職稱）" value={f.noSpeaker} onChange={(v) => setF((x) => ({ ...x, noSpeaker: v, ...(v ? { teacher: "", teacherRank: "", teacherTitle: "" } : {}) }))} />
          {f.noSpeaker ? (
            <AppText variant="caption" tone="muted">
              分享用的短網址會用課程名稱的英譯加上編號。
            </AppText>
          ) : (
            <>
              <Field label="主講人" value={f.teacher} onChange={set("teacher")} placeholder="例如：王大明（選填）" />
              <RankTitleRow rank={f.teacherRank} title={f.teacherTitle} onRank={set("teacherRank")} onTitle={set("teacherTitle")} rankOptions={rankOptions} who="主講人" />
            </>
          )}
          <DateEditor f={f} setF={setF} />
          <Check label="套裝課程（分類用途，不影響版面與功能）" value={f.isPackage} onChange={set("isPackage")} />
        </>
      )}
      {/* 「短影音專輯」勾選已併入「素材」（杜杜龍 2026-11-17）：素材的項目在「單元」頁一律歸類為短影音。 */}
      {isSuper ? (
        <>
          <FormBlock collapsible title="系列卡（顯示在課程首頁）" hint="同系列合併成一張系列卡；必須設定系列才會顯示在課程首頁，沒設定就暫時放入「未分類」（只有超級管理員看得到）">
            <Field label="" value={f.series} onChange={set("series")} placeholder="例如：翡翠達標班" />
            <Chips label="已有的系列" options={[{ key: UNCATEGORIZED, label: UNCATEGORIZED }, ...(series.data ?? []).filter((x) => x !== UNCATEGORIZED).map((x) => ({ key: x, label: x }))]} value={f.series || UNCATEGORIZED} onChange={set("series")} />
          </FormBlock>
        </>
      ) : null}
      <CategoryField collapsible value={f.category} onChange={set("category")} withInput />
      <BrandField collapsible value={f.brandId} onChange={set("brandId")} />
    </>
  );
}

function BasicsSheet({ course, onClose, onSaved }: SheetProps) {
  const { member } = useSession();
  const isSuper = isSuperAdmin(member);
  const init: BasicsForm = { isShorts: course.isShorts, title: course.title, noSpeaker: course.noSpeaker ?? false, isPackage: course.isPackage ?? false, teacher: course.teacher ?? "", teacherRank: course.teacherRank ?? "", teacherTitle: course.teacherTitle ?? "", eventStart: course.eventStart ?? "", eventEnd: course.eventEnd ?? "", category: course.category, series: course.series ?? "", brandId: course.brandId ?? "", zone: course.zone };
  const [f, setF] = useState(init);
  // 素材第二層短網址（杜杜龍 2026-11-17）：只有素材、只有超級管理員；系列那一層仍在「設定 > 短網址設定」集中管理。
  const [matUrl, setMatUrl] = useState(course.matUrl ?? "");
  const links = useApi<{ kind: string; value: string; slug: string }[]>(course.isList && isSuper ? "/short-links" : null);
  const seriesSlug = links.data?.find((l) => l.kind === "series" && l.value === (course.series || f.series))?.slug;
  const { save, busy, error, setError } = useCourseSave(course, onSaved);
  const submit = async () => {
    if (!f.title.trim()) return setError("請輸入教材卡名稱");
    const { series: _series, zone, eventStart, eventEnd, ...rest } = f;
    // 日期與「時間與地點」面板是同一份資料；清單卡沒有日期，不送。
    const dates = { eventStart: eventStart || null, eventEnd: eventStart ? eventEnd || null : null };
    const important = (eventStart !== init.eventStart || eventEnd !== init.eventEnd) ? ["日期"] : [];
    const matBody = course.isList && isSuper && matUrl.trim().toLowerCase() !== (course.matUrl ?? "") ? { matUrl: matUrl.trim() } : {};
    if (await save({ ...(isSuper ? { ...rest, series: f.series, ...(zone !== init.zone ? { zone } : {}) } : rest), ...dates, ...matBody }, { important })) onClose();
  };
  return (
    <EditSheet
     
      title="基本資料"
      onClose={onClose} onSave={submit} dirty={!same(init, f) || matUrl.trim().toLowerCase() !== (course.matUrl ?? "")} busy={busy} error={error}>
      {course.isList && isSuper ? (
        <View style={{ gap: space.xs }}>
          <Label>清單網址（只有超級管理員能設定）</Label>
          {seriesSlug ? (
            <>
              <AppText variant="caption" tone="muted">
                learn.hglobal1985.com/{seriesSlug}/
              </AppText>
              <Field label="" value={matUrl} onChange={(v) => setMatUrl(v.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="例如：2027-final（英文、數字、短橫線）" />
              {matUrl ? (
                <AppText variant="callout" style={{ fontWeight: "700" }}>
                  完整網址：learn.hglobal1985.com/{seriesSlug}/{matUrl}
                </AppText>
              ) : null}
              <AppText variant="caption" tone="muted">
                同一個系列內不能重複；改名後舊網址仍然有效。
              </AppText>
            </>
          ) : (
            <NoticeBox text="這張教材卡還沒有系列短網址。請先把教材卡放進系列，並到「設定 › 短網址設定」替這個系列設定英文短網址，才能設定清單網址。" />
          )}
        </View>
      ) : null}
      <BasicsFields isList={course.isList} f={f} setF={setF} />
    </EditSheet>
  );
}

// ---------- 時間與地點 ----------
function WhenSheet({ course, onClose, onSaved }: SheetProps) {
  const init = { eventStart: course.eventStart ?? "", eventEnd: course.eventEnd ?? "", location: course.location, locationNone: course.locationNone, isOnline: course.isOnline };
  const [f, setF] = useState(init);
  const locations = useApi<string[]>("/admin/locations");
  const { save, busy, error } = useCourseSave(course, onSaved);
  const submit = async () => {
    const important = [f.eventStart !== init.eventStart || f.eventEnd !== init.eventEnd ? "日期" : "", f.location !== init.location || f.locationNone !== init.locationNone || f.isOnline !== init.isOnline ? "地點" : ""].filter(Boolean);
    if (await save({ ...f, eventStart: f.eventStart || null, eventEnd: f.eventEnd || null }, { important })) onClose();
  };
  return (
    <EditSheet title="時間與地點" onClose={onClose} onSave={submit} dirty={!same(init, f)} busy={busy} error={error}>
      <DateSelect label="活動開始日期" value={f.eventStart} onChange={(v) => setF((x) => ({ ...x, eventStart: v, ...(v ? {} : { eventEnd: "" }) }))} />
      {f.eventStart ? <DateSelect label="活動結束日期（連續多天才設定，單日不用）" value={f.eventEnd} defaultValue={f.eventStart} onChange={(v) => setF((x) => ({ ...x, eventEnd: v }))} /> : null}
      <AppText variant="caption" tone="muted">
        顯示在教材卡、首頁與「全部課程」的排序。
      </AppText>
      <Field label="地點" value={f.location} onChange={(v) => setF((x) => ({ ...x, location: v }))} placeholder="例如：台北總部教室" />
      <Check label="不顯示地點" value={f.locationNone} onChange={(v) => setF((x) => ({ ...x, locationNone: v }))} />
      <Check label="線上課程（地點顯示「線上課程」）" value={f.isOnline} onChange={(v) => setF((x) => ({ ...x, isOnline: v }))} />
      {!f.locationNone && !f.isOnline && locations.data?.length ? <Chips title="已有的場地（點一下帶入）" label="已有的場地" options={locations.data.map((x) => ({ key: x, label: x }))} value={f.location} onChange={(v) => setF((x) => ({ ...x, location: v }))} /> : null}
    </EditSheet>
  );
}

// ---------- 費用：價格、尚未公布、鑽石免費、早鳥、限時免費 ----------
function PriceSheet({ course, onClose, onSaved }: SheetProps) {
  const { c } = useTheme();
  const init = {
    priceTwd: String(course.admin?.basePriceTwd ?? course.priceTwd ?? 0),
    priceTba: course.priceTba,
    diamondFree: course.diamondFree,
    earlyBird: !!course.earlyBird,
    earlyPriceTwd: course.earlyBird?.priceTwd != null ? String(course.earlyBird.priceTwd) : "",
    earlyUntil: course.earlyBird?.until ?? "",
    freeFrom: toLocal(course.admin?.freeFrom).slice(0, 10), // 只選日期；開始＝當天 00:00、結束＝當天 23:59（杜杜龍 2026-11-18：日期一律用日期選單）
    freeUntil: toLocal(course.admin?.freeUntil).slice(0, 10),
  };
  const [f, setF] = useState(init);
  const { save, busy, error, setError } = useCourseSave(course, onSaved);
  const price = Number(f.priceTwd);
  const submit = async () => {
    if (!Number.isInteger(price) || price < 0) return setError("費用請輸入 0 以上的整數");
    const freeFrom = f.freeFrom ? parseLocal(`${f.freeFrom} 00:00`) : null;
    const freeUntil = f.freeUntil ? parseLocal(`${f.freeUntil} 23:59`) : null;
    if (freeFrom === undefined || freeUntil === undefined) return setError("限時免費的日期不正確");
    if (freeFrom && freeUntil && freeUntil < freeFrom) return setError("限時免費的結束日期不能早於開始日期");
    const early = f.earlyBird && !f.priceTba && price > 0;
    if (early) {
      const ep = Number(f.earlyPriceTwd);
      if (!Number.isInteger(ep) || ep < 1 || ep >= price) return setError("早鳥優惠價請輸入比原價低的整數金額");
      if (!f.earlyUntil) return setError("請設定早鳥優惠的截止日期");
    }
    const important = price !== Number(init.priceTwd) || f.priceTba !== init.priceTba ? ["費用"] : [];
    const body: Record<string, unknown> = { priceTwd: price, priceTba: f.priceTba, diamondFree: f.diamondFree, earlyBird: early, earlyPriceTwd: Number(f.earlyPriceTwd), earlyUntil: f.earlyUntil, freeFrom, freeUntil };
    if (await save(body, { important })) onClose();
  };
  return (
    <EditSheet title="費用與審核" onClose={onClose} onSave={submit} dirty={!same(init, f)} busy={busy} error={error}>
      <Label>報名費用（新台幣，0＝免費）</Label>
      <TextInput
        value={f.priceTwd}
        onChangeText={(v) => setF((x) => ({ ...x, priceTwd: v.replace(/\D/g, "") }))}
        editable={!f.priceTba}
        keyboardType="number-pad"
        accessibilityLabel="報名費用"
        style={[styles.input, type.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface, opacity: f.priceTba ? 0.5 : 1 }]}
      />
      <Check label="費用尚未公布（暫不開放報名）" value={f.priceTba} onChange={(v) => setF((x) => ({ ...x, priceTba: v }))} />
      <Check label="鑽石（含）以上獎銜報名免費" value={f.diamondFree} onChange={(v) => setF((x) => ({ ...x, diamondFree: v }))} />
      {!f.priceTba && price > 0 ? (
        <>
          <Check label="早鳥優惠" value={f.earlyBird} onChange={(v) => setF((x) => ({ ...x, earlyBird: v }))} />
          {f.earlyBird ? (
            <>
              <Field label="早鳥優惠價（要比原價低）" value={f.earlyPriceTwd} onChange={(v) => setF((x) => ({ ...x, earlyPriceTwd: v.replace(/\D/g, "") }))} numeric placeholder="例如：800" />
              <DateSelect label="早鳥優惠截止日期（含當天，台灣時間）" value={f.earlyUntil} clearable={false} onChange={(v) => setF((x) => ({ ...x, earlyUntil: v }))} />
            </>
          ) : null}
          <Label>限時免費（選填）：期間內報名免費、自動開通</Label>
          <DateSelect label="開始日期（空白＝立即，當天 00:00 起）" value={f.freeFrom} onChange={(v) => setF((x) => ({ ...x, freeFrom: v }))} />
          <DateSelect label="結束日期（空白＝不設定，當天 23:59 止）" value={f.freeUntil} onChange={(v) => setF((x) => ({ ...x, freeUntil: v }))} />
          <AppText variant="caption" tone="muted">
            兩欄都空白表示不啟用；結束後恢復原價。
          </AppText>
        </>
      ) : null}
      {f.priceTba ? <Pill label="費用尚未公布：課程頁顯示「費用尚未公布」，暫不開放報名" tone="warning" /> : price === 0 ? <Pill label="免費課程：報名後立即開通" tone="accent" /> : <Pill label="付費課程：報名後需審核繳費才開通" tone="warning" />}
      <ReviewDeskBlock course={course} />
    </EditSheet>
  );
}

// ---------- 報名資格條件：誰能瀏覽課程、最低獎銜（預設收起）、其他（審核群組移到「費用與審核」的審核窗口） ----------
function EnrollSheet({ course, onClose, onSaved }: SheetProps) {
  const { member } = useSession();
  const isSuper = isSuperAdmin(member);
  const invite = useApi<InviteInfo>(`/admin/courses/${course.id}/invite`);
  const init = { minRankCode: course.minRank.code, allowPresident: course.allowPresident, viewScope: course.viewScope, inviteOnly: course.inviteOnly };
  const [f, setF] = useState(init);
  // 邀請碼（明碼）：另外讀取，讀回來才填入；付費課程只有超級管理員能設定（杜杜龍 2026-11-20）。
  const [code, setCode] = useState("");
  const [codeOn, setCodeOn] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [codeInit, setCodeInit] = useState("");
  useEffect(() => {
    if (invite.data && !loaded) {
      setCode(invite.data.code);
      setCodeInit(invite.data.code);
      setCodeOn(invite.data.code !== "");
      setLoaded(true);
    }
  }, [invite.data, loaded]);
  const paid = (course.priceTwd ?? 0) > 0 || course.priceTba;
  const codeLocked = paid && !isSuper;
  const [rankOpen, setRankOpen] = useState(false);
  // 杜杜龍 2026-11-17 規則 B：「所有人含訪客」只代表任何人都看得到介紹，獎銜限制照樣可以設定（沒有獎銜的人看得到、不能報名）。
  const ranks = useApi<Rank[]>("/ranks");
  const { save, busy, error } = useCourseSave(course, onSaved);
  const finalCode = f.inviteOnly && codeOn ? code.trim() : "";
  const codeChanged = loaded && finalCode !== codeInit;
  const submit = async () => {
    if (f.inviteOnly && codeOn && !code.trim()) {
      flashText("請輸入邀請碼，或取消勾選邀請碼");
      return;
    }
    const body: Record<string, unknown> = { ...f };
    if (codeChanged && !codeLocked) body.inviteCode = finalCode;
    if (await save(body)) onClose();
  };
  const rankName = ranks.data?.find((r) => r.code === f.minRankCode)?.name ?? course.minRank.name;
  const dirty = !same(init, f) || (codeChanged && !codeLocked);
  return (
    <EditSheet title="報名資格條件" onClose={onClose} onSave={submit} dirty={dirty} busy={busy} error={error}>
      <AppText variant="headline">誰能瀏覽課程？</AppText>
      <Chips title="瀏覽範圍" options={VIEW_SCOPES.map((k) => ({ key: k, label: VIEW_SCOPE_LABEL[k] }))} value={f.viewScope} onChange={(v) => (setF((x) => ({ ...x, viewScope: v as ViewScope })), (v === "all" || v === "link_guest") && setRankOpen(false))} />
      <AppText variant="caption" tone="muted">
        {f.viewScope === "link_login" || f.viewScope === "link_guest"
          ? "私密連結：不會出現在行動大學的任何清單與搜尋，只有拿到網址的人才看得到。"
          : "不在範圍內的人，這門課不會出現在清單與搜尋，也不能報名；已報名的學員照常看得到。"}
      </AppText>
      <AppText variant="headline">報名方式</AppText>
      <Check label="指定邀請制" value={f.inviteOnly} onChange={(v) => setF((x) => ({ ...x, inviteOnly: v }))} />
      {f.inviteOnly ? (
        <>
          <NoticeBox text="指定邀請制：不看獎銜，所有人報名都要人工審核（免費課程也一樣），審核人員會收到通知。" />
          <Check label="設定邀請碼（密碼）" value={codeOn} onChange={(v) => !codeLocked && setCodeOn(v)} />
          {codeOn ? (
            <>
              <Field label="邀請碼（明碼，可以很簡單，不限複雜度）" value={code} onChange={(v) => !codeLocked && setCode(v.slice(0, 40))} placeholder="例如：8888" />
              <AppText variant="caption" tone="muted">
                學員按「報名課程」後，可輸入邀請碼：輸入正確就不用審核、直接開通，並通知管理員；沒有邀請碼的人按「無邀請碼」改由人工審核。連續輸錯 5 次會暫停 10 分鐘。
              </AppText>
              {codeLocked ? <NoticeBox text="付費課程的邀請碼目前只有超級管理員可以設定。" /> : null}
            </>
          ) : null}
        </>
      ) : null}
      <View style={f.inviteOnly ? { opacity: 0.45 } : undefined} pointerEvents={f.inviteOnly ? "none" : "auto"}>
        <AppText variant="headline">最低獎銜（誰可以報名）</AppText>
        <View style={styles.rankRow}>
          <AppText variant="body" style={{ flex: 1 }}>
            {rankName}
          </AppText>
          <Pressable accessibilityRole="button" accessibilityLabel={rankOpen ? "收起獎銜" : "展開獎銜"} onPress={() => setRankOpen((v) => !v)} style={[styles.rankToggle, { borderColor: "#00000022" }]}>
            <AppText variant="callout" style={{ fontWeight: "700" }}>
              {rankOpen ? "收起" : "展開"}
            </AppText>
          </Pressable>
        </View>
      </View>
      {f.inviteOnly ? <NoticeBox text="🔒 無法選擇獎銜：已勾選「指定邀請制」，這門課不看獎銜，改由審核人員人工把關。取消勾選就可以重新設定獎銜。" /> : null}
      {!f.inviteOnly && (f.viewScope === "all" || f.viewScope === "link_guest") ? (
        <NoticeBox text="訪客也看得到這門課的介紹；設了獎銜限制，沒有達到獎銜的人（包含訪客）只能看介紹，不能報名、也看不到章節內容。" />
      ) : null}
      {rankOpen && !f.inviteOnly ? <Chips options={(ranks.data ?? []).map((r) => ({ key: r.code, label: r.name }))} value={f.minRankCode} onChange={(v) => setF((x) => ({ ...x, minRankCode: v }))} /> : null}
      <AppText variant="headline">其他</AppText>
      <Check label="會長不受獎銜限制也可報名" value={f.allowPresident} onChange={(v) => setF((x) => ({ ...x, allowPresident: v }))} />
      <NoticeBox text="審核群組與審核人員改在「費用與審核」的「審核窗口」設定。" />
    </EditSheet>
  );
}

// ---------- 進階設定：指導／主辦單位、顯示選項、課程介紹、短網址、最後修改 ----------
function AdvancedSheet({ course, onClose, onSaved }: SheetProps) {
  const { member } = useSession();
  const isHq = member?.role === "admin";
  const init = { hostUnit: course.hostUnit, chapterCovers: course.chapterCovers, blockPhotos: course.blockPhotos };
  const [f, setF] = useState(init);
  const { save, busy, error } = useCourseSave(course, onSaved);
  const submit = async () => {
    const body: Record<string, unknown> = { ...f };
    if (!isHq) delete body.hostUnit; // 中心的人不能改主辦中心
    if (!isHq) delete body.blockPhotos;
    if (await save(body)) onClose();
  };
  return (
    <EditSheet title="進階設定" onClose={onClose} onSave={submit} dirty={!same(init, f)} busy={busy} error={error}>
      <HostField title="主辦單位" value={f.hostUnit} fixed={course.hostUnit || member?.center || ""} onChange={(v) => setF((x) => ({ ...x, hostUnit: v }))} />
      <Check label="章節各自設定封面" value={f.chapterCovers} onChange={(v) => setF((x) => ({ ...x, chapterCovers: v }))} />
      {/* 區塊可新增照片（杜杜龍 2026-11-24 試行：先只有成交百寶箱；只有超級管理員可以開關）。 */}
      {member?.role === "admin" ? <Check label="區塊可新增照片（試行中）" value={f.blockPhotos} onChange={(v) => setF((x) => ({ ...x, blockPhotos: v }))} /> : null}
      <AppText variant="caption" tone="muted">
        {course.admin?.editedAt ? `最後修改：${course.admin.editedByName || "（未記錄）"}　${dateTime(course.admin.editedAt)}` : "最後修改：（還沒有紀錄）"}
      </AppText>
    </EditSheet>
  );
}

// ---------- 上架、下架、複製、下架封存、刪除 ----------
function StatusSheet({ course, onClose, onSaved }: SheetProps) {
  const { invalidate } = useSession();
  const { save, busy, error, setError } = useCourseSave(course, onSaved);
  const [working, setWorking] = useState(false);
  const can = course.can ?? course.admin?.can;
  const n = course.admin?.registrations ?? 0;
  const status = course.status;
  const duplicate = async () => {
    if (!(await confirmSheet({ title: "複製這門課，建立下一梯", message: "會建立一門新的未上架課程（名稱後面加「（複製）」），帶入費用、資格、章節架構，並放進同一個系列。活動日期、EDM、附件和音檔不會帶過去。", confirmLabel: "複製", cancelLabel: "先不要" }))) return;
    setWorking(true);
    try {
      const copy = await api<CourseDetail>("POST", `/admin/courses/${course.id}/duplicate`, {});
      invalidate();
      onClose();
      afterSheetClose(() => router.push({ pathname: "/course/[id]", params: { id: copy.id, edit: "1" } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };
  const archive = async () => {
    if (!(await confirmSheet({ title: "下架封存", message: `「${course.title}」已有 ${n} 筆報名，不能永久刪除。下架封存後：不再出現在全部課程、不能再報名；已報名的學員照常上課。之後可以由總部、會長或音控還原。`, confirmLabel: "下架封存", cancelLabel: "先不要", danger: true }))) return;
    if (await save({ status: "archived" }, { done: "已下架封存" })) onClose();
  };
  const remove = async () => {
    if (!(await confirmSheet({ title: "刪除課程", message: `確定永久刪除「${course.title}」？章節、EDM、附件與音檔會一併刪除，無法復原。`, confirmLabel: "永久刪除", cancelLabel: "先不要", danger: true }))) return;
    setWorking(true);
    try {
      await api("DELETE", `/admin/courses/${course.id}`);
      invalidate();
      onClose();
      flashText("已刪除課程");
      afterSheetClose(() => router.replace("/courses"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };
  return (
    <EditSheet title="上架與刪除" onClose={onClose} busy={busy || working} error={error} hideSave>
      <View style={styles.row}>
        <Label>目前狀態</Label>
        <Pill label={status === "published" ? "上架中" : status === "archived" ? "已下架封存" : "未上架"} tone={status === "published" ? "success" : "danger"} />
      </View>
      {status === "archived" ? (
        can?.restore ? (
          <ActionRow icon="refresh-outline" title="還原（重新上架）" subtitle="重新出現在全部課程、可以報名" onPress={async () => (await save({ status: "published" }, { done: "已還原並上架" })) && onClose()} />
        ) : (
          <NoticeBox text="已下架封存。還原只有總部、會長與音控可以做。" />
        )
      ) : (
        <>
          {can?.edit ? (
            status === "published" ? (
              <ActionRow icon="eye-off-outline" title="下架（暫時收起來）" subtitle="學員看不到，之後可以再上架" onPress={async () => (await save({ status: "draft" }, { done: "已下架" })) && onClose()} />
            ) : (
              <ActionRow icon="eye-outline" title="上架" subtitle="出現在全部課程，開始可以報名" onPress={async () => (await save({ status: "published" }, { done: "已上架" })) && onClose()} />
            )
          ) : null}
          <ActionRow icon="copy-outline" title="複製這門課，建立下一梯" subtitle="新課程先不上架" onPress={duplicate} />
          {can?.remove ? (
            n > 0 ? (
              <ActionRow icon="archive-outline" title="下架封存" subtitle={`已有 ${n} 筆報名：結束、不再開的課（不是永久刪除）`} danger onPress={archive} />
            ) : (
              <ActionRow icon="trash-outline" title="刪除課程" subtitle="完全沒有人報名：永久刪除，無法復原" danger onPress={remove} />
            )
          ) : null}
        </>
      )}
    </EditSheet>
  );
}

function ActionRow({ icon, title, subtitle, onPress, danger }: { icon: "eye-outline" | "eye-off-outline" | "copy-outline" | "archive-outline" | "trash-outline" | "refresh-outline"; title: string; subtitle: string; onPress: () => void; danger?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.action, { borderColor: danger ? c.danger : c.border }]}>
      <Ionicons name={icon} size={24} color={danger ? c.danger : c.text} />
      <View style={{ flex: 1 }}>
        <AppText variant="headline" style={danger ? { color: c.danger } : undefined}>
          {title}
        </AppText>
        <AppText variant="caption" tone="muted">
          {subtitle}
        </AppText>
      </View>
    </Pressable>
  );
}

type SheetProps = { course: CourseDetail; onClose: () => void; onSaved: (d: CourseDetail) => void };

export function SectionSheet({ section, ...p }: SheetProps & { section: SectionKey }) {
  if (section === "basics") return <BasicsSheet {...p} />;
  if (section === "when") return <WhenSheet {...p} />;
  if (section === "price") return <PriceSheet {...p} />;
  if (section === "enroll") return <EnrollSheet {...p} />;
  if (section === "advanced") return <AdvancedSheet {...p} />;
  if (section === "roster") return <RosterSheet course={p.course} onClose={p.onClose} />;
  if (section === "youtube") return <YoutubeSyncSheet course={p.course} onClose={p.onClose} />;
  return <StatusSheet {...p} />;
}

/** 編輯模式中，課程頁上的「課程設定」清單：每一列點了從下方彈出那一區。副標顯示目前設定，一眼看得到。 */
export function SectionList({ course, onOpen }: { course: CourseDetail; onOpen: (s: SectionKey) => void }) {
  const price = course.admin?.basePriceTwd ?? 0;
  const priceText = course.priceTba ? "費用尚未公布" : price === 0 ? "免費" : `${ntd(price)}${course.earlyBird ? "・早鳥" : ""}${course.diamondFree ? "・鑽石免費" : ""}`;
  const when = [course.eventStart ? eventDays(course.eventStart, course.eventEnd) : "未設定日期", placeText(course)].filter(Boolean).join("・");
  const statusText = course.status === "published" ? "上架中" : course.status === "archived" ? "已下架封存" : "未上架";
  return (
    <Card style={{ paddingVertical: 0 }}>
      <ListRow icon="create-outline" title="基本資料" subtitle={[course.title, course.teacher && `主講 ${course.teacher}`, course.category, course.series && `系列 ${course.series}`].filter(Boolean).join("・")} onPress={() => onOpen("basics")} />
      {/* 清單卡沒有時間地點與費用（一律公開免費）。 */}
      <ListRow icon="calendar-outline" title="時間與地點" subtitle={when} onPress={() => onOpen("when")} />
      <ListRow icon="pricetag-outline" title="費用與審核" subtitle={priceText} onPress={() => onOpen("price")} />
      <ListRow icon="people-outline" title="報名資格條件" subtitle={`${course.minRank.name}以上${course.allowPresident ? "（會長也可）" : ""}・${VIEW_SCOPE_LABEL[course.viewScope]}`} onPress={() => onOpen("enroll")} />
      <ListRow icon="options-outline" title="進階設定" subtitle={`主辦：${course.hostUnit || "未設定"}${course.admin?.editedAt ? `・最後修改 ${course.admin.editedByName}` : ""}`} onPress={() => onOpen("advanced")} />
      <ListRow icon="eye-outline" title="上架與刪除" subtitle={statusText} onPress={() => onOpen("status")} />
      <ListRow icon="list-outline" title="報名名單" subtitle="查看報名學員、匯出 CSV、移除資格" onPress={() => onOpen("roster")} />
      <ListRow icon="logo-youtube" title="YouTube 播放清單" subtitle="匯入播放清單、同步新影片" onPress={() => onOpen("youtube")} />
      {/* 作業（杜杜龍 2026-11-25）：出作業、批改評分、學員分組，開新頁面操作 */}
      {course.isList ? null : <ListRow icon="document-text-outline" title="作業與批改" subtitle="出作業、看誰交了、評分與評語" onPress={() => router.push(`/homework/${course.id}`)} />}
      {course.isList ? null : <ListRow icon="people-outline" title="學員分組" subtitle="排組、指定組長（組長可看同組作業）" onPress={() => router.push(`/homework/groups/${course.id}`)} />}
    </Card>
  );
}

const styles = StyleSheet.create({
  rankRow: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: minTouch },
  rankToggle: { minWidth: 72, minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md },
  hostRow: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  catChip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: minTouch - 4, paddingHorizontal: space.md, borderWidth: 1.5, borderRadius: radius.pill },
  input: { minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
  swatch: { width: minTouch, height: minTouch, borderRadius: minTouch / 2, borderWidth: 2, padding: 4 },
  swatchInner: { flex: 1, borderRadius: minTouch / 2 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  action: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 64, padding: space.md, borderWidth: 1, borderRadius: radius.md },
});
