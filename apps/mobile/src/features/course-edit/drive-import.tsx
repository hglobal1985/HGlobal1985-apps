import { AppText, Chips, Field } from "@/ui";
import { Check } from "@/ui/check";
import { space } from "@/theme/tokens";
import { View } from "react-native";

/** 貼上的連結是不是 Google 雲端「資料夾」（網址裡有 /folders/）。 */
export const isDriveFolderUrl = (u: URL | null): boolean => !!u && u.hostname === "drive.google.com" && /\/folders\/[\w-]{10,}/.test(u.pathname);

/** 白金溝通會的固定命名：簡報2026年11月 白金溝通會（淨熱組/公益/悅齡錠）（與後端 drive-sync.ts 的 PLATINUM_FORMAT 相同）。 */
export const DRIVE_PLATINUM_FORMAT = "簡報{年}年{月}月 白金溝通會{括號}";

/**
 * 「新增教材」貼上 Google 雲端資料夾連結時出現（杜杜龍 2026-11-26）：勾選＝把資料夾裡的檔案一列列匯成教材，並加入系統後台自動同步
 * （會出現在「設定 › 同步雲端資料夾」，每週自動同步＋可手動同步）；不勾＝跟平常一樣只加一個連結，點了開新視窗。預設不勾。
 */
export function DriveFolderOptions({ on, setOn, format, setFormat }: { on: boolean; setOn: (v: boolean) => void; format: string; setFormat: (v: string) => void }) {
  return (
    <View style={{ gap: space.sm }}>
      <Check label="把這個資料夾裡的檔案一列列匯入，並加入自動同步" value={on} onChange={setOn} />
      <AppText variant="caption" tone="muted">
        {on ? "會把資料夾裡每個檔案各加成一列教材（只存雲端連結，點了開新視窗），並加入「設定 › 同步雲端資料夾」，之後每週自動同步、也能手動同步。資料夾共用要設成「知道連結的任何人可檢視」。" : "不勾選：只加入這一個連結，點了會開新視窗到 Google 雲端硬碟。"}
      </AppText>
      {on ? (
        <>
          <Field label="教材命名規則" value={format} onChange={setFormat} placeholder="{標題}" />
          <Chips label="快速套用" options={[{ key: DRIVE_PLATINUM_FORMAT, label: "白金溝通會：簡報x年x月 白金溝通會（括號文字）" }, { key: "{標題}", label: "直接用檔名" }]} value={format} onChange={setFormat} />
          <AppText variant="caption" tone="muted">可用：{"{年}"}、{"{月}"}（檔名開頭的 YYYYMM，沒有就用檔案修改日）、{"{括號}"}（檔名裡（）括號與裡面的文字）、{"{標題}"}（檔名，不含副檔名）。</AppText>
        </>
      ) : null}
    </View>
  );
}
