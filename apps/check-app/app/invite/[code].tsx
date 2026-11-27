import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { api } from "@/api/client";
import { Btn, Card, flash, flashError, Screen, T } from "@/kit";

/** 老師邀請連結（24 小時、只能一人使用）。 */
export default function Invite() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const [busy, setBusy] = useState(false);
  return (
    <Screen title="老師邀請">
      <Card>
        <T bold>你被邀請擔任作業老師</T>
        <T small muted>接受後可以看到這份作業全部學員的繳交，並評分、退回重交。</T>
      </Card>
      <Btn
        flex={false}
        label="接受"
        busy={busy}
        onPress={async () => {
          setBusy(true);
          try {
            const r = await api<{ activityId: string }>("POST", `/invite/${code}`);
            flash("已加入", "你現在是這份作業的老師");
            router.replace(`/activity/${r.activityId}`);
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
