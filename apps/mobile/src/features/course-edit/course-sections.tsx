import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { api, HQ_UNIT, RequestError, VIEW_SCOPE_LABEL, VIEW_SCOPES, type ViewScope, type CourseDetail, type CourseSummary, type Rank } from "@/api/client";
import { RankTitleRow, useRankOptions } from "@/features/admin/person-extra";
import { confirmSheet } from "@/features/confirm";
import { centerTitle, dateTime, eventDays, ntd, parseLocal, placeText, toLocal } from "@/features/format";
import { isSuperAdmin } from "@/lib/roles";
import { useApi, useSession } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { courseThemes, minTouch, radius, space, type } from "@/theme/tokens";
import { AppText, Card, Chips, DateSelect, Field, ListRow, NoticeBox, Pill } from "@/ui";
import { showToast } from "@/ui/toast";
import { EditSheet } from "./edit-sheet";
import { ReviewDeskBlock } from "./review-desk";

/** 編輯面板的種類（每一區各自一個底部面板、各自儲存）。 */
export type SectionKey = "basics" | "when" | "price" | "enroll" | "advanced" | "status";

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
      showToast(opts.done ?? "已儲存");
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

/** 各主辦單位已有幾堂課（一門課可有多個主辦單位，每個各算一次）。 */
export function countByHost(list: { hostUnit: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of list) for (const h of x.hostUnit.split(/[、,，]+/).map((v) => v.trim()).filter(Boolean)) out[h] = (out[h] ?? 0) + 1;
  return out;
}

/** 勾選框（整列可點、觸控夠大）。 */
export function Check({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: value, disabled }} disabled={disabled} onPress={() => onChange(!value)} style={[styles.check, disabled && { opacity: 0.5 }]}>
      <Ionicons name={value ? "checkbox" : "square-outline"} size={28} color={value ? c.accent : c.textMuted} />
      <AppText variant="body" style={{ flex: 1 }}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** 可複選的圓角選項（分類、主辦單位）。值是「、」分隔文字。 */
