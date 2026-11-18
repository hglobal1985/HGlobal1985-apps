import { Button } from "@/ui";

/** App 版暫不提供上傳（請用網頁版後台）。 */
export function PickImageButton({ label }: { label: string; onPick: (file: File) => void; busy?: boolean; variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return <Button label={`${label}（請用網頁版）`} variant="secondary" disabled onPress={() => undefined} />;
}
