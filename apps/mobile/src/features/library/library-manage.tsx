import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { api, classifyLink, parseHttpsUrl, type LibraryItem, type LibraryMine } from "@/api/client";
import { confirmAsk } from "@/features/confirm";
import { detectYoutubeSeconds } from "@/features/admin/youtube-duration";
import { EditSheet } from "@/features/course-edit/edit-sheet";
import { IconButton } from "@/features/course-edit/lessons";
import { TYPE_INFO } from "@/features/link-types";
import { dateTime, eventDays } from "@/features/format";
import { fromHms, toHms, type Hms } from "@/features/uploads/hms";
import { TimeRangePicker } from "@/features/uploads/time-range-picker";
import { useLibraryChrome } from "@/lib/library-mode";
import { useApi } from "@/state/session";
import { useTheme } from "@/theme/theme";
import { minTouch, radius, space, type } from "@/theme/tokens";
import { AppText, Button, Card, DateSelect, Field, Icon, LoadingView, NoticeBox, Screen, Section } from "@/ui";
import { BrandIcon } from "@/ui/brand-icon";
import { flashText } from "@/ui/flash-notice";

/**
 * 「我的書櫃」管理頁（設定 › 我的書櫃；業主 2026-11-17）：改名稱、設定整座書櫃的密碼（可設幾天後失效）、
 * 新增書架（分類標題）與書（影片、簡報、PDF、連結），每本書可以單獨設密碼，調整順序、刪除。
 * 公開檢視在 /會員編號（features/library/library-view.tsx）。
 */
