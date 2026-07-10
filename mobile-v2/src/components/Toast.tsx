import { StyleSheet, Text, View } from "react-native";
import { colors, space, type } from "../theme/tokens";
import type { ToastState } from "../hooks/useToast";

/** Floating banner, positioned by the screen (absolute, bottom). Renders nothing while `message` is null. */
export function Toast({ message, isError }: ToastState) {
  if (!message) return null;
  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={[styles.bubble, isError && styles.bubbleError]}>
        <Text style={styles.text} numberOfLines={2}>
          {message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: space.padX,
    right: space.padX,
    bottom: 24,
    alignItems: "center",
  },
  bubble: {
    backgroundColor: colors.bgRaised,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: space.radius,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  bubbleError: {
    borderColor: colors.danger,
  },
  text: {
    color: colors.text,
    fontFamily: "Pretendard",
    fontSize: type.meta,
    textAlign: "center",
  },
});
