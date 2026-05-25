import { createApi } from '@hiai/ui';

const API_BASE = typeof window !== 'undefined' ? '' : (process.env.API_URL || 'http://localhost:50300');
export const api = createApi(API_BASE);
