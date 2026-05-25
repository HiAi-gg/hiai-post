export type AppMode = 'standalone' | 'unified';

export const config = {
  mode: (import.meta.env.PUBLIC_HIAI_MODE ?? 'standalone') as AppMode,
  apiBaseUrl: import.meta.env.PUBLIC_API_URL ?? 'http://localhost:50300',
};

export function isStandalone(): boolean {
  return config.mode === 'standalone';
}

export function isUnified(): boolean {
  return config.mode === 'unified';
}
