import { useEffect, useState } from "react";
import { StyleSheet, Switch, TextInput, View } from "react-native";
import { api, DEFAULT_SHARE_SETTINGS, reviewerInviteMessage, shareMessage, type UiConfig } from "@/api/client";
import { confirmSheet } from "@/features/confirm";
import { useUnsavedPrompt } from "@/lib/settings-page";
import { useSession } from "@/state/session";
import { useUiConfig } from "@/state/ui-config";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { AppText, Button, Card, EmptyState, NoticeBox, Screen, Section, SettingsFooter } from "@/ui";

type Share = UiConfig["share"];

/**
 * 設定 > 分享預設值（只有超級管理員）：把所有「分享」相關的文字集中在這一頁——
 * ① 一般分享 ② 課程（單堂課程、章節）③ 清單（整個清單、清單裡的影片、外部連結）的分享文字；④ LINE 等分享預覽卡片的標題與備註格式（中心、單堂課程、系列、分類都用同一組）。
 * 下方有即時預覽。存檔後：分享選單文字重新開啟 APP 套用；預覽卡片立刻套用（LINE 會快取舊的預覽，已分享過的網址要換新網址或等它過期）。
 * 新增任何分享相關的文字，一律放在這一頁（contract.ts ShareSettings）。
 */