function MultiChips({ options, value, onChange, counts }: { options: string[]; value: string; onChange: (v: string) => void; /** 各選項已有幾堂課（顯示在名稱後面）。 */ counts?: Record<string, number> }) {
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

// ---------- 基本資料：名稱、主講人、分類、系列、封面顏色 ----------
/** 基本資料欄位（業主 2026-11-17）：編輯面板「基本資料」與「新增課程」是同一組欄位，只在這裡維護。 */
export type BasicsForm = { isShorts: boolean; title: string; teacher: string; teacherRank: string; teacherTitle: string; eventStart: string; eventEnd: string; category: string; series: string; theme: string };
export function BasicsFields({ isList, f, setF }: { isList: boolean; f: BasicsForm; setF: React.Dispatch<React.SetStateAction<BasicsForm>> }) {
  const { c } = useTheme();
  const { member } = useSession();
  const isSuper = isSuperAdmin(member);
  const set = <K extends keyof BasicsForm>(k: K) => (v: BasicsForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const rankOptions = useRankOptions();
  const categories = useApi<string[]>("/admin/categories");
  const series = useApi<string[]>(isSuper ? "/admin/series" : null);
  return (
    <>
      <Field label={isList ? "素材清單名稱（必填）" : "課程名稱（必填）"} value={f.title} onChange={set("title")} placeholder={isList ? "例如：美力之星精彩回顧" : "例如：翡翠達標班"} />
      {/* 素材清單沒有主講人、職稱、獎銜（業主 2026-11-16）。 */}
      {isList ? null : (
        <>
          <Field label="主講人" value={f.teacher} onChange={set("teacher")} placeholder="例如：王大明（選填）" />
          <RankTitleRow rank={f.teacherRank} title={f.teacherTitle} onRank={set("teacherRank")} onTitle={set("teacherTitle")} rankOptions={rankOptions} who="主講人" />
          <DateSelect label="活動日期" value={f.eventStart} onChange={(v) => setF((x) => ({ ...x, eventStart: v, ...(v ? {} : { eventEnd: "" }) }))} />
          {f.eventStart ? <DateSelect label="結束日期（連續 2～3 天才設定，單日不用）" value={f.eventEnd} defaultValue={f.eventStart} onChange={set("eventEnd")} /> : null}
        </>
      )}
      <Field label="分類（可複選，多個用「、」分開）" value={f.category} onChange={set("category")} placeholder="例如：達標班、會議" />
      {categories.data?.length ? (
        <View style={{ gap: space.xs }}>
          <Label>已有的分類（點選加入或取消）</Label>
          <MultiChips options={categories.data} value={f.category} onChange={set("category")} />
        </View>
      ) : null}
      <Check label="短影音專輯（章節與影音教材在「單元」頁歸類為短影音）" value={f.isShorts} onChange={set("isShorts")} />
      {isSuper ? (
        <>
          <Field label="系列（同系列的課合併成一張卡、顯示在「相同系列」）" value={f.series} onChange={set("series")} placeholder="例如：翡翠達標班" />
          {series.data?.length ? <Chips label="已有的系列" options={[{ key: "", label: "無" }, ...series.data.map((x) => ({ key: x, label: x }))]} value={f.series} onChange={set("series")} /> : null}
        </>
      ) : null}
      <Label>封面顏色（沒有 EDM 時的文字封面）</Label>
      <View style={styles.chips}>
        {Object.keys(courseThemes).map((t) => (
          <Pressable key={t} onPress={() => set("theme")(t)} accessibilityRole="button" accessibilityLabel={`封面顏色 ${t}`} accessibilityState={{ selected: f.theme === t }} style={[styles.swatch, { borderColor: f.theme === t ? c.text : "transparent" }]}>
            <View style={[styles.swatchInner, { backgroundColor: courseThemes[t].light[1] }]} />
          </Pressable>
        ))}
      </View>
    </>
  );
}

function BasicsSheet({ course, onClose, onSaved }: SheetProps) {
  const { member } = useSession();
  const isSuper = isSuperAdmin(member);
  const init: BasicsForm = { isShorts: course.isShorts, title: course.title, teacher: course.teacher ?? "", teacherRank: course.teacherRank ?? "", teacherTitle: course.teacherTitle ?? "", eventStart: course.eventStart ?? "", eventEnd: course.eventEnd ?? "", category: course.category, series: course.series ?? "", theme: course.theme };
  const [f, setF] = useState(init);
  const { save, busy, error, setError } = useCourseSave(course, onSaved);
  const submit = async () => {
    if (!f.title.trim()) return setError(course.isList ? "請輸入素材清單名稱" : "請輸入課程名稱");
    const { series: _series, eventStart, eventEnd, ...rest } = f;
    // 日期與「時間與地點」面板是同一份資料；素材清單沒有日期，不送。
    const dates = course.isList ? {} : { eventStart: eventStart || null, eventEnd: eventStart ? eventEnd || null : null };
    const important = !course.isList && (eventStart !== init.eventStart || eventEnd !== init.eventEnd) ? ["日期"] : [];
    if (await save({ ...(isSuper ? { ...rest, series: f.series } : rest), ...dates }, { important })) onClose();
  };
  return (
    <EditSheet title="基本資料" onClose={onClose} onSave={submit} dirty={!same(init, f)} busy={busy} error={error}>
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
      {f.eventStart ? <DateSelect label="活動結束日期（連續 2～3 天才設定，單日不用）" value={f.eventEnd} defaultValue={f.eventStart} onChange={(v) => setF((x) => ({ ...x, eventEnd: v }))} /> : null}
      <AppText variant="caption" tone="muted">
        顯示在課程卡、首頁與「全部課程」的排序（最多連續 3 天）。
      </AppText>
      <Field label="地點" value={f.location} onChange={(v) => setF((x) => ({ ...x, location: v }))} placeholder="例如：台北總部教室" />
      <Check label="不顯示地點" value={f.locationNone} onChange={(v) => setF((x) => ({ ...x, locationNone: v }))} />
      <Check label="線上課程（地點顯示「線上課程」）" value={f.isOnline} onChange={(v) => setF((x) => ({ ...x, isOnline: v }))} />
      {!f.locationNone && !f.isOnline && locations.data?.length ? <Chips label="已有的場地" options={locations.data.map((x) => ({ key: x, label: x }))} value={f.location} onChange={(v) => setF((x) => ({ ...x, location: v }))} /> : null}
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
    freeFrom: toLocal(course.admin?.freeFrom),
    freeUntil: toLocal(course.admin?.freeUntil),
  };
  const [f, setF] = useState(init);
  const { save, busy, error, setError } = useCourseSave(course, onSaved);
  const price = Number(f.priceTwd);
  const submit = async () => {
    if (!Number.isInteger(price) || price < 0) return setError("費用請輸入 0 以上的整數");
    const freeFrom = parseLocal(f.freeFrom);
    const freeUntil = parseLocal(f.freeUntil);
    if (freeFrom === undefined || freeUntil === undefined) return setError("限時免費的日期格式請用 2026-12-01 19:30");
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
          <Field label="開始（空白＝立即）" value={f.freeFrom} onChange={(v) => setF((x) => ({ ...x, freeFrom: v }))} placeholder="2026-12-01 00:00" />
          <Field label="結束（空白＝不設定）" value={f.freeUntil} onChange={(v) => setF((x) => ({ ...x, freeUntil: v }))} placeholder="2026-12-31 23:59" hint="兩欄都空白表示不啟用；結束後恢復原價。" />
        </>
      ) : null}
      {f.priceTba ? <Pill label="費用尚未公布：課程頁顯示「費用尚未公布」，暫不開放報名" tone="warning" /> : price === 0 ? <Pill label="免費課程：報名後立即開通" tone="accent" /> : <Pill label="付費課程：報名後需審核繳費才開通" tone="warning" />}
      <ReviewDeskBlock course={course} />
    </EditSheet>
  );
}

