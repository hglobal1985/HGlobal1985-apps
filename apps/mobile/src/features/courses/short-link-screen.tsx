import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { PageHeader } from "@/features/page-header";
import { useApi } from "@/state/session";
import { EmptyState, ErrorView, LoadingView, Screen, Button } from "@/ui";
import { LibraryScreen } from "@/features/library/library-view";
import { CoursesView } from "./courses-view";
import { SeriesPage } from "./series-page";

/**
 * 短網址頁（/縮寫，分類、系列或中心）：網址列維持短網址不變，內容是該分類／系列的課程清單。
 * 縮寫由超級管理員在「設定 → 短網址」自訂。
 */
export function ShortLinkScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  // 「我的書櫃」：網址是會員編號（含數字、至少 3 個字，例如 /tw9475831）；先當書櫃處理，找不到才當短網址（業主 2026-11-17）。
  if (/\d/.test(slug ?? "") && (slug ?? "").length >= 3) return <LibraryOrShort slug={slug!} />;
  return <ShortLinkInner />;
}

function LibraryOrShort({ slug }: { slug: string }) {
  const [state, setState] = useState<"checking" | "library" | "short">("checking");
  useEffect(() => {
    let alive = true;
    api("POST", `/library/view/${slug}`, { tokens: {} })
      .then(() => alive && setState("library"))
      .catch((e: Error) => alive && setState(/找不到|not_found|404/.test(e.message) ? "short" : "library"));
    return () => {
      alive = false;
    };
  }, [slug]);
  if (state === "checking") return <LoadingView />;
  if (state === "library") return <><Stack.Screen options={{ headerShown: false }} /><LibraryScreen number={slug} /></>;
  return <ShortLinkInner />;
}

function ShortLinkInner() {
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
