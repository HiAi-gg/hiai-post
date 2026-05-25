export const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'hiai-post API',
    version: '1.0.0',
    description: 'Social media content planning and publishing platform API',
  },
  servers: [{ url: 'http://localhost:50300', description: 'Development' }],
  paths: {
    '/api/v1/health': {
      get: { summary: 'Health check', tags: ['System'], responses: { '200': { description: 'OK' } } }
    },
    '/api/v1/accounts': {
      get: { summary: 'List connected social accounts', tags: ['Accounts'], parameters: [{ name: 'tenantId', in: 'query' }], responses: { '200': { description: 'Account list' } } },
      post: { summary: 'Connect social account', tags: ['Accounts'], requestBody: { content: { 'application/json': { schema: { properties: { platform: { type: 'string' }, accessToken: { type: 'string' }, refreshToken: { type: 'string' } } } } } } }
    },
    '/api/v1/accounts/{id}': {
      delete: { summary: 'Disconnect account', tags: ['Accounts'], parameters: [{ name: 'id', in: 'path', required: true }] }
    },
    '/api/v1/posts': {
      get: { summary: 'List posts', tags: ['Posts'], parameters: [{ name: 'status', in: 'query' }, { name: 'platform', in: 'query' }, { name: 'from', in: 'query' }, { name: 'to', in: 'query' }] },
      post: { summary: 'Create post', tags: ['Posts'], requestBody: { content: { 'application/json': { schema: { properties: { contentText: { type: 'string' }, platform: { type: 'string' }, mediaUrls: { type: 'array', items: { type: 'string' } }, scheduledAt: { type: 'string', format: 'date-time' } } } } } } }
    },
    '/api/v1/posts/{id}': {
      get: { summary: 'Get post', tags: ['Posts'] },
      put: { summary: 'Update post', tags: ['Posts'] },
      delete: { summary: 'Delete post', tags: ['Posts'] }
    },
    '/api/v1/posts/{id}/publish': {
      post: { summary: 'Publish post now', tags: ['Posts'] }
    },
    '/api/v1/posts/{id}/schedule': {
      post: { summary: 'Schedule post', tags: ['Posts'], requestBody: { content: { 'application/json': { schema: { properties: { scheduledAt: { type: 'string', format: 'date-time' } } } } } } }
    },
    '/api/v1/posts/generate': {
      post: { summary: 'Generate content via AI', tags: ['AI'], requestBody: { content: { 'application/json': { schema: { properties: { topic: { type: 'string' }, platforms: { type: 'array', items: { type: 'string' } }, tone: { type: 'string' } } } } } } }
    },
    '/api/v1/content-plans': {
      get: { summary: 'List content plans', tags: ['Content Plans'] },
      post: { summary: 'Create content plan', tags: ['Content Plans'] }
    },
    '/api/v1/campaigns': {
      get: { summary: 'List campaigns', tags: ['Campaigns'] },
      post: { summary: 'Create campaign', tags: ['Campaigns'] }
    },
    '/api/v1/templates': {
      get: { summary: 'List templates', tags: ['Templates'] },
      post: { summary: 'Create template', tags: ['Templates'] }
    },
    '/api/v1/templates/{id}/generate': {
      post: { summary: 'Generate post from template', tags: ['Templates'] }
    },
    '/api/v1/analytics/overview': {
      get: { summary: 'Analytics overview', tags: ['Analytics'] }
    },
    '/api/v1/analytics/posts/{id}': {
      get: { summary: 'Post engagement metrics', tags: ['Analytics'] }
    },
    '/api/v1/analytics/best-times': {
      get: { summary: 'Best posting times', tags: ['Analytics'] }
    },
    '/api/v1/queue/status': {
      get: { summary: 'Queue status', tags: ['Queue'] }
    },
    '/api/v1/queue/dead-letter': {
      get: { summary: 'Dead letter queue', tags: ['Queue'] }
    },
    '/api/v1/oauth/{platform}/connect': {
      post: { summary: 'Start OAuth flow', tags: ['OAuth'], parameters: [{ name: 'platform', in: 'path', required: true }] }
    },
    '/api/v1/oauth/{platform}/callback': {
      get: { summary: 'OAuth callback', tags: ['OAuth'] }
    },
    '/api/v1/events': {
      get: { summary: 'SSE real-time events', tags: ['Events'], responses: { '200': { description: 'Server-Sent Events stream' } } }
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' }
    }
  }
};
