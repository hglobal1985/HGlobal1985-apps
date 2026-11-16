import { router, Stack, useLocalSearchParams } from "expo-router";
import { PageHeader } from "@/features/page-header";
import { useApi } from "@/state/session";
import { EmptyState, ErrorView, LoadingView, Screen, Button } from "@/ui";
import { CoursesView } from "./courses-view";
import { SeriesPage } from "./series-page";

/**
 * 短網址頁（/縮寫，分類、系列或中心）：網址列維持短網址不變，內容是該分類／系列的課程清單。
 * 縮寫由超級管理員在「設定 → 短網址」自訂。
 */
export function ShortLinkScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { data, error, loading, reload } = useApi<{ kind: string; value: string }>(`/short-links/${slug}`);
  if (loading && !data) return <LoadingView />;
  if (!data)
    return (
      <Screen header={false}>
        {error && !/找不到|not_found|404/.test(error) ? (
          <ErrorView message={error} onRetry={reload} />
        ) : (
          <>
            <EmptyState icon="link-outline" title="找不到這個短網址" />
            <Button label="看全部課程" onPress={() => router.replace("/courses")} fullWidth />
          </>
        )}
      </Screen>
    );
  return (
    <>
      {/* 中心頁自己有上方工具列（返回、標題、編輯、分享），這裡不再放一條，否則重新整理後會出現兩條。 */}
      {data.kind === "center" ? <Stack.Screen options={{ headerShown: false }} /> : data.kind === "series" ? null : <PageHeader title={data.value} path={`/${slug}`} />}
      {data.kind === "category" ? <CoursesView initialCategory={data.value} inStack /> : data.kind === "center" ? <CoursesView initialCenter={data.value} inStack /> : <SeriesPage series={data.value} path={`/${slug}`} />}
    </>
  );
}
