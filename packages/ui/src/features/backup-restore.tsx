import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { confirmSheet } from "@/features/confirm";
import { space } from "@/theme/tokens";
import { AppText } from "@/ui/text";
import { Button } from "@/ui/button";
import { Card } from "@/ui/card";
import { Field } from "@/ui/field";
import { NoticeBox } from "@/ui/notice-box";
import { LoadingView } from "@/ui/state-views";

/**
 * 後台「備份還原」面板（超級管理員；杜杜龍 2026-11-27；行動大學與繳作業系統共用，各自的頁面只提供 request）。
 * 流程：選一份備份 → 看預覽（每張表幾列）→ 輸入備份日期確認 → 確認面板 → 還原。還原前伺服器會先備份現況；
 * 還原只補寫與覆蓋備份裡有的資料，備份之後新增的資料不會被刪。還原正式資料須杜杜龍核准。規則見 docs/rules/member-central.md。
 */
type Backup = { date: string; created_at: string; rows: number };
type Plan = { date: string; created_at: string; tables: { table: string; rows: number; supported: boolean }[]; problems: string[] };
type Result = { pre_restore: string; restored: Record<string, number>; not_restored: Record<string, number> };
export type BackupRequest = <T>(method: "GET" | "POST", path: string, body?: unknown) => Promise<T>;

const taipei = (iso: string) => new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");

export function BackupRestorePanel({ request }: { request: BackupRequest }) {
  const [list, setList] = useState<Backup[] | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const load = useCallback(async () => {
    try {
      setList((await request<{ backups: Backup[] }>("GET", "/admin/backups")).backups);
    } catch (e) {
      setList([]);
      setMsg({ tone: "danger", text: (e as Error).message });
    }
  }, [request]);
  useEffect(() => void load(), [load]);

  const preview = async (date: string) => {
    setBusy(true);
    setMsg(null);
    setConfirm("");
    try {
      setPlan(await request<Plan>("GET", `/admin/backups/${date}`));
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const restore = async () => {
    if (!plan) return;
    const ok = await confirmSheet({ title: `還原 ${plan.date} 的備份？`, message: "會用這份備份蓋掉目前同一筆資料的內容（備份之後新增的資料不會被刪）。還原前系統會先自動備份現況。", confirmLabel: "還原", danger: true, typeOk: true });
    if (!ok) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await request<Result>("POST", `/admin/backups/${plan.date}/restore`, { confirm });
      const n = Object.values(r.restored).reduce((a, b) => a + b, 0);
      const miss = Object.values(r.not_restored).reduce((a, b) => a + b, 0);
      setMsg({ tone: "success", text: `已還原 ${n} 筆資料${miss ? `；有 ${miss} 筆補不回來（必填欄位不在備份內，需開發人員處理）` : ""}。還原前的現況備份在 ${r.pre_restore}。請所有人重新登入。` });
      setPlan(null);
      setConfirm("");
      void load();
    } catch (e) {
      setMsg({ tone: "danger", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!list) return <LoadingView />;
  return (
    <View style={{ gap: space.md }}>
      <NoticeBox tone="warning" text="還原會改動正式資料，只有超級管理員可以使用，而且須先經杜杜龍核准。還原前系統會自動備份現況；備份之後新增的資料不會被刪。" />
      {msg ? <NoticeBox tone={msg.tone} text={msg.text} /> : null}
      {list.length === 0 ? <NoticeBox tone="info" text="目前沒有可用的備份。到設定的星期、台北時間凌晨 3 點才會產生。" /> : null}
      {list.map((b) => (
        <Card key={b.date}>
          <AppText variant="headline">{b.date}</AppText>
          <AppText variant="caption" tone="muted">{`建立於 ${taipei(b.created_at)}・共 ${b.rows} 筆`}</AppText>
          {plan?.date === b.date ? (
            <View style={{ gap: space.sm }}>
              {plan.tables.map((t) => (
                <AppText key={t.table} variant="callout">{`${t.table}：${t.rows} 筆${t.supported ? "" : "（不還原）"}`}</AppText>
              ))}
              {plan.problems.length ? <NoticeBox tone="warning" text={plan.problems.join("；")} /> : null}
              <Field label={`輸入備份日期 ${plan.date} 確認`} value={confirm} onChange={setConfirm} />
              <View style={styles.row}>
                <Button variant="cancel" label="取消" disabled={busy} onPress={() => setPlan(null)} />
                <Button variant="danger" label="還原這份備份" disabled={busy || confirm !== plan.date} onPress={() => void restore()} />
              </View>
            </View>
          ) : (
            <Button variant="secondary" label="預覽並還原" disabled={busy} onPress={() => void preview(b.date)} />
          )}
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: "row", flexWrap: "wrap", gap: 8 } });
