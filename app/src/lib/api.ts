import { createApi } from '@hiai/ui';
import { config } from './config';

export const api = createApi(config.apiBaseUrl);
