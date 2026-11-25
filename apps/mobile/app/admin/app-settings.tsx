import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import { api, DEFAULT_APP_SETTINGS, type UiConfig } from "@/api/client";
import { confirmSheet } from "@/features/confirm";
import { useSession } from "@/state/session";
import { useUiConfig } from "@/state/ui-config";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space } from "@/theme/tokens";
import { AppText, Button, Card, Chips, EmptyState, Icon, NoticeBox, Screen, Section } from "@/ui";

type App = UiConfig["app"];

/**
 * 設定 > APP 數值設定（只有超級管理員）：把整個 APP 會用到的數值與規則集中在這一頁調整——
 * ① 首頁「推薦課程」的規則 ② 首頁兩個區塊與公告跑馬燈的自動輪播秒數 ③ 其他全站數值（「新」標籤天數、改播倒數、圖片背景模糊強度）④ 學習紀錄（開始學習、自動完成的播放比例、進度回報間隔）。
 * 存檔後所有人重新開啟 APP 就會套用；新增任何新的全站數值，也一律放在這一頁（contract.ts AppSettings）。
 */
export default function AppSettingsScreen() {
  const { c } = useTheme();
  const { member } = useSession();
  const { config, reload } = useUiConfig();
  const [app, setApp] = useState<App>(config.app);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  useEffect(() => setApp(config.app), [config.app]);
  if (!member?.titles.includes("超級管理員")) return <Screen header={false}><EmptyState icon="lock-closed-outline" title="只有超級管理員可以設定" /></Screen>;

  const set = <K extends keyof App>(k: K, v: App[K]) => setApp((x) => ({ ...x, [k]: v }));
  const rec = <K extends keyof App["rec"]>(k: K, v: App["rec"][K]) => setApp((x) => ({ ...x, rec: { ...x.rec, [k]: v } }));
  const dirty = JSON.stringify(app) !== JSON.stringify(config.app);
  const save = async (next: App) => {
    setBusy(true);
    setMsg(null);
    try {
      await api("PUT", "/admin/ui-config", { app: next });
      reload();
      setMsg({ tone: "success", text: "已儲存。所有人重新開啟 APP 後套用。" });
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    if (!(await confirmSheet({ title: "還原預設值", message: "全部數值與規則會改回出廠預設，確定嗎？", confirmLabel: "還原", cancelLabel: "先不要", danger: true }))) return;
    setApp(DEFAULT_APP_SETTINGS);
    await save(DEFAULT_APP_SETTINGS);
  };

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
  const stepper = (label: string, hint: string, value: number, min: number, max: number, onChange: (v: number) => void, unit = "秒", zero?: string) => (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <AppText variant="body">{label}</AppText>
        <AppText variant="caption" tone="muted">
          {hint}
        </AppText>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}減少`} disabled={value <= min} onPress={() => onChange(Math.max(min, value - 1))} style={[styles.step, { borderColor: c.border, opacity: value <= min ? 0.35 : 1 }]}>
        <Icon name="remove" size={22} color={c.text} />
      </Pressable>
      <View style={styles.val}>
        <AppText variant="headline">{value === 0 && zero ? zero : `${value}${unit}`}</AppText>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}增加`} disabled={value >= max} onPress={() => onChange(Math.min(max, value + 1))} style={[styles.step, { borderColor: c.border, opacity: value >= max ? 0.35 : 1 }]}>
        <Icon name="add" size={22} color={c.text} />
      </Pressable>
    </View>
  );

  return (
    <Screen header={false}>
      <AppText variant="callout" tone="muted">
        整個 APP 的數值與規則集中在這裡調整。改完按最下面的「儲存」，所有人重新開啟 APP 後套用。
      </AppText>
      {msg ? <NoticeBox tone={msg.tone} text={msg.text} /> : null}

      <Section title="① 首頁「推薦課程」規則">
        <Card>
          <Chips
            label="推薦範圍"
            options={[
              { key: "myCenter", label: "只推薦我的中心" },
              { key: "all", label: "不分中心" },
            ]}
            value={app.rec.scope}
            onChange={(v) => rec("scope", v)}
          />
          {app.rec.scope === "myCenter" ? toggle("也納入總部主辦的課程", "只有寰宇總部主辦（沒有中心）的課程，所有人都算同中心", app.rec.includeHq, (v) => rec("includeHq", v)) : null}
          {toggle("只推薦符合我獎銜資格的課程", "關閉後，連獎銜不符、無法報名的課程也會推薦", app.rec.onlyEligible, (v) => rec("onlyEligible", v))}
          {toggle("不推薦已結束的課程", "活動日已過的課程不出現在推薦", app.rec.hideEnded, (v) => rec("hideEnded", v))}
          {toggle("同系列只推薦最近一場", "同一個系列有好幾場時，只放日期最近的那一場", app.rec.collapseSeries, (v) => rec("collapseSeries", v))}
          <Chips
            label="推薦順序"
            options={[
              { key: "list", label: "照全部課程的排序" },
              { key: "soonest", label: "日期最近優先" },
              { key: "newest", label: "最新建立優先" },
            ]}
            value={app.rec.order}
            onChange={(v) => rec("order", v)}
          />
          {stepper("最多推薦幾門", "超過的不顯示；0＝不限制", app.rec.max, 0, 50, (v) => rec("max", v), " 門", "不限")}
          <AppText variant="caption" tone="muted">
            固定規則（不能關）：已報名或已開始學習的課程不推薦、只推薦已上架的課程、課程設定勾「不顯示在首頁推薦」的不推薦。
          </AppText>
        </Card>
      </Section>

      <Section title="② 首頁自動輪播">
        <Card>
          {stepper("左邊「繼續學習」換下一張", "每隔幾秒自動換一張；0＝不自動輪播", app.homeLeftSec, 0, 60, (v) => set("homeLeftSec", v), " 秒", "關閉")}
          {stepper("右邊「推薦課程」換下一張", "每隔幾秒自動換一張；0＝不自動輪播", app.homeRightSec, 0, 60, (v) => set("homeRightSec", v), " 秒", "關閉")}
          {stepper("手指滑過後暫停", "使用者自己滑動或點圓點後，暫停自動輪播幾秒", app.homePauseSec, 0, 120, (v) => set("homePauseSec", v))}
          {stepper("公告跑馬燈換下一則", "首頁上方公告每隔幾秒換一則", app.tickerSec, 2, 60, (v) => set("tickerSec", v))}
          {stepper("公告手指滑過後暫停", "使用者滑動公告後，暫停自動換幾秒", app.tickerPauseSec, 0, 120, (v) => set("tickerPauseSec", v))}
        </Card>
      </Section>

      <Section title="③ 其他全站數值">
        <Card>
          {stepper("課程「新」標籤", "課程建立幾天內，分類下拉顯示「新」", app.freshDays, 1, 90, (v) => set("freshDays", v), " 天")}
          {stepper("圖片「完整顯示」背景模糊", "合成封面時背景的模糊強度，數字越大越模糊（建議 12～24）", app.blurStrength, 4, 40, (v) => set("blurStrength", v), "")}
        </Card>
      </Section>

      <Section title="④ 學習紀錄">
        <Card>
          {stepper("開始學習的播放比例", "播放超過這個比例，這門課就列入學員的「學習中」（已開通的課程本來就會列入）", app.learnStartPct, 1, 50, (v) => set("learnStartPct", v), "%")}
          {stepper("自動完成的播放比例", "播放超過這個比例（或播到結尾），自動標記這一堂完成；一定要大於上面的比例", app.learnDonePct, 50, 100, (v) => set("learnDonePct", v), "%")}
          {stepper("進度回報的最短間隔", "播放進度每前進 1%、且距離上次回報超過幾秒，才回報一次（影響「學習中」進度條更新的頻率）", app.watchReportSec, 5, 120, (v) => set("watchReportSec", v))}
          <AppText variant="caption" tone="muted">
            只影響之後的播放，已經記錄的進度不會重算。
          </AppText>
        </Card>
      </Section>

      <View style={{ gap: space.sm }}>
        <Button label="儲存" icon="save-outline" loading={busy} disabled={!dirty || busy} onPress={() => save(app)} fullWidth />
        <Button variant="secondary" label="還原預設值" icon="refresh-outline" disabled={busy} onPress={restore} fullWidth />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: minTouch },
  step: { width: minTouch, height: minTouch, borderRadius: radius.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  val: { minWidth: 64, alignItems: "center" },
});
