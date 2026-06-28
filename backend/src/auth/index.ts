import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import * as authSchema from "../db/schema.js";
import { getConfig } from "../lib/config.js";
import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";

const cfg = getConfig();

// Note: `auth` is created at module-init time. `auth.handler` is a standard
// Web Fetch handler — `(request: Request) => Promise<Response>` — so it can
// be delegated from any framework route. See `api/routes/auth.ts` for the
// Elysia mounting at `/api/auth/*`.
export const auth = betterAuth({
  secret: cfg.BETTER_AUTH_SECRET,
  baseURL: cfg.BETTER_AUTH_URL,
  database: drizzleAdapter(db, {
    // `pg` provider matches the `postgres-js` client used in `lib/db.ts`.
    provider: "pg",
    // `schema` tells the adapter which Drizzle tables back user/session/
    // account/verification. Field names in `db/schema.ts` mirror Better
    // Auth's expected column names exactly.
    schema: {
      user: authSchema.user,
      session: authSchema.session,
      account: authSchema.account,
      verification: authSchema.verification,
    },
  }),
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 min
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  advanced: {
    database: {
      generateId: () => crypto.randomUUID(),
    },
  },
});

logger.info("Better Auth initialized for hiai-post");
