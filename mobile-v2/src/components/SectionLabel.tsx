import { StyleSheet, Text } from "react-native";
import { colors, space, type } from "../theme/tokens";

export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.label}>{children}</Text>;
}

const styles = StyleSheet.create({
  label: {
    color: colors.textDim,
    fontFamily: "Pretendard",
    fontSize: type.section,
    fontWeight: "600",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: space.sectionGap,
    marginBottom: space.itemGap,
  },
});