// ---------- 報名資格條件：最低獎銜、會長、誰可以瀏覽（審核群組移到「費用與審核」的審核窗口） ----------
function EnrollSheet({ course, onClose, onSaved }: SheetProps) {
  const init = { minRankCode: course.minRank.code, allowPresident: course.allowPresident, viewScope: course.viewScope, hideFromGuests: course.hideFromGuests };
  const [f, setF] = useState(init);
  const ranks = useApi<Rank[]>("/ranks");
  const { save, busy, error } = useCourseSave(course, onSaved);
  const submit = async () => {
    if (await save({ ...f, hideFromGuests: f.viewScope === "all" ? f.hideFromGuests : false })) onClose();
  };
  return (
    <EditSheet title="報名資格條件" onClose={onClose} onSave={submit} dirty={!same(init, f)} busy={busy} error={error}>
      <Label>最低獎銜（誰可以報名）</Label>
      <Chips options={(ranks.data ?? []).map((r) => ({ key: r.code, label: r.name }))} value={f.minRankCode} onChange={(v) => setF((x) => ({ ...x, minRankCode: v }))} />
      {f.minRankCode !== "none" ? <Check label="會長不受獎銜限制也可報名" value={f.allowPresident} onChange={(v) => setF((x) => ({ ...x, allowPresident: v }))} /> : null}
      <Chips label="誰可以瀏覽" options={VIEW_SCOPES.map((k) => ({ key: k, label: VIEW_SCOPE_LABEL[k] }))} value={f.viewScope} onChange={(v) => setF((x) => ({ ...x, viewScope: v as ViewScope }))} />
      <AppText variant="caption" tone="muted">
        不在範圍內的人，這門課不會出現在清單與搜尋，也不能報名；已報名的學員照常看得到。
      </AppText>
      <Check label="對訪客隱藏" value={f.viewScope === "all" && f.hideFromGuests} onChange={(v) => setF((x) => ({ ...x, hideFromGuests: v }))} disabled={f.viewScope !== "all"} />
      <AppText variant="caption" tone="muted">
        {"只有「所有人含訪客」時可勾選：勾了之後，訪客的清單與搜尋看不到，但拿到網址的訪客仍可開啟。"}
      </AppText>
      <NoticeBox text="審核群組與審核人員改在「費用與審核」的「審核窗口」設定。" />
    </EditSheet>
  );
}

