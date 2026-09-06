import type { ReactNode } from "react";
import { useTheme } from "../../hooks/use-theme.ts";
import type { ThemePreference } from "../../lib/theme.ts";
import { BlackIcon, MonitorIcon, MoonIcon, SunIcon } from "../ui/icons.tsx";
import { Switch } from "../ui/Switch.tsx";

const THEME_ITEMS: {
  value: ThemePreference;
  ariaLabel: string;
  label: ReactNode;
}[] = [
  { ariaLabel: "ライト", label: <SunIcon />, value: "light" },
  { ariaLabel: "ダーク", label: <MoonIcon />, value: "dark" },
  { ariaLabel: "ブラック", label: <BlackIcon />, value: "black" },
  { ariaLabel: "システム", label: <MonitorIcon />, value: "system" },
];

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();

  return (
    <Switch
      items={THEME_ITEMS.map((item) => ({
        ariaLabel: item.ariaLabel,
        label: item.label,
        onClick: () => setTheme(item.value),
        pressed: theme === item.value,
        value: item.value,
      }))}
      label="テーマ"
      size="sm"
    />
  );
}