export function LibraryManage() {
  useLibraryChrome();
  const { c } = useTheme();
  const { data, loading, reload } = useApi<LibraryMine>("/library/mine");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [days, setDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<{ kind: "shelf" | "book"; item?: LibraryItem } | null>(null);
  useEffect(() => {
    if (data?.library) setName(data.library.title);
  }, [data?.library?.title]); // eslint-disable-line react-hooks/exhaustive-deps
  if (loading && !data) return <Screen header={false}><LoadingView /></Screen>;
  // 沒有書櫃鑰匙（尚未被超級管理員指定）：一樣看得到主畫面，但任何操作都只會提示「尚未解鎖書櫃鑰匙」。
  const items = data?.items ?? [];
  const locked = !data?.library;
  const lib = data?.library ?? { number: "你的會員編號", title: "我的書櫃", ownerName: "", views: 0, pwSet: false, pwExpiresAt: null, pwExpired: false };
  const lockedTip = () => flashText("尚未解鎖書櫃鑰匙，獲得任意 100 枚徽章就能解鎖");
  const url = `learn.hglobal1985.com/${lib.number}`;
  const call = async (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown) => {
    if (locked) return lockedTip();
    setBusy(true);
    try {
      await api(method, path, body);
      reload();
    } catch (e) {
      flashText((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const move = (i: number, j: number) => {
    const ids = items.map((x) => x.id);
    const [x] = ids.splice(i, 1);
    ids.splice(j, 0, x!);
    void call("POST", "/library/mine/items/order", { ids });
  };
  const remove = async (it: LibraryItem) => {
    if (locked) return lockedTip();
    if (await confirmAsk(it.kind === "shelf" ? "刪除書架" : "刪除這本書", `確定刪除「${it.title}」？`, "刪除")) void call("DELETE", `/library/mine/items/${it.id}`);
  };
  const input = [{ minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md }, type.body, { color: c.text, borderColor: c.border, backgroundColor: c.surface }];
  return (
    <Screen header={false}>
      <Card>
        {locked ? <NoticeBox text="你尚未解鎖書櫃鑰匙。獲得任意 100 枚徽章就會自動解鎖；下面是書櫃的主畫面預覽。" /> : null}
        <AppText variant="caption" tone="muted">
          專屬網址（只有拿到網址的人才進得來，不會出現在行動大學任何地方）
        </AppText>
        <AppText variant="headline" selectable>
          {url}
        </AppText>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button variant="secondary" label="複製網址" icon="copy-outline" onPress={() => locked ? lockedTip() : void Clipboard.setStringAsync(`https://${url}`).then(() => flashText("已複製網址"))} />
          <Button label="查看書櫃" icon="library-outline" onPress={() => (locked ? lockedTip() : router.push(`/${lib.number}` as never))} />
        </View>
        <AppText variant="caption" tone="muted">
          {lib.views} 次翻閱
        </AppText>
      </Card>

      <Section title="書櫃名稱">
        <TextInput value={name} onChangeText={setName} placeholder="例如：王小明的書櫃" placeholderTextColor={c.textMuted} accessibilityLabel="書櫃名稱" maxLength={80} style={input} />
        <Button label="儲存名稱" onPress={() => void call("PUT", "/library/mine", { title: name })} disabled={!locked && (busy || !name.trim() || name.trim() === lib.title)} />
      </Section>

      <Section title="進入密碼（整座書櫃）">
        <AppText variant="callout" tone={lib.pwSet ? undefined : "muted"}>
          {lib.pwSet ? (lib.pwExpired ? "目前的密碼已經失效（沒有人能用它進入，請設定新密碼，或關閉密碼）" : `已設定密碼${lib.pwExpiresAt ? `，${dateTime(lib.pwExpiresAt)} 失效` : "，不會自動失效"}`) : "沒有設定密碼：拿到網址的人都能進來。"}
        </AppText>
        <TextInput value={pw} onChangeText={setPw} placeholder="新密碼（4～40 個字）" placeholderTextColor={c.textMuted} autoCapitalize="none" accessibilityLabel="新密碼" style={input} />
        <Field label="幾天後失效（留空＝不自動失效）" value={days} onChange={(v) => setDays(v.replace(/\D/g, ""))} numeric placeholder="例如：7" />
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button label={lib.pwSet ? "更換密碼" : "設定密碼"} onPress={() => void call("PUT", "/library/mine", { password: pw, passwordDays: days ? Number(days) : null }).then(() => { setPw(""); setDays(""); })} disabled={!locked && (busy || pw.length < 4)} />
          {lib.pwSet ? <Button variant="secondary" label="關閉密碼" onPress={() => void call("PUT", "/library/mine", { password: null })} disabled={busy} /> : null}
        </View>
        <AppText variant="caption" tone="muted">
          換密碼後，之前輸入過舊密碼的人需要重新輸入。失效後任何人都不能再用這個密碼進入，要再開放請設定新密碼。
        </AppText>
      </Section>

      <Section title="書架與書">
        {items.length ? (
          <Card style={{ paddingVertical: 0 }}>
            {items.map((it, i) => (
              <View key={it.id} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: space.xs, borderBottomWidth: 1, borderBottomColor: c.border }}>
                <Pressable accessibilityRole="button" onPress={() => (locked ? lockedTip() : setSheet({ kind: it.kind, item: it }))} style={{ flex: 1, minWidth: 0, minHeight: minTouch, justifyContent: "center", paddingLeft: space.sm, flexDirection: "row", alignItems: "center", gap: 10 }}>
                  {it.kind === "shelf" ? <Icon name="folder-open-outline" size={26} color={c.accent} /> : it.type ? <BrandIcon type={it.type} fallback={TYPE_INFO[it.type].icon as never} size={30} /> : null}
                  <View style={{ flex: 1 }}>
                    <AppText variant="body" numberOfLines={2} style={it.kind === "shelf" ? { fontWeight: "800" } : undefined}>
                      {it.title}
                    </AppText>
                    <AppText variant="caption" tone="muted" numberOfLines={1}>
                      {[it.kind === "shelf" ? "書架（分類標題）" : it.type ? TYPE_INFO[it.type].label : "", it.eventDate ? eventDays(it.eventDate, null) : "", it.pwSet ? (it.pwExpired ? "🔒 密碼已失效" : "🔒 有密碼") : ""].filter(Boolean).join(" · ")}
                    </AppText>
                  </View>
                </Pressable>
                <IconButton icon="arrow-up" label="上移" onPress={i > 0 ? () => move(i, i - 1) : undefined} disabled={busy} />
                <IconButton icon="arrow-down" label="下移" onPress={i < items.length - 1 ? () => move(i, i + 1) : undefined} disabled={busy} />
                <IconButton icon="trash-outline" label="刪除" onPress={() => void remove(it)} disabled={busy} danger />
              </View>
            ))}
          </Card>
        ) : (
          <AppText variant="callout" tone="muted">
            還沒有內容。先新增書架（分類），再把書（影片、簡報、PDF、連結）放進去。
          </AppText>
        )}
        <Button variant="secondary" label="新增書架" icon="folder-open-outline" onPress={() => (locked ? lockedTip() : setSheet({ kind: "shelf" }))} fullWidth />
        <Button label="新增書" icon="add" onPress={() => (locked ? lockedTip() : setSheet({ kind: "book" }))} fullWidth />
      </Section>
      {sheet ? <ItemSheet kind={sheet.kind} item={sheet.item} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); reload(); }} /> : null}
    </Screen>
  );
}

