import { useLocalSearchParams } from "expo-router";
import { useApi } from "@/state/session";
import { EmptyState, ErrorView, LoadingView, Screen } from "@/ui";
import { CourseDetailScreen } from "../course/[id]";

/** 課程專屬網址：learn.hglobal1985.com/中心縮寫/英譯姓名-編號（網址列維持不變，內容就是課程介紹頁）。 */
export default function CourseUrl() {
  const { slug, name } = useLocalSearchParams<{ slug: string; name: string }>();
  const { data, error, loading, reload } = useApi<{ courseId: string }>(`/short-links/${slug}/${name}`);
  if (loading && !data)
    return (
      <Screen header={false}>
        <LoadingView />
      </Screen>
    );
  if (!data)
    return (
      <Screen header={false}>
        {error && !/找不到|not_found|404/.test(error) ? <ErrorView message={error} onRetry={reload} /> : <EmptyState icon="link-outline" title="找不到這個網址" />}
      </Screen>
    );
  return <CourseDetailScreen id={data.courseId} />;
}
