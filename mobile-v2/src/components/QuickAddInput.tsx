import { useState } from "react";
import { StyleSheet, TextInput } from "react-native";
import { colors, space, type } from "../theme/tokens";

type Props = {
  placeholder: string;
  onSubmit: (title: string) => void;
};

/** Enter-to-add text field — ported from the widget's `setupQuickAdd` (Enter submits + clears, Escape clears + blurs). */
export function QuickAddInput({ placeholder, onSubmit }: Props) {
  const [value, setValue] = useState("");

  return (
    <TextInput
      style={styles.input}
      value={value}
      onChangeText={setValue}
      placeholder={placeholder}
      placeholderTextColor={colors.textFaint}
      returnKeyType="done"
      onSubmitEditing={() => {
        const title = value.trim();
        if (!title) return;
        setValue("");
        onSubmit(title);
      }}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.bgRaised,
    borderRadius: space.radius,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontFamily: "Pretendard",
    fontSize: type.body,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: space.itemGap,
  },
});
