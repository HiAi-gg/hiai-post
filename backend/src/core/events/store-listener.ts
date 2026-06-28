/**
 * hiai-store → hiai-post event listener (scaffold).
 *
 * Subscribes to the shared `hiai-store:events` Redis pub/sub channel and
 * logs every product lifecycle event emitted by the store service. This
 * file is SCAFFOLD ONLY: it establishes the connection, validates the
 * payload shape, and prints received events. It does NOT auto-start,
 * does NOT mutate any state, and is not wired into `api/index.ts`.
 *
 * To activate later: import `startStoreListener()` from the app boot
 * sequence (e.g. after `connectRedis()`) and call `stopStoreListener()`
 * on shutdown.
 *
 * Protocol (must match hiai-store publisher):
 *   - Channel:    `hiai-store:events`
 *   - Payload:    JSON `{ event, tenantId, productId, productName, productUrl, productImage }`
 *                 where `event` ∈ { "product.created", "product.updated" }
 *
 * Implementation notes:
 *   - A dedicated ioredis subscriber connection is required — once a client
 *     enters subscribe mode it cannot run normal commands, so the shared
 *     `redis` singleton from `lib/redis.ts` cannot be reused.
 *   - ioredis `keyPrefix` is applied to keys only, NOT to pub/sub channel
 *     arguments, so we subscribe to the full unprefixed channel name while
 *     still setting `keyPrefix: 'hipost:'` for parity with the main client.
 */

import Redis from 'ioredis';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ module: 'store-listener' });

/** Single shared channel for all hiai-store → hiai-post events. */
export const STORE_EVENT_CHANNEL = 'hiai-store:events';

/** Event types currently published on `STORE_EVENT_CHANNEL`. */
export const STORE_EVENT_TYPES = ['product.created', 'product.updated'] as const;
export type StoreEventType = (typeof STORE_EVENT_TYPES)[number];

/** Flat envelope shape published by hiai-store. */
export interface StoreEvent {
  event: StoreEventType | string;
  tenantId: string;
  productId: string;
  productName: string;
  productUrl?: string;
  productImage?: string;
}

/** Module-level subscriber. `null` when the listener is stopped. */
let subscriber: Redis | null = null;

/**
 * Start the listener. Returns when the subscriber is connected and the
 * SUBSCRIBE has been issued. Idempotent: a second call while running is
 * a no-op (the existing subscriber is kept).
 */
export async function startStoreListener(): Promise<void> {
  if (subscriber) {
    log.warn('Store event listener already running; reusing existing subscriber');
    return;
  }

  subscriber = new Redis(config.REDIS_URL, {
    keyPrefix: 'hipost:',
    maxRetriesPerRequest: null, // pub/sub clients must not fail commands
    lazyConnect: true,
  });

  subscriber.on('connect', () => log.info({ channel: STORE_EVENT_CHANNEL }, 'Store event subscriber connected'));
  subscriber.on('error', (err) => log.error({ err }, 'Store event subscriber error'));

  await subscriber.connect();
  await subscriber.subscribe(STORE_EVENT_CHANNEL);
  subscriber.on('message', (channel, message) => {
    void handleMessage(channel, message);
  });

  log.info({ channel: STORE_EVENT_CHANNEL }, 'Store event listener started');
}

/**
 * Stop the listener. Disconnects the subscriber and clears module state.
 * Safe to call when the listener is not running.
 */
export async function stopStoreListener(): Promise<void> {
  if (!subscriber) return;

  try {
    await subscriber.unsubscribe(STORE_EVENT_CHANNEL);
  } catch (err) {
    log.warn({ err }, 'Unsubscribe failed during shutdown');
  }

  try {
    subscriber.disconnect();
  } catch (err) {
    log.warn({ err }, 'Disconnect failed during shutdown');
  }

  subscriber = null;
  log.info('Store event listener stopped');
}

/** True when a subscriber is currently active. */
export function isStoreListenerRunning(): boolean {
  return subscriber !== null;
}

async function handleMessage(channel: string, raw: string): Promise<void> {
  if (channel !== STORE_EVENT_CHANNEL) {
    log.warn({ channel }, 'Received message on unexpected channel');
    return;
  }

  let event: StoreEvent;
  try {
    event = JSON.parse(raw) as StoreEvent;
  } catch (err) {
    log.error({ err, channel, raw }, 'Invalid event payload (not JSON)');
    return;
  }

  if (!event || typeof event.tenantId !== 'string' || typeof event.productId !== 'string') {
    log.error({ channel, event }, 'Event payload missing required fields (tenantId, productId)');
    return;
  }

  log.info(
    {
      channel,
      event: event.event,
      tenantId: event.tenantId,
      productId: event.productId,
      productName: event.productName,
      productUrl: event.productUrl,
      productImage: event.productImage,
    },
    'Received hiai-store event',
  );
}
