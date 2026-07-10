import { useCallback, useState } from "react";
import { Text } from "react-native";
import { useFocusEffect } from "expo-router";
import { Screen } from "../../src/components/Screen";
import { SectionLabel } from "../../src/components/SectionLabel";
import { TaskRow } from "../../src/components/TaskRow";
import { TaskActionSheet, type TaskAction } from "../../src/components/TaskActionSheet";
import { Toast } from "../../src/components/Toast";
import { colors, type } from "../../src/theme/tokens";
import { useFetched } from "../../src/hooks/useFetched";
import { useTaskList } from "../../src/hooks/useTaskList";
import { getBacklog, type TaskRow as TaskRowData } from "../../src/google";

export default function BacklogScreen() {
  const { data, stale, loading, refreshing, error, refresh } = useFetched<TaskRowData[]>(getBacklog, []);

  // See index.tsx: refetch on focus so a move-to-backlog from the 오늘 tab shows up here too.
  useFocusEffect(
    useCallback(() => {
      refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const { tasks, toast, editingId, toggleDone, moveTo, startEdit, cancelEdit, submitEdit } = useTaskList(
    "backlog",
    data ?? [],
  );
  const [sheetTask, setSheetTask] = useState<TaskRowData | null>(null);

  const sheetActions: TaskAction[] = sheetTask
    ? [
        { key: "today", label: "오늘로", onPress: () => moveTo(sheetTask, "today") },
        { key: "edit", label: "편집", onPress: () => startEdit(sheetTask.id) },
      ]
    : [];

  return (
    <Screen
      title="백로그"
      subtitle={loading && !data ? "불러오는 중…" : `${tasks.length}건`}
      stale={stale}
      refreshing={refreshing}
      onRefresh={refresh}
      overlay={<Toast message={toast.message} isError={toast.isError} />}
    >
      <SectionLabel>대기 중</SectionLabel>
      {error && !data ? (
        <Text style={{ color: colors.danger, fontFamily: "Pretendard", fontSize: type.meta }}>오류: {error}</Text>
      ) : tasks.length === 0 ? (
        <Text style={{ color: colors.textFaint, fontFamily: "Pretendard", fontSize: type.meta }}>
          {loading ? "불러오는 중…" : "백로그 없음"}
        </Text>
      ) : (
        tasks.map((task) => (
          <TaskRow
            key={task.id}
            title={task.title}
            done={task.status === "done"}
            doing={task.status === "doing"}
            projectLabel={task.project_name ?? undefined}
            pending={task.tasklist_id === "temp"}
            onToggleDone={() => toggleDone(task)}
            onLongPress={() => setSheetTask(task)}
            editing={editingId === task.id}
            onSubmitEdit={(nextTitle) => submitEdit(task, nextTitle)}
            onCancelEdit={cancelEdit}
          />
        ))
      )}

      <TaskActionSheet
        visible={!!sheetTask}
        title={sheetTask?.title}
        actions={sheetActions}
        onClose={() => setSheetTask(null)}
      />
    </Screen>
  );
}
