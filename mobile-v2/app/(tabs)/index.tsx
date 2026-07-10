import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Screen } from "../../src/components/Screen";
import { SectionLabel } from "../../src/components/SectionLabel";
import { TaskRow } from "../../src/components/TaskRow";
import { QuickAddInput } from "../../src/components/QuickAddInput";
import { TaskActionSheet, type TaskAction } from "../../src/components/TaskActionSheet";
import { Toast } from "../../src/components/Toast";
import { colors, space, type } from "../../src/theme/tokens";
import { useFetched } from "../../src/hooks/useFetched";
import { useTaskList } from "../../src/hooks/useTaskList";
import { getTodaySnapshot, type TaskRow as TaskRowData, type TodaySnapshot } from "../../src/google";
import { isAllDayOrOngoing, isEventNearNow, type CalendarEvent } from "../../src/google/calendar";

// KST 고정 + 렌더마다 재계산 — device timezone이나 자정 경과에 따라 어제 날짜가 남지 않게.
function formatTodayLabel(): string {
  return new Date().toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Seoul",
  });
}

function formatKstTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
}

export default function TodayScreen() {
  const { data, stale, loading, refreshing, error, refresh } = useFetched<TodaySnapshot>(getTodaySnapshot, []);

  // Cross-tab writes (a move-to-backlog here, or move-to-today from the 백로그
  // tab) clear the shared Google-data cache; refetch whenever this tab
  // regains focus so the list reflects the other tab's mutation.
  useFocusEffect(
    useCallback(() => {
      refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const events = data?.events ?? [];
  const dateStr = data?.dateStr ?? "";
  const { tasks, toast, editingId, quickAdd, toggleDone, toggleDoing, moveTo, startEdit, cancelEdit, submitEdit } =
    useTaskList("today", data?.tasks ?? []);

  const [sheetTask, setSheetTask] = useState<TaskRowData | null>(null);

  const topEvents: CalendarEvent[] = events.filter((e) => isAllDayOrOngoing(e, dateStr));
  const timedEvents: CalendarEvent[] = events.filter((e) => !isAllDayOrOngoing(e, dateStr));

  const subtitleParts = [formatTodayLabel()];
  if (loading && !data) subtitleParts.push("불러오는 중…");
  else if (error && !data) subtitleParts.push(`오류: ${error}`);
  const subtitle = subtitleParts.join(" · ");

  const sheetActions: TaskAction[] = sheetTask
    ? [
        {
          key: "doing",
          label: sheetTask.status === "doing" ? "진행 해제" : "진행",
          onPress: () => toggleDoing(sheetTask),
        },
        { key: "backlog", label: "백로그로", onPress: () => moveTo(sheetTask, "backlog") },
        { key: "edit", label: "편집", onPress: () => startEdit(sheetTask.id) },
      ]
    : [];

  return (
    <Screen
      title="오늘"
      subtitle={subtitle}
      stale={stale}
      refreshing={refreshing}
      onRefresh={refresh}
      overlay={<Toast message={toast.message} isError={toast.isError} />}
    >
      <SectionLabel>일정</SectionLabel>
      {events.length === 0 ? (
        <Text style={styles.empty}>{loading ? "일정 확인 중…" : "오늘 일정 없음"}</Text>
      ) : (
        <View style={styles.timeline}>
          {topEvents.map((event) => (
            <View key={event.id} style={[styles.eventRow, styles.eventRowAllDay]}>
              <Text style={styles.eventBadge}>{event.allDay ? "종일" : "진행중"}</Text>
              <Text style={styles.eventTitle} numberOfLines={1}>
                {event.summary}
              </Text>
            </View>
          ))}
          {timedEvents.map((event) => {
            const isNow = isEventNearNow(event);
            return (
              <View key={event.id} style={[styles.eventRow, isNow && styles.eventRowNow]}>
                <Text style={styles.eventTime}>
                  {event.start ? formatKstTime(event.start) : "--:--"}–{event.end ? formatKstTime(event.end) : "--:--"}
                </Text>
                <Text style={styles.eventTitle} numberOfLines={1}>
                  {event.summary}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      <SectionLabel>Today 할 일</SectionLabel>
      <QuickAddInput placeholder="할 일 추가하고 Enter" onSubmit={quickAdd} />
      {tasks.length === 0 ? (
        <Text style={styles.empty}>{loading ? "불러오는 중…" : "할 일 없음"}</Text>
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

const styles = StyleSheet.create({
  timeline: {
    borderRadius: space.radius,
    backgroundColor: colors.bgRaised,
    overflow: "hidden",
  },
  eventRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  eventRowNow: {
    backgroundColor: colors.accentSoft,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },
  eventRowAllDay: {
    backgroundColor: colors.bgRaised,
  },
  eventBadge: {
    color: colors.accent,
    fontFamily: "Pretendard",
    fontSize: type.meta,
    fontWeight: "700",
    width: 92,
  },
  eventTime: {
    color: colors.textDim,
    fontFamily: "Pretendard",
    fontSize: type.meta,
    width: 92,
  },
  eventTitle: {
    color: colors.text,
    fontFamily: "Pretendard",
    fontSize: type.body,
    flex: 1,
  },
  empty: {
    color: colors.textFaint,
    fontFamily: "Pretendard",
    fontSize: type.meta,
    paddingVertical: 8,
  },
});
