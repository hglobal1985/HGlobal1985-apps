import { shareLink } from "@/lib/share";
import { useTheme } from "@/theme/theme";
import { ShareIcon, TopBarButton } from "@/ui";
import { showToast } from "@/ui/toast";

/**
 * 上方工具列（回上一頁那一列）靠右的分享按鈕：分享「這一頁」的網址，叫出系統分享選單；
 * 圖示用系統預設圖案（iOS／Mac＝方框加向上箭頭，Android＝三個圓點相連）。
 */
export function HeaderShare({ title, path, course, list }: { title: string; path: string; course?: { teacher: string; teacherTitle?: string; title: string }; list?: { title: string } }) {
  const { c } = useTheme();
  const share = async () => {
    const r = await shareLink(title, path, course, undefined, undefined, list);
    if (r === "copied") showToast("已複製連結");
  };
  return <TopBarButton label="分享" accessibilityLabel="分享這一頁" tone="text" icon={<ShareIcon size={22} color={c.text} />} onPress={share} />;
}
