import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, space, type } from "../theme/tokens";
import { useAuth } from "./AuthContext";

/** Minimal dark sign-in gate shown whenever there's no valid Google session. */
export function SignInScreen() {
  const { signIn, isRequestReady } = useAuth();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>커맨드</Text>
        <Text style={styles.subtitle}>{"Google 계정으로 로그인하고\n오늘 할 일을 이어서 관리하세요"}</Text>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            !isRequestReady && styles.buttonDisabled,
          ]}
          onPress={signIn}
          disabled={!isRequestReady}
        >
          {isRequestReady ? (
            <Text style={styles.buttonLabel}>Google로 로그인</Text>
          ) : (
            <ActivityIndicator color={colors.bg} />
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.padX,
  },
  title: {
    color: colors.text,
    fontFamily: "Pretendard",
    fontSize: type.title,
    fontWeight: "600",
    marginBottom: space.itemGap,
  },
  subtitle: {
    color: colors.textDim,
    fontFamily: "Pretendard",
    fontSize: type.body,
    textAlign: "center",
    lineHeight: type.body * type.lineHeight,
    marginBottom: space.sectionGap,
  },
  button: {
    minHeight: space.minRowHeight,
    minWidth: 200,
    borderRadius: space.radius,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLabel: {
    color: colors.bg,
    fontFamily: "Pretendard",
    fontSize: type.body,
    fontWeight: "600",
  },
});
