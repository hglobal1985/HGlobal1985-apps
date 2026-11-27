/** 手機推播設定卡：改用共用元件（features/push-switch.tsx，與行動大學同一份；杜杜龍 2026-11-27）。 */
import { PushCard as SharedPushCard } from "@/features/push-switch";

export function PushCard() {
  return <SharedPushCard note="出新作業、評分、退回、留言、截止提醒都會推到這支手機。每支裝置各自開啟。" />;
}