// ---------- 進階設定：指導／主辦單位、顯示選項、課程介紹、短網址、最後修改 ----------
/** 主辦單位：預設收起（只顯示目前的主辦），要改再按「展開」。主辦單位含某個中心＝中心課程（出現在該中心頁）。 */
function HostUnitBlock({ isHq, value, fixed, options, counts, onChange }: { isHq: boolean; value: string; fixed: string; options: string[]; counts: Record<string, number>; onChange: (v: string) => void }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  const summary = (value || HQ_UNIT).split(/[、,，]+/).map((x) => (x === HQ_UNIT ? x : centerTitle(x))).join("、");
  if (!isHq) return <NoticeBox text={`主辦單位固定為「${fixed}」，由系統帶入。`} />;
  return (
    <View style={{ gap: space.sm }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel="主辦單位" onPress={() => setOpen((o) => !o)} style={[styles.hostRow, { borderColor: c.border, backgroundColor: c.surface }]}>
        <View style={{ flex: 1 }}>
          <AppText variant="caption" tone="muted">
            主辦單位（會公開顯示）
          </AppText>
          <AppText variant="body" numberOfLines={2}>
            {summary}
          </AppText>
        </View>
        <AppText variant="callout" tone="accent">
          {open ? "收起" : "展開"}
        </AppText>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={c.textMuted} />
      </Pressable>
      {open ? (
        <>
          <MultiChips options={options} value={value} counts={counts} onChange={onChange} />
          <AppText variant="caption" tone="muted">
            含某個中心＝中心課程，只出現在該中心頁；只有寰宇總部＝一般課程。管理權限與「中心」篩選以第一個中心為準。
          </AppText>
        </>
      ) : null}
    </View>
  );
}

function AdvancedSheet({ course, onClose, onSaved }: SheetProps) {
  const { member } = useSession();
  const isHq = member?.role === "admin";
  const init = { guidanceUnit: course.guidanceUnit, hostUnit: course.hostUnit, chapterCovers: course.chapterCovers, hideFromHome: course.hideFromHome, description: course.description ?? "" };
  const [f, setF] = useState(init);
  const centers = useApi<string[]>(isHq ? "/centers" : null);
  const allCourses = useApi<CourseSummary[]>(isHq ? "/admin/courses" : null);
  const hostCounts = countByHost(allCourses.data ?? []);
  const { save, busy, error } = useCourseSave(course, onSaved);
  const submit = async () => {
    const body: Record<string, unknown> = { ...f };
    if (!isHq) delete body.hostUnit; // 中心的人不能改主辦中心
    if (await save(body)) onClose();
  };
  return (
    <EditSheet title="進階設定" onClose={onClose} onSave={submit} dirty={!same(init, f)} busy={busy} error={error}>
      {isHq ? <Check label="指導單位：寰宇總部（會公開顯示，不建議勾選）" value={f.guidanceUnit === HQ_UNIT} onChange={(v) => setF((x) => ({ ...x, guidanceUnit: v ? HQ_UNIT : "" }))} /> : null}
      {f.guidanceUnit === HQ_UNIT ? <NoticeBox text="由寰宇總部指導的課程，只能使用總部的審核群組。" /> : null}
      <HostUnitBlock isHq={isHq} value={f.hostUnit} fixed={course.hostUnit || member?.center || ""} options={[HQ_UNIT, ...(centers.data ?? [])]} counts={hostCounts} onChange={(v) => setF((x) => ({ ...x, hostUnit: v }))} />
      <Check label="章節各自設定封面" value={f.chapterCovers} onChange={(v) => setF((x) => ({ ...x, chapterCovers: v }))} />
      <Check label="不顯示在首頁推薦（不建議勾選）" value={f.hideFromHome} onChange={(v) => setF((x) => ({ ...x, hideFromHome: v }))} />
      <Field label="課程介紹（內部參考，課程頁不顯示）" value={f.description} onChange={(v) => setF((x) => ({ ...x, description: v }))} multiline placeholder="課程內容、上課時間、適合對象……" />
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
      router.push({ pathname: "/course/[id]", params: { id: copy.id, edit: "1" } });
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
      showToast("已刪除課程");
      router.replace("/courses");
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
      <ListRow icon="create-outline" title="基本資料" subtitle={[course.title, !course.isList && course.teacher && `主講 ${course.teacher}`, course.category, course.series && `系列 ${course.series}`].filter(Boolean).join("・")} onPress={() => onOpen("basics")} />
      {/* 素材清單沒有時間地點與費用（一律公開免費）。 */}
      {course.isList ? null : <ListRow icon="calendar-outline" title="時間與地點" subtitle={when} onPress={() => onOpen("when")} />}
      {course.isList ? null : <ListRow icon="pricetag-outline" title="費用與審核" subtitle={priceText} onPress={() => onOpen("price")} />}
      <ListRow icon="people-outline" title="報名資格條件" subtitle={`${course.minRank.name}以上${course.allowPresident ? "（會長也可）" : ""}・${VIEW_SCOPE_LABEL[course.viewScope]}可瀏覽${course.hideFromGuests ? "（對訪客隱藏）" : ""}`} onPress={() => onOpen("enroll")} />
      <ListRow icon="options-outline" title="進階設定" subtitle={`主辦：${course.hostUnit || "未設定"}${course.admin?.editedAt ? `・最後修改 ${course.admin.editedByName}` : ""}`} onPress={() => onOpen("advanced")} />
      <ListRow icon="eye-outline" title="上架與刪除" subtitle={statusText} onPress={() => onOpen("status")} />
    </Card>
  );
}

const styles = StyleSheet.create({
  hostRow: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  check: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: minTouch },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  catChip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: minTouch - 4, paddingHorizontal: space.md, borderWidth: 1.5, borderRadius: radius.pill },
  input: { minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
  swatch: { width: minTouch, height: minTouch, borderRadius: minTouch / 2, borderWidth: 2, padding: 4 },
  swatchInner: { flex: 1, borderRadius: minTouch / 2 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  action: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 64, padding: space.md, borderWidth: 1, borderRadius: radius.md },
});
