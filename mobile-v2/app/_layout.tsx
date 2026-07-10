import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import type { ReactNode } from "react";
import { useAppFonts } from "../src/theme/useAppFonts";
import { colors } from "../src/theme/tokens";
import { AuthProvider, useAuth } from "../src/auth/AuthContext";
import { SignInScreen } from "../src/auth/SignInScreen";

// DEV-only: when screenshot-QA'ing the 4 tabs against mock data (no OAuth
// client available yet), skip the auth gate entirely so the tabs render
// without a real session. This never touches the OAuth flow itself — it
// only decides what RootLayout renders — and only applies when the same
// EXPO_PUBLIC_MOCK_DATA=1 flag that gates google/index.ts's mock provider
// is set at build time.
const BYPASS_AUTH_FOR_MOCK = process.env.EXPO_PUBLIC_MOCK_DATA === "1";

/** Renders the sign-in screen instead of the tabs whenever there's no valid Google session. */
function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (BYPASS_AUTH_FOR_MOCK) {
    return <>{children}</>;
  }
  if (status === "loading") {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }
  if (status === "signedOut") {
    return <SignInScreen />;
  }
  return <>{children}</>;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useAppFonts();

  // Don't gate the whole app on the font: if Pretendard fails to load, fall
  // through to the system sans-serif rather than showing a blank screen.
  if (!fontsLoaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  return (
    <AuthProvider>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <StatusBar style="light" />
        <AuthGate>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
          </Stack>
        </AuthGate>
      </View>
    </AuthProvider>
  );
}