function ItemSheet({ kind, item, onClose, onSaved }: { kind: "shelf" | "book"; item?: LibraryItem; onClose: () => void; onSaved: () => void }) {
  const { c } = useTheme();
  const [url, setUrl] = useState(item?.url ?? "");
  const [title, setTitle] = useState(item?.title ?? "");
  const [evDate, setEvDate] = useState(item?.eventDate ?? "");
  const [pw, setPw] = useState("");
  const [days, setDays] = useState("");
  const [clearPw, setClearPw] = useState(false);
  const [trim, setTrim] = useState<{ start: Hms; end: Hms }>({ start: toHms(item?.start ?? null), end: toHms(item?.end ?? null) });
  const [vidSec, setVidSec] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseHttpsUrl(url);
  const type = parsed ? classifyLink(parsed) : null;
  const ytId = (() => {
    if (type !== "youtube" || !parsed) return null;
    if (parsed.hostname.replace(/^www\./, "") === "youtu.be") return parsed.pathname.split("/")[1] || null;
    return parsed.searchParams.get("v") ?? /\/(?:shorts|embed|live)\/([\w-]{6,})/.exec(parsed.pathname)?.[1] ?? null;
  })();
  useEffect(() => {
    setVidSec(null);
    if (ytId) void detectYoutubeSeconds(ytId).then(setVidSec);
  }, [ytId]);
  const sec = (h: Hms) => (fromHms(h) === "invalid" ? null : (fromHms(h) as number | null));
  const submit = async () => {
    setError(null);
    if (kind === "shelf" && !title.trim()) return setError("請輸入書架名稱");
    if (kind === "book" && !parsed) return setError("請貼上 https 開頭的連結");
    setBusy(true);
    try {
      const body: Record<string, unknown> = { kind, title: title.trim() || undefined };
      if (kind === "book") {
        body.url = parsed!.toString();
        body.eventDate = evDate || null;
        if (ytId) Object.assign(body, { startSeconds: sec(trim.start), endSeconds: sec(trim.end) });
        if (clearPw) body.password = null;
        else if (pw) Object.assign(body, { password: pw, passwordDays: days ? Number(days) : null });
      }
      if (item) await api("PATCH", `/library/mine/items/${item.id}`, body);
      else await api("POST", "/library/mine/items", body);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const input = [{ minHeight: minTouch, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md }, type_body(), { color: c.text, borderColor: c.border, backgroundColor: c.surface }];
  return (
    <EditSheet title={item ? (kind === "shelf" ? "修改書架" : "修改這本書") : kind === "shelf" ? "新增書架" : "新增書"} onClose={onClose} onSave={submit} saveLabel={item ? "儲存" : "新增"} dirty busy={busy} error={error}>
      {kind === "book" ? (
        <>
          <AppText variant="callout" tone="muted">
            連結（影片、簡報、PDF、網頁都可以）
          </AppText>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <TextInput value={url} onChangeText={setUrl} placeholder="https://…" placeholderTextColor={c.textMuted} autoCapitalize="none" autoCorrect={false} keyboardType="url" accessibilityLabel="連結" style={[...input, { flex: 1 }]} />
            <Pressable accessibilityRole="button" accessibilityLabel="貼上" onPress={() => void Clipboard.getStringAsync().then((t) => setUrl(t.trim()))} style={{ minHeight: minTouch, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: c.accent, justifyContent: "center" }}>
              <AppText variant="callout" style={{ color: c.textOnAccent, fontWeight: "700" }}>貼上</AppText>
            </Pressable>
          </View>
          {type ? <AppText variant="caption" tone="muted">類型：{TYPE_INFO[type].label}</AppText> : null}
        </>
      ) : null}
      <AppText variant="callout" tone="muted">
        {kind === "shelf" ? "書架名稱（分類標題）" : "書名（空白會自動用連結的標題）"}
      </AppText>
      <TextInput value={title} onChangeText={setTitle} placeholder={kind === "shelf" ? "例如：我主講的課程" : "書名"} placeholderTextColor={c.textMuted} accessibilityLabel="名稱" maxLength={80} style={input} />
      {kind === "book" ? (
        <>
          <DateSelect label="日期（選填）" value={evDate} onChange={setEvDate} />
          {ytId ? <TimeRangePicker kind="youtube" ytId={ytId} audioFile={null} duration={vidSec} start={trim.start} end={trim.end} onChange={(p) => setTrim((x) => ({ ...x, ...p }))} /> : null}
          <AppText variant="headline">這本書的密碼（選填）</AppText>
          <AppText variant="caption" tone="muted">
            {item?.pwSet ? (item.pwExpired ? "目前的密碼已失效。" : "目前有密碼。") : "沒有設定時，進得了書櫃的人都能開啟。"} 輸入新密碼會取代舊的。
          </AppText>
          <TextInput value={pw} onChangeText={(v) => { setPw(v); setClearPw(false); }} placeholder="新密碼（4～40 個字）" placeholderTextColor={c.textMuted} autoCapitalize="none" accessibilityLabel="這本書的密碼" style={input} />
          <Field label="幾天後失效（留空＝不自動失效）" value={days} onChange={(v) => setDays(v.replace(/\D/g, ""))} numeric placeholder="例如：7" />
          {item?.pwSet ? (
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: clearPw }} onPress={() => { setClearPw((v) => !v); setPw(""); }} style={{ minHeight: minTouch, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Icon name={clearPw ? "checkbox" : "square-outline"} size={26} color={clearPw ? c.accent : c.textMuted} />
              <AppText variant="body">關閉這本書的密碼</AppText>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </EditSheet>
  );
}
const type_body = () => type.body;
