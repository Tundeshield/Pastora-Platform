import type { FontFamily, FontSize, Palette } from "@workspace/api-client-react";

export type ThemeName = Palette;

export type Appearance = { theme: Palette; fontFamily: FontFamily; fontSize: FontSize };

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "warm-cream",
  fontFamily: "inter",
  fontSize: "normal",
};

const STORAGE_KEY = "pastora-appearance";
const LEGACY_THEME_KEY = "pastora-theme";

const PALETTES: Palette[] = ["warm-cream", "modern-cool", "sage", "heritage-blue", "forest-dark"];
const FONTS: FontFamily[] = ["inter", "manrope", "roboto", "lora"];
const SIZES: FontSize[] = ["small", "normal", "large"];

function valid(value: Partial<Appearance> | null | undefined): Appearance {
  return {
    theme: PALETTES.includes(value?.theme as Palette) ? (value!.theme as Palette) : DEFAULT_APPEARANCE.theme,
    fontFamily: FONTS.includes(value?.fontFamily as FontFamily)
      ? (value!.fontFamily as FontFamily)
      : DEFAULT_APPEARANCE.fontFamily,
    fontSize: SIZES.includes(value?.fontSize as FontSize)
      ? (value!.fontSize as FontSize)
      : DEFAULT_APPEARANCE.fontSize,
  };
}

/**
 * The last appearance seen on this device, used only to avoid a flash before the
 * workspace settings load. The workspace setting on the server is the source of truth.
 */
export function storedAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return valid(JSON.parse(raw) as Partial<Appearance>);
    const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY);
    return valid({ theme: legacyTheme as Palette });
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/** Applies the palette, font and text size to the whole page and remembers them here. */
export function applyAppearance(next: Partial<Appearance>): Appearance {
  const appearance = valid({ ...storedAppearance(), ...next });
  const root = document.documentElement;
  root.dataset.theme = appearance.theme;
  root.dataset.font = appearance.fontFamily;
  root.dataset.textSize = appearance.fontSize;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    // Storage can be unavailable (private mode); the appearance still applies for this visit.
  }
  return appearance;
}

/** Kept for existing callers that only change the palette. */
export function applyTheme(theme: Palette): void {
  applyAppearance({ theme });
}

export function storedTheme(): Palette {
  return storedAppearance().theme;
}
