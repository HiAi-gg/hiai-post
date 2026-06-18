/**
 * hiai-post plugin manifest.
 *
 * Conforms to HIAI_CONVENTIONS.md §6 (HiAiPlugin contract). The manifest
 * is consumed by:
 *   - This standalone app (sidebar reads `navGroups`).
 *   - The host shell (hiai-admin) in unified mode, which reads `proxy` and
 *     configures its reverse proxy. Cookie / header forwarding happens in
 *     the host (see hiai-admin `backend/src/api/routes/proxy-post.ts`);
 *     the manifest itself has no proxy implementation.
 *
 * Env convention: `import.meta.env.PUBLIC_API_URL` follows the SvelteKit
 * `$env/static/public` pattern and is exposed to the browser. It mirrors
 * the backend's `API_PORT=50300` default.
 */

export interface NavItem {
  label: string;
  href: string;
  icon?: string;
  badge?: string | number;
  disabled?: boolean;
  external?: boolean;
}

export interface NavGroup {
  label?: string;
  icon?: string;
  items: NavItem[];
}

export interface PluginPage {
  path: string;
  // Svelte component type is part of the contract; intentionally `unknown`
  // here so this manifest module stays framework-agnostic. The host shell
  // narrows the type when registering pages.
  component: unknown;
  title?: string;
}

export interface PluginSettings {
  component: unknown;
}

export interface ProxyConfig {
  prefix: string;
  target: string;
  auth?: 'jwt' | 'api-key';
  rateLimit?: { requests: number; window: number };
}

export interface HiAiPlugin {
  id: string;
  name: string;
  version: string;
  icon?: string;
  description: string;
  navGroups: NavGroup[];
  proxy: ProxyConfig;
  pages?: PluginPage[];
  settings?: PluginSettings;
}

const API_TARGET = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:50300';

export const hiaiPostPlugin = {
  id: 'hiai-post',
  name: 'Social Media',
  version: '1.0.0',
  icon: 'Smartphone',
  description: 'Social media content planning and publishing with AI',
  navGroups: [{
    label: 'Social Media',
    icon: 'Smartphone',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: 'BarChart3' },
      { label: 'Accounts', href: '/accounts', icon: 'User' },
      { label: 'Posts', href: '/posts', icon: 'FileText' },
      { label: 'Campaigns', href: '/campaigns', icon: 'Megaphone' },
      { label: 'Content Plans', href: '/content-plans', icon: 'ClipboardList' },
      { label: 'Templates', href: '/templates', icon: 'File' },
      { label: 'Analytics', href: '/analytics', icon: 'TrendingUp' },
    ],
  }],
  proxy: {
    prefix: '/api/social',
    target: API_TARGET,
    auth: 'jwt' as const,
  },
} as const satisfies HiAiPlugin;
