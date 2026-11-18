import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Platform, View } from "react-native";
import { api } from "@/api/client";
import { confirmSheet } from "@/features/confirm";
import { DriveUpload } from "@/features/uploads/drive-upload";
import { useApi, useSession } from "@/state/session";
import { space } from "@/theme/tokens";
import { flashText } from "@/ui/flash-notice";
import { AppText, Button, Card, EmptyState, ErrorView, ListRow, LoadingView, NoticeBox, Screen, Section } from "@/ui";

type Drive = {
  configured: boolean;
  connected: boolean;
  broken: boolean;
  account: string;
  folder: string;
  connectedAt: string | null;
  maxBytes: number;
  uploads: { id: string; name: string; size: number; by: string; center: string; at: string; link: string }[];
};

const sizeText = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);
const dateText = (iso: string) => iso.slice(0, 16).replace("T", " ");
const REDIRECT = "https://learn.hglobal1985.com/api/v2/admin/drive/callback";

/**
 * 設定 > 雲端硬碟上傳（業主 2026-11-18）：所有管理員都能把檔案上傳到業主的 Google 雲端硬碟「行動大學上傳」資料夾。
 * 超級管理員在這裡用業主的 Google 帳號授權一次（只開放這個 App 自己建立的檔案，看不到雲端硬碟其他內容）。
 */
export default function DriveScreen() {
  const { member } = useSession();
  const isAdmin = member?.role === "admin";
  const isSuper = !!member?.titles.includes("超級管理員");
  const { data, error, loading, reload } = useApi<Drive>(isAdmin ? "/admin/drive" : null);
  const params = useLocalSearchParams<{ drive?: string }>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (params.drive === "ok") flashText("已連結雲端硬碟");
    else if (params.drive) flashText("連結失敗，請再試一次");
  }, [params.drive]);

  if (!isAdmin) return <Screen header={false}><EmptyState icon="lock-closed-outline" title="只有管理員可以使用" /></Screen>;

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>("POST", "/admin/drive/connect");
      if (Platform.OS === "web") window.location.href = url;
      else await Linking.openURL(url);
    } catch (e) {
      flashText((e as Error).message);
      setBusy(false);
    }
  };
  const disconnect = async () => {
    if (!(await confirmSheet({ title: "取消連結", message: "取消後所有管理員都無法上傳到雲端硬碟（已上傳的檔案不受影響）。確定嗎？", confirmLabel: "取消連結", cancelLabel: "先不要", danger: true }))) return;
    setBusy(true);
    try {
      await api("DELETE", "/admin/drive/connect");
      flashText("已取消連結");
      reload();
    } catch (e) {
      flashText((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={false}>
      {error && !data ? <ErrorView message={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingView /> : null}
      {data ? (
        <>
          <Section title="上傳到雲端硬碟">
            <Card>
              {data.connected ? (
                <>
                  <AppText variant="callout">檔案會存進業主 Google 雲端硬碟的「{data.folder}」資料夾，單檔最大 {Math.round(data.maxBytes / 1024 ** 3)}GB，任何格式都可以（含影片）。</AppText>
                  <DriveUpload maxBytes={data.maxBytes} onDone={reload} />
                </>
              ) : data.broken ? (
                <NoticeBox tone="danger" text={isSuper ? "Google 授權已失效（可能被撤銷或過期），請在下方重新連結。" : "雲端硬碟授權已失效，請聯絡超級管理員重新連結。"} />
              ) : (
                <NoticeBox text={isSuper ? "還沒連結雲端硬碟，請在下方完成連結後，所有管理員就能上傳。" : "超級管理員還沒連結雲端硬碟，暫時無法上傳。"} />
              )}
            </Card>
          </Section>

          {isSuper ? (
            <Section title="連結設定（超級管理員）">
              <Card>
                {!data.configured ? (
                  <>
                    <NoticeBox tone="danger" text="還沒有設定 Google 用戶端代碼與密鑰，無法連結。" />
                    <AppText variant="callout" style={{ fontWeight: "800" }}>一次性設定步驟</AppText>
                    <AppText variant="callout">1. 用 hglobal1985@gmail.com 登入 console.cloud.google.com，建立專案，啟用「Google Drive API」。</AppText>
                    <AppText variant="callout">2. 「Google 驗證平台 › 品牌塑造」填 App 名稱（寰宇行動大學）與您的 Email；「目標對象」選「外部」，並按「發布應用程式」（不發布的話授權 7 天就會失效）。</AppText>
                    <AppText variant="callout">3. 「資料存取」新增範圍：.../auth/drive.file 與 .../auth/userinfo.email。</AppText>
                    <AppText variant="callout">4. 「用戶端」建立 OAuth 用戶端，類型選「網頁應用程式」，「已授權的重新導向 URI」填：</AppText>
                    <AppText variant="callout" selectable style={{ fontWeight: "700" }}>{REDIRECT}</AppText>
                    <AppText variant="callout">5. 把產生的「用戶端 ID」「用戶端密鑰」交給 Cloudflare 後台的 learn Worker：設定 › 變數和密鑰，新增 Secret：GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET（請勿貼到對話或程式）。</AppText>
                    <AppText variant="caption" tone="muted">設定好後回到這頁，按「連結 Google 雲端硬碟」。</AppText>
                  </>
                ) : (
                  <>
                    {data.connected ? (
                      <ListRow icon="checkmark-circle-outline" title={`已連結：${data.account || "Google 帳號"}`} subtitle={data.connectedAt ? `連結時間 ${dateText(data.connectedAt)}` : undefined} />
                    ) : null}
                    <Button label={data.connected || data.broken ? "重新連結 Google 雲端硬碟" : "連結 Google 雲端硬碟"} icon="logo-google" variant={data.connected ? "secondary" : "primary"} loading={busy} disabled={busy} onPress={connect} fullWidth />
                    {data.connected || data.broken ? <Button label="取消連結" icon="close-circle-outline" variant="secondary" disabled={busy} onPress={disconnect} fullWidth /> : null}
                    <AppText variant="caption" tone="muted">授權時請選 hglobal1985@gmail.com。權限只限「這個 App 建立的檔案」，看不到雲端硬碟裡其他內容。</AppText>
                  </>
                )}
              </Card>
            </Section>
          ) : null}

          <Section title={isSuper ? "上傳紀錄（全部）" : "我的上傳紀錄"}>
            {data.uploads.length ? (
              <View style={{ gap: space.sm }}>
                {data.uploads.map((u) => (
                  <ListRow
                    key={u.id}
                    icon="document-outline"
                    title={u.name}
                    subtitle={`${sizeText(u.size)}・${isSuper ? `${u.by}${u.center ? `（${u.center}）` : ""}・` : ""}${dateText(u.at)}`}
                    onPress={u.link ? () => (Platform.OS === "web" ? window.open(u.link, "_blank", "noopener") : Linking.openURL(u.link)) : undefined}
                  />
                ))}
              </View>
            ) : (
              <EmptyState icon="cloud-outline" title="還沒有上傳紀錄" />
            )}
            {!isSuper ? <AppText variant="caption" tone="muted">檔案存在業主的雲端硬碟，這裡只列出檔名與時間。</AppText> : null}
          </Section>
        </>
      ) : null}
    </Screen>
  );
}
