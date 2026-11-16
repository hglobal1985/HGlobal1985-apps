/** 某一堂章節的網址：章節在課程介紹頁「原地播放」（業主 2026-11-16），舊的 /learn/課程/章節 網址會自動轉到這裡。 */
export const lessonHref = (courseId: string, lessonId: string) => `/course/${courseId}?lesson=${lessonId}`;
