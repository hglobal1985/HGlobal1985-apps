import { View } from "react-native";
import { AlbumBrowser } from "@/features/albums/album-browser";
import { PageHeader } from "@/features/page-header";
import { Screen } from "@/ui";

/** 相簿專區（第五大分類，業主 2026-11-25）：超派、至尊共用同一個頁面（資料夾檢視；大字由全站字體倍數處理）。 */
export default function AlbumsScreen() {
  return (
    <View style={{ flex: 1 }}>
      <PageHeader title="相簿" path="/albums" backTo="/courses" />
      <Screen header={false} wide>
        <AlbumBrowser />
      </Screen>
    </View>
  );
}
