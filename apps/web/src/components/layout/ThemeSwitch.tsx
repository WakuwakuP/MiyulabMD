import type { ReactNode } from "react";
import { useTheme } from "../../hooks/use-theme.ts";
import type { ThemePreference } from "../../lib/theme.ts";
import { MonitorIcon, MoonIcon, SunIcon } from "../ui/icons.tsx";
import { Switch } from "../ui/Switch.tsx";

const THEME_ITEMS: {
  value: ThemePreference;
  ariaLabel: string;
  label: ReactNode;
}[] = [
  { value: "light", ariaLabel: "ライト", label: <SunIcon /> },
  { value: "dark", ariaLabel: "ダーク", label: <MoonIcon /> },
  { value: "system", ariaLabel: "システム", label: <MonitorIcon /> },
];

export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();

  return (
    <Switch
      label="テーマ"
      size="sm"
      items={THEME_ITEMS.map((item) => ({
        value: item.value,
        label: item.label,
        ariaLabel: item.ariaLabel,
        pressed: theme === item.value,
        onClick: () => setTheme(item.value),
      }))}
    />
  );
}
