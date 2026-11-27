/** 繳交內容的方格（照片、影片、檔案、連結、文字）與留言區。 */
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Image, Linking, Platform, Pressable, Text, View } from "react-native";
import { EdmLightbox } from "@/features/courses/lightbox";
import { VideoViewer } from "@/ui/video-viewer";
import type { CommentView, FileView } from "@check/contract";
import { api, API_BASE, openFile } from "@/api/client";
import { useColors } from "@/kit";
import { Avatar, Btn, confirmSheet, Field, flash, flashError, Section, Sheet, T } from "@/kit";

const ICON: Record<FileView["kind"], keyof typeof Ionicons.glyphMap> = { photo: "image-outline", video: "play-circle-outline", file: "document-text-outline", link: "link-outline", text: "create-outline" };

export function FileGrid({ files, onRemove }: { files: FileView[]; onRemove?: (f: FileView) => void }) {
  const c = useColors();
  const [text, setText] = useState<FileView | null>(null);
  const [photo, setPhoto] = useState<number | null>(null);
  const [video, setVideo] = useState<{ uri: string; title: string } | null>(null);
  const photos = files.filter((f) => f.kind === "photo" && f.url);
  if (!files.length) return null;
  const open = async (f: FileView) => {
    try {
      if (f.kind === "photo" && f.url) setPhoto(Math.max(0, photos.findIndex((p) => p.id === f.id)));
      else if (f.kind === "link" && f.url) {
        if (Platform.OS === "web") window.open(f.url, "_blank", "noopener");
        else await Linking.openURL(f.url);
      } else if (f.kind === "text") setText(f);
      else if (f.kind === "video") {
        // 短影片：在畫面裡直接播放（共用的影片檢視元件 VideoViewer），不用離開 App
        const { url } = await api<{ url: string }>("POST", `/files/${f.id}/ticket`);
        setVideo({ uri: API_BASE + url, title: f.name });
      } else await openFile(f.id);
    } catch (e) {
      flashError(e);
    }
  };
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {files.map((f) => (
        <Pressable
          key={f.id}
          accessibilityRole="button"
          accessibilityLabel={`打開 ${f.name}`}
          onPress={() => open(f)}
          style={{ width: "31%", aspectRatio: 1, borderRadius: 12, backgroundColor: f.kind === "photo" ? c.greenSoft : f.kind === "video" ? c.fg : c.orangeSoft, alignItems: "center", justifyContent: "center", padding: 6, gap: 4 }}
        >
          {f.kind === "photo" && f.url ? (
            <Image source={{ uri: API_BASE + f.url }} resizeMode="cover" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 12 }} accessibilityLabel={f.name} />
          ) : (
            <>
              <Ionicons name={ICON[f.kind]} size={28} color={f.kind === "video" ? c.bg : c.greenDark} />
              <Text numberOfLines={2} style={{ fontSize: 12, textAlign: "center", color: f.kind === "video" ? c.bg : c.fg }}>
                {f.name}
              </Text>
            </>
          )}
          {onRemove && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`移除 ${f.name}`}
              onPress={async () => {
                if (await confirmSheet("移除這個檔案？", f.name, "移除", true)) onRemove(f);
              }}
              style={{ position: "absolute", top: 2, right: 2, width: 36, height: 36, alignItems: "center", justifyContent: "center" }}
            >
              <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="close" size={16} color="#fff" />
              </View>
            </Pressable>
          )}
        </Pressable>
      ))}
      {video ? <VideoViewer uri={video.uri} title={video.title} onClose={() => setVideo(null)} /> : null}
      {photo !== null && photos.length ? (
        // 看圖程式：共用元件（與行動大學同一個；兩指放大、左右滑換張、下載、分享）
        <EdmLightbox uri={photos[0]!.url!} title={photos[photo]?.name ?? "照片"} items={photos.map((p) => ({ uri: p.url!, title: p.name }))} index={photo} onClose={() => setPhoto(null)} />
      ) : null}
      <Sheet open={!!text} onClose={() => setText(null)} title={text?.name} footer={<Btn label="關閉" kind="cancel" onPress={() => setText(null)} />}>
        <T>{text?.body ?? ""}</T>
      </Sheet>
    </View>
  );
}

export function Comments({ submissionId, comments, onChange, canModerate }: { submissionId: string; comments: CommentView[]; onChange: () => void; canModerate?: boolean }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<CommentView | null>(null);
  return (
    <View style={{ gap: 10 }}>
      <Section title={`留言${comments.length ? `（${comments.length}）` : ""}`} />
      {comments.map((cm) => (
        <Pressable key={cm.id} onLongPress={() => setMenu(cm)} style={{ flexDirection: "row", gap: 10 }}>
          <Avatar name={cm.name} sizePx={30} />
          <View style={{ flex: 1 }}>
            <T tiny muted>
              {cm.name}・{cm.roleLabel}
            </T>
            <T small>{cm.body}</T>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="更多" onPress={() => setMenu(cm)} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="ellipsis-horizontal" size={18} color="#8a948e" />
          </Pressable>
        </Pressable>
      ))}
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
        <View style={{ flex: 1 }}>
          <Field value={text} onChangeText={setText} placeholder="寫留言…" multiline style={{ minHeight: 44 }} />
        </View>
        <Btn
          small
          flex={false}
          label="送出"
          busy={busy}
          disabled={!text.trim()}
          onPress={async () => {
            setBusy(true);
            try {
              await api("POST", `/submissions/${submissionId}/comments`, { body: text });
              setText("");
              flash("已留言", "對方會收到通知");
              onChange();
            } catch (e) {
              flashError(e);
            } finally {
              setBusy(false);
            }
          }}
        />
      </View>
      <Sheet open={!!menu} onClose={() => setMenu(null)} title="這則留言" footer={<Btn label="關閉" kind="cancel" onPress={() => setMenu(null)} />}>
        {menu?.mine || canModerate ? (
          <Btn
            kind="grey"
            flex={false}
            label={menu?.mine ? "刪除我的留言" : "隱藏這則留言"}
            onPress={async () => {
              const m = menu!;
              setMenu(null);
              try {
                await api("POST", `/comments/${m.id}/hide`);
                flash(m.mine ? "已刪除" : "已隱藏");
                onChange();
              } catch (e) {
                flashError(e);
              }
            }}
          />
        ) : null}
        {!menu?.mine ? (
          <Btn
            kind="grey"
            flex={false}
            label="檢舉這則留言"
            onPress={async () => {
              const m = menu!;
              setMenu(null);
              try {
                await api("POST", "/reports", { target: `comment:${m.id}`, reason: "" });
                flash("已檢舉", "管理員會處理");
              } catch (e) {
                flashError(e);
              }
            }}
          />
        ) : null}
      </Sheet>
    </View>
  );
}
