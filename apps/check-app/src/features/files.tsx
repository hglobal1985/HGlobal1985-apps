/** 繳交內容的方格（照片、影片、檔案、連結、文字）與留言區。 */
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Image, Linking, Modal, Platform, Pressable, Text, View } from "react-native";
import { API_BASE } from "../api";
import type { CommentView, FileView } from "../../../api/src/contract";
import { api, openFile } from "../api";
import { useColors } from "../theme";
import { Avatar, Btn, confirmSheet, Field, flash, flashError, Section, Sheet, T } from "../ui";

const ICON: Record<FileView["kind"], keyof typeof Ionicons.glyphMap> = { photo: "image-outline", video: "play-circle-outline", file: "document-text-outline", link: "link-outline", text: "create-outline" };

export function FileGrid({ files, onRemove }: { files: FileView[]; onRemove?: (f: FileView) => void }) {
  const c = useColors();
  const [text, setText] = useState<FileView | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  if (!files.length) return null;
  const open = async (f: FileView) => {
    try {
      if (f.kind === "photo" && f.url) setPhoto(API_BASE + f.url);
      else if (f.kind === "link" && f.url) {
        if (Platform.OS === "web") window.open(f.url, "_blank", "noopener");
        else await Linking.openURL(f.url);
      } else if (f.kind === "text") setText(f);
      else await openFile(f.id);
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
      <Modal visible={!!photo} transparent animationType="fade" onRequestClose={() => setPhoto(null)}>
        <Pressable accessibilityLabel="關閉" onPress={() => setPhoto(null)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" }}>
          {photo ? <Image source={{ uri: photo }} resizeMode="contain" style={{ width: "100%", height: "86%" }} /> : null}
          <Text style={{ color: "#fff", marginTop: 8 }}>點一下關閉</Text>
        </Pressable>
      </Modal>
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
              await api(`/submissions/${submissionId}/comments`, "POST", { body: text });
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
                await api(`/comments/${m.id}/hide`, "POST");
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
                await api("/reports", "POST", { target: `comment:${m.id}`, reason: "" });
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
