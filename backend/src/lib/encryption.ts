import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from './config.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'encryption' });

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const keyHex = config.TOKEN_ENCRYPTION_KEY;
  if (keyHex.length < 64) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be at least 32 bytes (64 hex chars)');
  }
  return Buffer.from(keyHex, 'hex');
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format — expected iv:authTag:ciphertext');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

export function encryptToken(token: string): string {
  if (!token) return '';
  try {
    return encrypt(token);
  } catch (err) {
    log.error({ err }, 'Failed to encrypt token');
    throw err;
  }
}

export function decryptToken(encryptedToken: string): string {
  if (!encryptedToken) return '';
  try {
    return decrypt(encryptedToken);
  } catch (err) {
    log.error({ err }, 'Failed to decrypt token');
    throw err;
  }
}
