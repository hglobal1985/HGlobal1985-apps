import { Linking } from "react-native";
import { resolveUrl } from "@/api/client";
import { Button } from "@/ui";

/** App 版：用系統播放器打開作業影片。 */
export function HwVideo({ url }: { url: string; poster: string | null }) {
  return <Button variant="secondary" label="播放影片" icon="play-circle-outline" onPress={() => void Linking.openURL(resolveUrl(url))} fullWidth />;
}
