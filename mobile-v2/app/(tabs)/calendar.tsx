import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Screen } from "../../src/components/Screen";
import { SectionLabel } from "../../src/components/SectionLabel";
import { colors, space, type } from "../../src/theme/tokens";
import { useFetched } from "../../src/hooks/useFetched";
import { getMonthEvents } from "../../src/google";
import { kstDayBoundsIso, type CalendarEvent } from "../../src/google/calendar";

/**
 * 달력 탭 — month grid, same concept as widget round 3: 7 columns, today
 * amber, 2 chips + "+N" per day, tap a date to see its full list below,
 * prev/next/today nav. Replaces the old '마감' list tab (2026-07-10 model
 * change): deadlines now live as Google Calendar all-day events, not a
 * separate task section.
 */

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
const MAX_CHIPS_PER_DAY = 2;

function ymOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function addMonths(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(yearMonth: string): number {
  const [y, m] = yearMonth.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function firstWeekday(yearMonth: string): number {
  const [y, m] = yearMonth.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
}

function eventDateKey(event: CalendarEvent): string | null {
  return event.start ? event.start.slice(0, 10) : null;
}

export default function CalendarScreen() {
  const { dateStr: todayStr } = kstDayBoundsIso();
  const [yearMonth, setYearMonth] = useState(ymOf(todayStr));
  const [selectedDate, setSelectedDate] = useState(todayStr);

  const { data, stale, loading, refreshing, error, refresh } = useFetched<CalendarEvent[]>(
    () => getMonthEvents(yearMonth),
    [yearMonth],
  );
  const events = data ?? [];

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const key = eventDateKey(event);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return map;
  }, [events]);

  const cells = useMemo(() => {
    const total = daysInMonth(yearMonth);
    const offset = firstWeekday(yearMonth);
    const result: Array<{ dateStr: string | null; day: number | null }> = [];
    for (let i = 0; i < offset; i++) result.push({ dateStr: null, day: null });
    for (let day = 1; day <= total; day++) {
      result.push({ dateStr: `${yearMonth}-${String(day).padStart(2, "0")}`, day });
    }
    while (result.length % 7 !== 0) result.push({ dateStr: null, day: null });
    return result;
  }, [yearMonth]);

  const selectedEvents = eventsByDate.get(selectedDate) ?? [];

  return (
    <Screen
      title="달력"
      subtitle={`${yearMonth.slice(0, 4)}년 ${yearMonth.slice(5, 7)}월`}
      stale={stale}
      refreshing={refreshing}
      onRefresh={refresh}
    >
      <View style={styles.nav}>
        <Pressable onPress={() => setYearMonth((ym) => addMonths(ym, -1))} hitSlop={8}>
          <Text style={styles.navButton}>‹ 이전</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setYearMonth(ymOf(todayStr));
            setSelectedDate(todayStr);
          }}
          hitSlop={8}
        >
          <Text style={[styles.navButton, styles.navButtonToday]}>오늘</Text>
        </Pressable>
        <Pressable onPress={() => setYearMonth((ym) => addMonths(ym, 1))} hitSlop={8}>
          <Text style={styles.navButton}>다음 ›</Text>
        </Pressable>
      </View>

      <View style={styles.weekdayRow}>
        {WEEKDAY_LABELS.map((label) => (
          <Text key={label} style={styles.weekdayLabel}>
            {label}
          </Text>
        ))}
      </View>

      {error && !data ? (
        <Text style={styles.errorText}>오류: {error}</Text>
      ) : (
        <View style={styles.grid}>
          {cells.map((cell, index) => {
            if (!cell.dateStr) {
              return <View key={`empty-${index}`} style={styles.cell} />;
            }
            const dayEvents = eventsByDate.get(cell.dateStr) ?? [];
            const isToday = cell.dateStr === todayStr;
            const isSelected = cell.dateStr === selectedDate;
            return (
              <Pressable
                key={cell.dateStr}
                style={[styles.cell, isSelected && styles.cellSelected]}
                onPress={() => setSelectedDate(cell.dateStr as string)}
              >
                <View style={[styles.dayNumberWrap, isToday && styles.dayNumberWrapToday]}>
                  <Text style={[styles.dayNumber, isToday && styles.dayNumberToday]}>{cell.day}</Text>
                </View>
                {dayEvents.slice(0, MAX_CHIPS_PER_DAY).map((event) => (
                  <Text key={event.id} style={styles.chip} numberOfLines={1}>
                    {event.summary}
                  </Text>
                ))}
                {dayEvents.length > MAX_CHIPS_PER_DAY ? (
                  <Text style={styles.moreLabel}>+{dayEvents.length - MAX_CHIPS_PER_DAY}</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}

      <SectionLabel>{`${selectedDate} 일정`}</SectionLabel>
      {selectedEvents.length === 0 ? (
        <Text style={styles.emptyText}>{loading ? "불러오는 중…" : "일정 없음"}</Text>
      ) : (
        selectedEvents.map((event) => (
          <View key={event.id} style={styles.detailRow}>
            <Text style={styles.detailBadge}>{event.allDay ? "종일" : "시간"}</Text>
            <Text style={styles.detailTitle} numberOfLines={2}>
              {event.summary}
            </Text>
          </View>
        ))
      )}
    </Screen>
  );
}

const CELL_WIDTH = "14.28%";

const styles = StyleSheet.create({
  nav: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: space.itemGap,
  },
  navButton: {
    color: colors.text,
    fontFamily: "Pretendard",
    fontSize: type.body,
  },
  navButtonToday: {
    color: colors.accent,
    fontWeight: "700",
  },
  weekdayRow: {
    flexDirection: "row",
  },
  weekdayLabel: {
    width: CELL_WIDTH,
    textAlign: "center",
    color: colors.textFaint,
    fontFamily: "Pretendard",
    fontSize: type.meta,
    paddingBottom: 4,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: CELL_WIDTH,
    minHeight: 64,
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cellSelected: {
    backgroundColor: colors.accentSoft,
  },
  dayNumberWrap: {
    alignSelf: "flex-start",
    borderRadius: 999,
    minWidth: 20,
    alignItems: "center",
  },
  dayNumberWrapToday: {
    backgroundColor: colors.accent,
  },
  dayNumber: {
    color: colors.text,
    fontFamily: "Pretendard",
    fontSize: type.meta,
    paddingHorizontal: 4,
  },
  dayNumberToday: {
    color: colors.bg,
    fontWeight: "700",
  },
  chip: {
    color: colors.textDim,
    fontFamily: "Pretendard",
    fontSize: 9,
    backgroundColor: colors.bgRaised,
    borderRadius: 3,
    paddingHorizontal: 2,
    marginTop: 2,
  },
  moreLabel: {
    color: colors.accent,
    fontFamily: "Pretendard",
    fontSize: 9,
    marginTop: 1,
  },
  errorText: {
    color: colors.danger,
    fontFamily: "Pretendard",
    fontSize: type.meta,
  },
  emptyText: {
    color: colors.textFaint,
    fontFamily: "Pretendard",
    fontSize: type.meta,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: space.minRowHeight,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  detailBadge: {
    color: colors.accent,
    fontFamily: "Pretendard",
    fontSize: type.meta,
    fontWeight: "700",
    width: 48,
  },
  detailTitle: {
    color: colors.text,
    fontFamily: "Pretendard",
    fontSize: type.body,
    flex: 1,
  },
});
