import { PropsWithChildren, ReactNode } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, space, type } from "../theme/tokens";

type Props = PropsWithChildren<{
  title: string;
  subtitle?: string;
  /** Shows a small amber "오프라인 캐시" badge next to the header — used when a fetch failed and cached data is shown instead. */
  stale?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Rendered as a sibling of the ScrollView (not inside its scrollable content) — e.g. a bottom Toast that must stay fixed to the viewport instead of scrolling with the list. */
  overlay?: ReactNode;
}>;

/** Shared screen chrome: dark bg, header, scrollable + pull-to-refresh body. */
export function Screen({ title, subtitle, stale, refreshing, onRefresh, overlay, children }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          {stale ? (
            <View style={styles.staleBadge}>
              <Text style={styles.staleBadgeText}>오프라인 캐시</Text>
            </View>
          ) : null}
        </View>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={!!refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
              colors={[colors.accent]}
            />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
      {overlay}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: space.padX,
    paddingTop: 12,
    paddingBottom: 8,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: {
    color: colors.text,
    fontFamily: "Pretendard",
    fontSize: type.title,
    fontWeight: "600",
  },
  staleBadge: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  staleBadgeText: {
    color: colors.accent,
    fontFamily: "Pretendard",
    fontSize: 10,
    fontWeight: "600",
  },
  subtitle: {
    color: colors.textDim,
    fontFamily: "Pretendard",
    fontSize: type.meta,
    marginTop: 2,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: space.padX,
    paddingBottom: 32,
  },
});
