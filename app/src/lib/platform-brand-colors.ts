/**
 * Centralized platform brand colors.
 *
 * These colors represent the visual identity of each social platform
 * (Instagram pink, X blue, etc.) and are NOT design tokens. They must
 * not be replaced with `@hiai/ui` tokens because they are platform
 * brand standards, not theme variables.
 *
 * Some platforms have multiple variants (e.g. `x` and `x-post`, or
 * `youtube-shorts` / `youtube-long`) — all variants are listed here.
 */
export const platformBrandColors = {
  instagram: "#E1306C",
  tiktok: "#000000",
  x: "#1DA1F2",
  "x-post": "#1DA1F2",
  threads: "#000000",
  linkedin: "#0A66C2",
  facebook: "#1877F2",
  telegram: "#0088CC",
  pinterest: "#BD081C",
  "youtube-shorts": "#FF0000",
  "youtube-long": "#FF0000",
} as const satisfies Record<string, string>;

/**
 * Alternate brand palettes used by some surfaces (e.g. PlatformCard uses
 * the official corporate "logo" colors which differ slightly from the
 * accent colors used in marketing/UI). The keys mirror the platform id
 * in `platformBrandColors` so consumers can always look up by id.
 */
export const platformLogoColors = {
  instagram: "#E4405F",
  tiktok: "#000000",
  x: "#1DA1F2",
  threads: "#000000",
  linkedin: "#0A66C2",
  facebook: "#1877F2",
  telegram: "#26A5E4",
  pinterest: "#E60023",
  "youtube-shorts": "#FF0000",
  "youtube-long": "#FF0000",
} as const satisfies Record<string, string>;

export type PlatformId = keyof typeof platformBrandColors;

/** Fallback color for unknown platforms. */
export const platformFallbackColor = "#888888";

/** Lookup helper — returns a brand color for any platform id. */
export function getPlatformColor(platform: string, palette: "brand" | "logo" = "brand"): string {
  const map = palette === "logo" ? platformLogoColors : platformBrandColors;
  return (map as Record<string, string>)[platform] ?? platformFallbackColor;
}
