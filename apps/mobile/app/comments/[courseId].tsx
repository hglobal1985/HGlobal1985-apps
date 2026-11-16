import { useLocalSearchParams } from "expo-router";
import { CommentBoard } from "@/features/comments/comment-board";
import { Screen } from "@/ui";

/** 完整留言板：從課程頁的留言彈出面板上拉（或按「完整留言板」）進入；全文與所有操作直接顯示，focus 是帶進來的那一則。 */
export default function CommentsScreen() {
  const { courseId, focus } = useLocalSearchParams<{ courseId: string; focus?: string }>();
  return (
    <Screen header={false}>
      <CommentBoard courseId={courseId} full focusId={focus} />
    </Screen>
  );
}
