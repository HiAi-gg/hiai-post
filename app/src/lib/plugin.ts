export const hiaiPostPlugin = {
  id: 'hiai-post',
  name: 'Social Media',
  version: '1.0.0',
  icon: '📱',
  description: 'Social media content planning and publishing with AI',
  navGroups: [{
    label: 'Social Media',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: '📊' },
      { label: 'Accounts', href: '/accounts', icon: '👤' },
      { label: 'Posts', href: '/posts', icon: '📝' },
      { label: 'Campaigns', href: '/campaigns', icon: '📢' },
      { label: 'Content Plans', href: '/content-plans', icon: '📋' },
      { label: 'Templates', href: '/templates', icon: '📄' },
      { label: 'Analytics', href: '/analytics', icon: '📈' },
    ],
  }],
  proxy: { prefix: '/api/social', target: 'http://localhost:50300' },
};
