import type { ThemePreference } from "../storage/state";

/** Applies the theme preference by toggling [data-theme] on <html>. */
export function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") {
    root.dataset.theme = theme;
  } else {
    delete root.dataset.theme;
  }
}
