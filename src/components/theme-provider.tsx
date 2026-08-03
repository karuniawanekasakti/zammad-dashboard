import { createContext, useContext, useEffect, useState, type PropsWithChildren } from "react";

type Theme = "dark" | "light" | "system";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  resolvedTheme: "dark" | "light";
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "zm-theme",
}: PropsWithChildren<{ defaultTheme?: Theme; storageKey?: string }>) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  );
  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">("light");

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    let applied: "dark" | "light" = "light";
    if (theme === "system") {
      applied = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } else {
      applied = theme;
    }
    root.classList.add(applied);
    setResolvedTheme(applied);
  }, [theme]);

  const setTheme = (t: Theme) => {
    localStorage.setItem(storageKey, t);
    setThemeState(t);
  };

  return <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
