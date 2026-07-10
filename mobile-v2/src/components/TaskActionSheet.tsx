import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, space, type } from "../theme/tokens";

export type TaskAction = {
  key: string;
  label: string;
  onPress: () => void;
};

type Props = {
  visible: boolean;
  title?: string;
  actions: TaskAction[];
  onClose: () => void;
};

/** Bottom action sheet for a long-pressed task row — 진행/이동/편집 etc. No new deps: a plain RN Modal + Pressable backdrop. */
export function TaskActionSheet({ visible, title, actions, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          {title ? (
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          ) : null}
          {actions.map((action) => (
            <Pressable
              key={action.key}
              style={styles.actionRow}
              onPress={() => {
                onClose();
                action.onPress();
              }}
            >
              <Text style={styles.actionText}>{action.label}</Text>
            </Pressable>
          ))}
          <Pressable style={[styles.actionRow, styles.cancelRow]} onPress={onClose}>
            <Text style={styles.cancelText}>취소</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.bgRaised,
    borderTopLeftRadius: space.radius * 2,
    borderTopRightRadius: space.radius * 2,
    paddingHorizontal: space.padX,
    paddingTop: 12,
    paddingBottom: 28,
  },
  title: {
    color: colors.textDim,
    fontFamily: "Pretendard",
    fontSize: type.meta,
    textAlign: "center",
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    marginBottom: 4,
  },
  actionRow: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  actionText: {
    color: colors.text,
    fontFamily: "Pretendard",
    fontSize: type.body,
    textAlign: "center",
  },
  cancelRow: {
    borderBottomWidth: 0,
    marginTop: 4,
  },
  cancelText: {
    color: colors.textFaint,
    fontFamily: "Pretendard",
    fontSize: type.body,
    textAlign: "center",
    fontWeight: "600",
  },
});