export default function ShareDefaultsScreen() {
  const { c } = useTheme();
  const { member } = useSession();
  const { config, reload } = useUiConfig();
  const [s, setS] = useState<Share>(config.share);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  useEffect(() => setS(config.share), [config.share]);

  const set = <K extends keyof Share>(k: K, v: Share[K]) => setS((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(s) !== JSON.stringify(config.share);
  const save = async (next: Share): Promise<boolean> => {
    setBusy(true);
    setMsg(null);
    try {
      await api("PUT", "/admin/ui-config", { share: next });
      reload();
      setMsg({ tone: "success", text: "已儲存。預覽卡片立刻套用；分享選單的文字重新開啟 APP 後套用。" });
      return true;
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  };
  useUnsavedPrompt({ dirty, save: () => save(s), discard: () => setS(config.share) });
  if (!member?.titles.includes("超級管理員")) return <Screen header={false}><EmptyState icon="lock-closed-outline" title="只有超級管理員可以設定" /></Screen>;
  const restore = async () => {
    if (!(await confirmSheet({ title: "還原預設值", message: "分享的文字與預覽格式會全部改回出廠預設，確定嗎？", confirmLabel: "還原", cancelLabel: "先不要", danger: true }))) return;
    setS(DEFAULT_SHARE_SETTINGS); // 只改畫面上的草稿，要按下方「儲存」才生效
  };

  const input = (label: string, hint: string, value: string, onChange: (v: string) => void, opts?: { multiline?: boolean; placeholder?: string }) => (
    <View style={{ gap: space.xs }}>
      <AppText variant="body" style={{ fontWeight: "600" }}>
        {label}
      </AppText>
      <AppText variant="caption" tone="muted">
        {hint}
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChange}
        multiline={opts?.multiline}
        placeholder={opts?.placeholder}
        placeholderTextColor={c.textMuted}
        autoCapitalize="none"
        accessibilityLabel={label}
        style={[styles.input, type.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface }, opts?.multiline && { minHeight: 88, textAlignVertical: "top", paddingTop: space.sm }]}
      />
    </View>
  );
  const toggle = (label: string, hint: string, value: boolean, onChange: (v: boolean) => void) => (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <AppText variant="body">{label}</AppText>
        <AppText variant="caption" tone="muted">
          {hint}
        </AppText>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: c.border, true: c.accent }} accessibilityLabel={label} />
    </View>
  );

  // 即時預覽（範例資料）
  const card = (name: string, address: string) => ({
    title: `${name}${s.titleSeparator}${s.siteName}${s.titleBadge && !s.siteName.includes(s.titleBadge) ? ` ${s.titleBadge}` : ""}`, // 名稱 | 站名 圖示
    desc: (s.showQuote ? "每天進步一點點，一年後強大 37 倍。" : "") || s.fallbackDescription || s.siteName, // 第二行只放一句隨機學習金句（不再放地址）
  });
  const center = { title: card("彰化中心", "").title, desc: s.showAddress ? `${s.addressIcon ? `${s.addressIcon} ` : ""}彰化市中山路 1 號` : card("彰化中心", "").desc }; // 中心卡第二行＝地址
  const hq = card(s.hqName, "");
  const sampleUrl = "https://learn.hglobal1985.com/136/wang-xiaoming-001";

  return (
    <Screen header={false} footer={<SettingsFooter dirty={dirty} saving={busy} onSave={() => void save(s)} onDiscard={() => setS(config.share)} />}>
      <AppText variant="callout" tone="muted">
        所有「分享」的文字與 LINE 預覽卡片格式集中在這裡。改完按最下面的「儲存」。
      </AppText>
      {msg ? <NoticeBox tone={msg.tone} text={msg.text} /> : null}

      <Section fold title="① 一般分享">
        <Card>
          {input("一般分享的文字", "分享中心、分類、系列等頁面時，放在網址前面的文字", s.inviteText, (v) => set("inviteText", v), { multiline: true })}
          {input("網址前的引導文字", "自成一行，放在文字與網址中間（所有分享都用）", s.linkLead, (v) => set("linkLead", v))}
        </Card>
      </Section>

      <Section fold title="② 課程的分享">
        <Card>
          {input("單堂課程分享的文字", "課程頁右上角與課程列的分享：可用 {主講人}、{職稱}、{課程名稱}，送出時會換成實際的內容（沒填職稱的課程，{職稱} 會自動省略；有職稱時姓名與職稱中間自動空一格）", s.courseText, (v) => set("courseText", v), { multiline: true })}
          {input("邀請審核人員的文字", "課程「費用與審核 > 審核窗口」的「產生邀請網址並分享」：可用 {課程名稱}；後面接引導文字與 24 小時有效的邀請網址", s.reviewerInviteText, (v) => set("reviewerInviteText", v), { multiline: true })}
          {input("章節分享的文字", "課程有兩堂以上章節時，每一堂右側的分享鈕：可用 {主講人}、{職稱}、{章節名稱}、{課程名稱}。主講人、職稱、章節名稱一律取「這一堂章節」自己的設定（分享者、分享者職稱、章節名稱），不是課程的", s.chapterText, (v) => set("chapterText", v), { multiline: true })}
        </Card>
      </Section>

      <Section fold title="③ 清單（影片／檔案）的分享">
        <Card>
          {input("純教材卡分享的文字", "「新增清單（影片／檔案）」建立的清單：清單頁右上角與清單列的分享，可用 {清單名稱}", s.listText, (v) => set("listText", v), { multiline: true })}
          {input("清單裡單一影片分享的文字", "清單每段影片右側的分享鈕（點開直接播放這一段）：可用 {影片名稱}、{清單名稱}", s.listItemText, (v) => set("listItemText", v), { multiline: true })}
          {input("外部連結教材分享的文字", "課程與清單裡「外部連結」（簡報、PDF、雲端檔案…）右側的分享鈕：可用 {教材名稱}、{課程名稱}、{主講人}、{職稱}；分享出去的網址是外部連結本身", s.materialText, (v) => set("materialText", v), { multiline: true })}
        </Card>
      </Section>

      <Section fold title="④ LINE 預覽卡片（標題與備註）">
        <Card>
          {input("站名", "標題最後面固定的名稱，例如「寰宇行動大學」", s.siteName, (v) => set("siteName", v))}
          {input("站名後面的小圖示", "預設 🎓；清空＝不加圖示。圖示的樣子由每個人的手機系統決定", s.titleBadge, (v) => set("titleBadge", v))}
          {input("標題的分隔符號", "名稱與站名中間，例如「 | 」（前後空白也會保留）", s.titleSeparator, (v) => set("titleSeparator", v))}
                              {toggle("課程、系列、分類：第二行顯示學習金句", "第二行放一句隨機學習金句，每次 LINE 重新抓取都會重抽（金句在設定頁的學習金句編輯）", s.showQuote, (v) => set("showQuote", v))}
          {toggle("中心卡：第二行顯示地址", "中心卡（中心短網址與中心頁）的第二行固定是地址，不是金句；中心沒填地址才退回金句。地址在中心頁編輯", s.showAddress, (v) => set("showAddress", v))}
          {input("中心卡地址前的圖示", "放在地址最前面（可以清空＝不加圖示）。圖示的樣子由每個人的手機系統決定", s.addressIcon, (v) => set("addressIcon", v))}
          {input("總部主辦課程的名稱", "中心頁的名稱：總部（沒有主辦中心）時用這個名稱", s.hqName, (v) => set("hqName", v))}
          {input("備註的備用文字", "沒有金句（或關閉金句）時顯示；空白＝顯示站名", s.fallbackDescription, (v) => set("fallbackDescription", v))}
          <AppText variant="caption" tone="muted">
            一律格式：第一行＝「課程、系列或中心名稱＋分隔符號＋站名＋圖示」；第二行：課程、系列、分類＝一句隨機學習金句，中心卡＝地址。
          </AppText>

          <AppText variant="callout" style={{ fontWeight: "800", marginTop: 8 }}>下面這些不能在這一頁改，要這樣設定：</AppText>
          <AppText variant="caption" tone="muted">
            {"① 第一行的「名稱」：來自課程、系列、中心本身的名稱。課程／系列改名到該課程或系列的「基本資料」；中心名稱預設取自會員中心系統（去掉數字代碼），要自訂顯示名稱到「教育中心自訂名稱」。\n② 第二行：金句內容到「設定 › 編輯學習金句」新增、修改、刪除；中心卡的地址到該中心頁的「地址」編輯。\n③ 預覽卡的縮圖：課程用課程封面或 EDM、系列用系列 EDM、中心用中心封面，沒圖才用網站圖示。換圖到各自的封面或 EDM 設定。\n④ LINE 什麼時候重新抓取：由 LINE 決定，我們無法強制，所以同一個連結在 LINE 的快取期間看到的預覽（含金句）不會變。想讓某個連結立刻重抓：在連結最後面加「?」和任意字再分享，例如 learn.hglobal1985.com/amway/dd?v=2，LINE 會把它當新網址重新抓取。\n⑤ 說明文字太長時各平台（LINE、Facebook）會自己截斷，這個不能設定。"}
          </AppText>
        </Card>
      </Section>

      <Section fold title="預覽（範例）">
        <Card>
          <AppText variant="callout" tone="muted">
            LINE 預覽卡片：中心／該中心主辦的單堂課程
          </AppText>
          <View style={[styles.line, { borderColor: c.border, backgroundColor: c.surfaceMuted }]}>
            <AppText variant="headline">{center.title}</AppText>
            <AppText variant="callout" tone="muted">
              {center.desc}
            </AppText>
          </View>
          <AppText variant="callout" tone="muted">
            LINE 預覽卡片：總部主辦的單堂課程
          </AppText>
          <View style={[styles.line, { borderColor: c.border, backgroundColor: c.surfaceMuted }]}>
            <AppText variant="headline">{hq.title}</AppText>
            <AppText variant="callout" tone="muted">
              {hq.desc}
            </AppText>
          </View>
          <AppText variant="callout" tone="muted">
            單堂課程的分享文字（主講人「王小明」、職稱「區域經理」、課程「翡翠達標班」）
          </AppText>
          <View style={[styles.line, { borderColor: c.border, backgroundColor: c.surfaceMuted }]}>
            <AppText variant="body">{shareMessage(s, sampleUrl, { teacher: "王小明", teacherTitle: "區域經理", title: "翡翠達標班" })}</AppText>
          </View>
          <AppText variant="callout" tone="muted">
            章節的分享文字（章節「第 2 堂 溝通技巧」、分享者「李華」、分享者職稱「白金經理」）
          </AppText>
          <View style={[styles.line, { borderColor: c.border, backgroundColor: c.surfaceMuted }]}>
            <AppText variant="body">{shareMessage(s, "https://learn.hglobal1985.com/136/wang-xiaoming-001?lesson=c1", { teacher: "王小明", title: "翡翠達標班" }, undefined, { sharer: "李華", sharerTitle: "白金經理", title: "第 2 堂 溝通技巧" })}</AppText>
          </View>
          <AppText variant="callout" tone="muted">
            純教材卡的分享文字（例如「美力之星精彩回顧」）
          </AppText>
          <View style={[styles.line, { borderColor: c.border, backgroundColor: c.surfaceMuted }]}>
            <AppText variant="body">{shareMessage(s, "https://learn.hglobal1985.com/course/ctp7xt2y", undefined, undefined, undefined, { title: "美力之星精彩回顧" })}</AppText>
          </View>
          <AppText variant="callout" tone="muted">
            清單裡單一影片的分享文字（影片「百人走秀 改造前後」）
          </AppText>
          <View style={[styles.line, { borderColor: c.border, backgroundColor: c.surfaceMuted }]}>
            <AppText variant="body">{shareMessage(s, "https://learn.hglobal1985.com/course/ctp7xt2y?4", undefined, undefined, undefined, { title: "美力之星精彩回顧", item: "百人走秀 改造前後" })}</AppText>
          </View>
          <AppText variant="callout" tone="muted">
            外部連結教材的分享文字（教材「簡報講義」、課程「翡翠達標班」）
          </AppText>
          <View style={[styles.line, { borderColor: c.border, backgroundColor: c.surfaceMuted }]}>
            <AppText variant="body">{shareMessage(s, "https://www.canva.com/design/abc/view", { teacher: "王小明", teacherTitle: "區域經理", title: "翡翠達標班" }, { title: "簡報講義" })}</AppText>
          </View>
          <AppText variant="callout" tone="muted">
            邀請審核人員的文字（課程「翡翠達標班」）
          </AppText>
          <View style={[styles.line, { borderColor: c.border, backgroundColor: c.surfaceMuted }]}>
            <AppText variant="body">{reviewerInviteMessage(s, "https://learn.hglobal1985.com/review-invite/3f9a…", "翡翠達標班")}</AppText>
          </View>
          <AppText variant="callout" tone="muted">
            一般分享的文字
          </AppText>
          <View style={[styles.line, { borderColor: c.border, backgroundColor: c.surfaceMuted }]}>
            <AppText variant="body">{shareMessage(s, "https://learn.hglobal1985.com/136")}</AppText>
          </View>
        </Card>
      </Section>

      <Button variant="secondary" label="還原預設值（要按下方「儲存」才生效）" icon="refresh-outline" disabled={busy} onPress={restore} fullWidth />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: minTouch },
  input: { minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
  line: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: 4 },
});
