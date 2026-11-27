import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { api } from "@/api/client";
import { useData } from "@/state/session";
import { Btn, Card, flash, flashError, Loading, Note, Screen, T } from "@/kit";

type Info = { role: string; title: string; groupName: string | null; valid: boolean; usedByMe: boolean };

/** 邀請連結：老師邀請（24 小時、只能一人使用）、組長邀請（7 天、只能一人使用；杜杜龍 2026-11-27）。 */
export default function Invite() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { data, error } = useData<Info>(`/invite/${code}`);
  const [busy, setBusy] = useState(false);
  const leader = data?.role === "leader";
  const title = leader ? "組長邀請" : "老師邀請";
  if (!data) return <Screen title="邀請">{error ? <Note tone="bad">{error}</Note> : <Loading />}</Screen>;
  return (
    <Screen title={title}>
      <Card>
        <T bold>{leader ? `你被邀請擔任「${data.title}」${data.groupName ?? ""}的組長` : `你被邀請擔任「${data.title}」的作業老師`}</T>
        <T small muted>
          {leader
            ? "接受後你就是這一組的組長：可以分享本組連結邀請組員、核准組員加入、確認或退回組員的作業（不能評分）。"
            : "接受後可以看到這份作業全部學員的繳交，並評分、退回重交。"}
        </T>
      </Card>
      {!data.valid ? <Note tone="bad">{data.usedByMe ? "你已經接受過這個邀請了。" : leader ? "這個組長邀請已失效（7 天內、只能一人使用），請向老師索取新的。" : "這個邀請已失效（24 小時內、只能一人使用）。"}</Note> : null}
      <Btn
        flex={false}
        label={data.usedByMe ? "前往作業" : "接受"}
        busy={busy}
        disabled={!data.valid && !data.usedByMe}
        onPress={async () => {
          if (data.usedByMe) return router.replace("/");
          setBusy(true);
          try {
            const r = await api<{ activityId: string }>("POST", `/invite/${code}`);
            if (leader) {
              flash("你是組長了", "下一步：分享本組連結邀請組員");
              router.replace(`/groups/${r.activityId}`);
            } else {
              flash("已加入", "你現在是這份作業的老師");
              router.replace(`/activity/${r.activityId}`);
            }
          } catch (e) {
            flashError(e);
          } finally {
            setBusy(false);
          }
        }}
      />
    </Screen>
  );
}
