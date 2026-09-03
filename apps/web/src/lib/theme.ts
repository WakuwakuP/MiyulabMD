export const THEME_PREFERENCES = ["light", "dark", "black", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

const STORAGE_KEY = "miyulabmd:theme";

export function isThemePreference(value: string): value is ThemePreference {
  return (THEME_PREFERENCES as readonly string[]).includes(value);
}

export function colorSchemeFor(theme: ThemePreference): string {
  if (theme === "light") return "light";
  if (theme === "dark" || theme === "black") return "dark";
  return "light dark";
}

export function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  root.style.colorScheme = colorSchemeFor(theme);
  if (theme === "black") {
    root.dataset.theme = "black";
    return;
  }
  delete root.dataset.theme;
}

export function readTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) ?? "";
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function writeTheme(theme: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function setThemeWithTransition(theme: ThemePreference): void {
  writeTheme(theme);
  const apply = () => applyTheme(theme);
  if (
    !prefersReducedMotion() &&
    typeof document.startViewTransition === "function"
  ) {
    document.startViewTransition(apply);
    return;
  }
  apply();
}
