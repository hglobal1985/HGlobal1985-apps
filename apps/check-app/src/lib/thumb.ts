/** 共用元件的轉接檔：繳作業系統的作業照片不經過即時縮圖服務，直接用原網址。 */
export function useThumb(): (url: string, cssWidth: number) => string {
  return (url) => url;
}
