/** 某一堂章節的網址：章節在課程介紹頁「原地播放」（業主 2026-11-16），舊的 /learn/課程/章節 網址會自動轉到這裡。 */
/** 某一堂章節的「分享網址」：課程有專屬網址就用專屬網址，否則用 /course/編號；後面加 ?lesson=章節編號，點開直接停在那一堂。 */
export const lessonShareHref = (course: { id: string; shortPath?: string | null }, lessonId: string) => `${course.shortPath ? `/${course.shortPath}` : `/course/${course.id}`}?lesson=${lessonId}`;

export const lessonHref = (courseId: string, lessonId: string) => `/course/${courseId}?lesson=${lessonId}`;
