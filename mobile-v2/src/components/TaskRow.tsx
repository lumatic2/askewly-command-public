import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, space, type } from "../theme/tokens";

type Props = {
  title: string;
  done?: boolean;
  /** 'doing' status — amber left border + "진행중" badge. */
  doing?: boolean;
  projectLabel?: string;
  /** Dims the row while an optimistic write is in flight (temp id not yet replaced by the server row). */
  pending?: boolean;
  /** Checkbox tap — toggles done/todo. */
  onToggleDone?: () => void;
  /** Long-press anywhere else on the row — opens the action sheet (진행/이동/편집). */
  onLongPress?: () => void;
  /** When set, the title renders as an inline-editable TextInput instead of Text. */
  editing?: boolean;
  onSubmitEdit?: (nextTitle: string) => void;
  onCancelEdit?: () => void;
};

export function TaskRow({
  title,
  done = false,
  doing = false,
  projectLabel,
  pending = false,
  onToggleDone,
  onLongPress,
  editing = false,
  onSubmitEdit,
  onCancelEdit,
}: Props) {
  const [editValue, setEditValue] = useState(title);

  useEffect(() => {
    if (editing) setEditValue(title);
  }, [editing, title]);

  return (
    <Pressable
      style={[styles.row, doing && styles.rowDoing, pending && styles.rowPending]}
      onLongPress={editing ? undefined : onLongPress}
      delayLongPress={450}
    >
      <Pressable
        style={[styles.checkbox, done && styles.checkboxDone]}
        onPress={onToggleDone}
        hitSlop={8}
        disabled={pending}
      >
        {done ? <Text style={styles.check}>✓</Text> : null}
      </Pressable>
      <View style={styles.textCol}>
        <View style={styles.titleRow}>
          {editing ? (
            <TextInput
              style={styles.titleInput}
              value={editValue}
              onChangeText={setEditValue}
              autoFocus
              selectTextOnFocus
              onSubmitEditing={() => onSubmitEdit?.(editValue)}
              onBlur={() => onSubmitEdit?.(editValue)}
              returnKeyType="done"
            />
          ) : (
            <Text style={[styles.title, done && styles.titleDone]} numberOfLines={2}>
              {title}
            </Text>
          )}
          {doing && !editing ? (
            <View style={styles.doingBadge}>
              <Text style={styles.doingBadgeText}>진행중</Text>
            </View>
          ) : null}
        </View>
        {projectLabel && !editing ? <Text style={styles.project}>{projectLabel}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: space.minRowHeight,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowDoing: {
    backgroundColor: colors.accentSoft,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    borderRadius: 6,
  },
  rowPending: {
    opacity: 0.5,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.textFaint,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  checkboxDone: {
    backgroundColor: colors.ok,
    borderColor: colors.ok,
  },
  check: {
    color: colors.bg,
    fontSize: 13,
    fontWeight: "700",
  },
  textCol: {
    flex: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    color: colors.text,
    fontFamily: "Pretendard",
    fontSize: type.body,
    flexShrink: 1,
  },
  titleDone: {
    color: colors.textFaint,
    textDecorationLine: "line-through",
  },
  titleInput: {
    color: colors.text,
    fontFamily: "Pretendard",
    fontSize: type.body,
    flex: 1,
    paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
  },
  project: {
    color: colors.textDim,
    fontFamily: "Pretendard",
    fontSize: type.meta,
    marginTop: 2,
  },
  doingBadge: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 1,
    paddingHorizontal: 6,
  },
  doingBadgeText: {
    color: colors.bg,
    fontFamily: "Pretendard",
    fontSize: 10,
    fontWeight: "700",
  },
});
