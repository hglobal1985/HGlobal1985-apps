import { useEffect, useState } from "react";
import { StyleSheet, Switch, TextInput, View } from "react-native";
import { api, DEFAULT_SHARE_SETTINGS, shareMessage, type UiConfig } from "@/api/client";
import { confirmSheet } from "@/features/confirm";
import { useSession } from "@/state/session";
import { useUiConfig } from "@/state/ui-config";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { AppText, Button, Card, EmptyState, NoticeBox, Screen, Section } from "@/ui";

type Share = UiConfig["share"];

/**
 * 設定 > 分享預設值（只有超級管理員）：把所有「分享」相關的文字集中在這一頁——
 * ① 分享選單送出的文字（一般分享、單堂課程分享的範本）② LINE 等分享預覽卡片的標題與備註格式（中心、單堂課程、系列、分類都用同一組）。
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
  if (!member?.titles.includes("超級管理員")) return <Screen header={false}><EmptyState icon="lock-closed-outline" title="只有超級管理員可以設定" /></Screen>;

  const set = <K extends keyof Share>(k: K, v: Share[K]) => setS((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(s) !== JSON.stringify(config.share);
  const save = async (next: Share) => {
    setBusy(true);
    setMsg(null);
    try {
      await api("PUT", "/admin/ui-config", { share: next });
      reload();
      setMsg({ tone: "success", text: "已儲存。預覽卡片立刻套用；分享選單的文字重新開啟 APP 後套用。" });
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    if (!(await confirmSheet({ title: "還原預設值", message: "分享的文字與預覽格式會全部改回出廠預設，確定嗎？", confirmLabel: "還原", cancelLabel: "先不要", danger: true }))) return;
    setS(DEFAULT_SHARE_SETTINGS);
    await save(DEFAULT_SHARE_SETTINGS);
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
    title: `${name}${s.titleSeparator}${s.siteName}`,
    desc: [s.showAddress && address ? `${s.addressIcon ? `${s.addressIcon} ` : ""}${address}` : "", s.showQuote ? "每天進步一點點，一年後強大 37 倍。" : ""].filter(Boolean).join("\n") || s.fallbackDescription || s.siteName,
  });
  const center = card("彰化中心", "彰化市中山路 1 號");
  const hq = card(s.hqName, "");
  const sampleUrl = "https://learn.hglobal1985.com/136/wang-xiaoming-001";

  return (
    <Screen header={false}>
      <AppText variant="callout" tone="muted">
        所有「分享」的文字與 LINE 預覽卡片格式集中在這裡。改完按最下面的「儲存」。
      </AppText>
      {msg ? <NoticeBox tone={msg.tone} text={msg.text} /> : null}

      <Section title="① 分享選單送出的文字">
        <Card>
          {input("一般分享的文字", "分享中心、分類、系列等頁面時，放在網址前面的文字", s.inviteText, (v) => set("inviteText", v), { multiline: true })}
          {input("單堂課程分享的文字", "可用 {主講人}、{職稱}、{課程名稱}，送出時會換成實際的內容（沒填職稱的課程，{職稱} 會自動省略；有職稱時姓名與職稱中間自動空一格）", s.courseText, (v) => set("courseText", v), { multiline: true })}
          {input("網址前的引導文字", "自成一行，放在文字與網址中間", s.linkLead, (v) => set("linkLead", v))}
        </Card>
      </Section>

      <Section title="② LINE 預覽卡片（標題與備註）">
        <Card>
          {input("站名", "標題最後面固定的名稱", s.siteName, (v) => set("siteName", v))}
          {input("標題的分隔符號", "名稱與站名中間，例如「 | 」（前後空白也會保留）", s.titleSeparator, (v) => set("titleSeparator", v))}
          {toggle("備註顯示地址", "中心有填地址才會顯示；沒有地址就整行省略", s.showAddress, (v) => set("showAddress", v))}
          {input("地址前的圖示", "放在地址最前面（可以清空＝不加圖示）。圖示的樣子由每個人的手機系統決定", s.addressIcon, (v) => set("addressIcon", v))}
          {toggle("備註顯示學習金句", "換行後隨機抽一句（金句在設定頁的學習金句編輯）", s.showQuote, (v) => set("showQuote", v))}
          {input("總部主辦課程的名稱", "單堂課程的預覽卡片跟主辦中心一致；總部主辦（沒有中心）的課程用這個名稱，沒有地址", s.hqName, (v) => set("hqName", v))}
          {input("備註的備用文字", "地址與金句都沒有（或都關閉）時顯示；空白＝顯示站名", s.fallbackDescription, (v) => set("fallbackDescription", v))}
          <AppText variant="caption" tone="muted">
            規則：中心、中心的課程網址、單堂課程都用「主辦中心」的標題與備註；系列、分類只有標題與金句。
          </AppText>
        </Card>
      </Section>

      <Section title="預覽（範例）">
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
            一般分享的文字
          </AppText>
          <View style={[styles.line, { borderColor: c.border, backgroundColor: c.surfaceMuted }]}>
            <AppText variant="body">{shareMessage(s, "https://learn.hglobal1985.com/136")}</AppText>
          </View>
        </Card>
      </Section>

      <View style={{ gap: space.sm }}>
        <Button label="儲存" icon="save-outline" loading={busy} disabled={!dirty || busy} onPress={() => save(s)} fullWidth />
        <Button variant="secondary" label="還原預設值" icon="refresh-outline" disabled={busy} onPress={restore} fullWidth />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: minTouch },
  input: { minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md },
  line: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: 4 },
});
