export const SLIDE_SIZES = [
  { id: "1:1", width: 1080, height: 1080, label: "1:1 Square" },
  { id: "4:5", width: 1080, height: 1350, label: "4:5 Portrait" },
  { id: "9:16", width: 1080, height: 1920, label: "9:16 Story" },
] as const;

export type SlideSizeId = (typeof SLIDE_SIZES)[number]["id"];

export const CANVAS_PRESETS = ["minimal", "bold", "gradient"] as const;
export type CanvasPreset = (typeof CANVAS_PRESETS)[number];

export function slideSizeById(id: string): (typeof SLIDE_SIZES)[number] {
  return SLIDE_SIZES.find((s) => s.id === id) ?? SLIDE_SIZES[1];
}

export function sizeIdFor(width: number, height: number): SlideSizeId {
  const match = SLIDE_SIZES.find((s) => s.width === width && s.height === height);
  return match?.id ?? "4:5";
}
