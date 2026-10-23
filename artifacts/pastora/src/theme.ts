export type ThemeName = "warm-cream" | "modern-cool";

const STORAGE_KEY = "pastora-theme";

export function storedTheme(): ThemeName {
  try {
    return localStorage.getItem(STORAGE_KEY) === "modern-cool" ? "modern-cool" : "warm-cream";
  } catch {
    return "warm-cream";
  }
}

/** Applies a theme to the page and remembers it on this device. */
export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (private mode); the theme still applies for this visit.
  }
}
