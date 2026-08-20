export type AppMode = "standalone" | "unified";

export const config = {
  mode: (import.meta.env.PUBLIC_HIAI_MODE ?? "standalone") as AppMode,
  apiBaseUrl: import.meta.env.PUBLIC_API_URL ?? "http://localhost:50300",
  // hiai-kit backend hosting the shared feature APIs (/api/v1/carousel,
  // /api/v1/scriptforge). Override via PUBLIC_HIAI_KIT_URL.
  hiaiKitApiUrl: import.meta.env.PUBLIC_HIAI_KIT_URL ?? "http://localhost:3000",
};

export function isStandalone(): boolean {
  return config.mode === "standalone";
}

export function isUnified(): boolean {
  return config.mode === "unified";
}
