import { useFonts } from "expo-font";

/**
 * Loads the bundled Pretendard variable TTF.
 * If this ever fails to resolve on a target platform, fall back to the system
 * sans-serif by not gating render on `fontsLoaded` (see app/_layout.tsx).
 */
export function useAppFonts() {
  return useFonts({
    Pretendard: require("../../assets/fonts/PretendardVariable.ttf"),
  });
}
