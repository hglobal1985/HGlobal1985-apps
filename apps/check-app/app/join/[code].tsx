import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { api } from "@/api/client";
import { useData } from "@/state/session";
import { Btn, Card, flash, flashError, Loading, Note, Screen, T } from "@/kit";

type Info = { activityId: string; title: string; groupName: string | null; approval: boolean; joined: string | null };

/** 加入連結（作業或分組）。 */
export default function Join() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { data, error } = useData<Info>(`/join/${code}`);
  const [busy, setBusy] = useState(false);
  if (!data) return <Screen title="加入作業">{error ? <Note tone="bad">{error}</Note> : <Loading />}</Screen>;
  return (
    <Screen title="加入作業">
      <Card>
        <T bold>{data.title}</T>
        {data.groupName ? <T small muted>加入「{data.groupName}」</T> : null}
        {data.approval ? <T small muted>送出後要等管理員核准，核准後會通知你。</T> : null}
      </Card>
      {data.joined === "active" && !data.groupName ? (
        <Btn flex={false} label="你已經加入了，前往作業" onPress={() => router.replace(`/activity/${data.activityId}`)} />
      ) : (
        <Btn
          flex={false}
          label={data.joined === "pending" ? "已申請，等待核准" : "加入"}
          disabled={data.joined === "pending"}
          busy={busy}
          onPress={async () => {
            setBusy(true);
            try {
              const r = await api<{ activityId: string; status: string }>(`/join/${code}`, "POST");
              if (r.status === "active") {
                flash("已加入", data.title);
                router.replace(`/activity/${r.activityId}`);
              } else {
                flash("已送出申請", "管理員核准後會通知你");
                router.replace("/");
              }
            } catch (e) {
              flashError(e);
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </Screen>
  );
}
