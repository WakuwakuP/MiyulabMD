import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  readTheme,
  setThemeWithTransition,
  type ThemePreference,
} from "../lib/theme.ts";

type ThemeContextValue = {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(readTheme);

  const value = useMemo(
    () => ({
      theme,
      setTheme: (next: ThemePreference) => {
        setThemeState(next);
        setThemeWithTransition(next);
      },
    }),
    [theme],
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme requires ThemeProvider");
  }
  return context;
}
