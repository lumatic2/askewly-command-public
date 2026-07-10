import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ColorValue, StyleSheet } from "react-native";
import { colors } from "../../src/theme/tokens";

type IconName = React.ComponentProps<typeof Feather>["name"];

function tabIcon(name: IconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Feather name={name} color={color as string} size={size} />
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.bgRaised,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          height: 58,
          paddingBottom: 6,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontFamily: "Pretendard",
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "오늘", tabBarIcon: tabIcon("sun") }}
      />
      <Tabs.Screen
        name="calendar"
        options={{ title: "달력", tabBarIcon: tabIcon("calendar") }}
      />
      <Tabs.Screen
        name="backlog"
        options={{ title: "백로그", tabBarIcon: tabIcon("list") }}
      />
      <Tabs.Screen
        name="projects"
        options={{ title: "프로젝트", tabBarIcon: tabIcon("folder") }}
      />
    </Tabs>
  );
}
