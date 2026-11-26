/** 某一堂章節的網址：章節在課程介紹頁「原地播放」（杜杜龍 2026-11-16），舊的 /learn/課程/章節 網址會自動轉到這裡。 */
/** 某一堂章節的「分享網址」：課程有專屬網址就用專屬網址，否則用 /course/編號；後面只加 ?章節編號（例如 ?2），點開直接播放那一章。 */
export const lessonShareHref = (course: { id: string; shortPath?: string | null }, chapterNo: number) => `${course.shortPath ? `/${course.shortPath}` : `/course/${course.id}`}?${chapterNo}`;

export const lessonHref = (courseId: string, lessonId: string) => `/course/${courseId}?lesson=${lessonId}`;
