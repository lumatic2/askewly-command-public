import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Screen } from "../../src/components/Screen";
import { SectionLabel } from "../../src/components/SectionLabel";
import { colors, space, type } from "../../src/theme/tokens";
import { useAuth } from "../../src/auth/AuthContext";
import { useFetched } from "../../src/hooks/useFetched";
import { getProjects, type CatalogProject } from "../../src/google";
import { isPinned } from "../../src/google/sheets";

export default function ProjectsScreen() {
  const { signOut } = useAuth();
  const { data, stale, loading, refreshing, error, refresh } = useFetched<CatalogProject[]>(getProjects, []);
  const projects = data ?? [];
  const pinned = projects.filter(isPinned);

  return (
    <Screen
      title="프로젝트"
      subtitle={loading && !data ? "불러오는 중…" : `${projects.length}개`}
      stale={stale}
      refreshing={refreshing}
      onRefresh={refresh}
    >
      {error && !data ? (
        <Text style={styles.errorText}>오류: {error}</Text>
      ) : (
        <>
          {pinned.length > 0 && (
            <>
              <SectionLabel>고정</SectionLabel>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.chipRow}>
                  {pinned.map((project) => (
                    <View key={project.supabase_id} style={styles.chip}>
                      <Text style={styles.chipText} numberOfLines={1}>
                        {project.name}
                      </Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </>
          )}

          <SectionLabel>전체</SectionLabel>
          {projects.length === 0 ? (
            <Text style={styles.emptyText}>{loading ? "불러오는 중…" : "프로젝트 없음"}</Text>
          ) : (
            projects.map((project) => (
              <View key={project.supabase_id} style={styles.row}>
                <Text style={styles.name} numberOfLines={1}>
                  {project.name}
                </Text>
                {project.status && project.status !== "active" ? (
                  <Text style={styles.status}>{project.status}</Text>
                ) : null}
              </View>
            ))
          )}
        </>
      )}

      <View style={styles.footer}>
        <Text style={styles.footerStatus}>Google 계정 연결됨</Text>
        <Pressable onPress={signOut} hitSlop={8}>
          <Text style={styles.footerAction}>로그아웃</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chipRow: {
    flexDirection: "row",
    gap: space.itemGap,
    paddingBottom: 4,
  },
  chip: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  chipText: {
    color: colors.accent,
    fontFamily: "Pretendard",
    fontSize: type.meta,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: space.minRowHeight,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  name: {
    color: colors.text,
    fontFamily: "Pretendard",
    fontSize: type.body,
    flex: 1,
  },
  status: {
    color: colors.textDim,
    fontFamily: "Pretendard",
    fontSize: type.meta,
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
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.sectionGap,
    paddingTop: space.itemGap,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  footerStatus: {
    color: colors.textFaint,
    fontFamily: "Pretendard",
    fontSize: type.meta,
  },
  footerAction: {
    color: colors.danger,
    fontFamily: "Pretendard",
    fontSize: type.meta,
    fontWeight: "600",
  },
});
