/**
 * Tests for the OAuth state store (CWE-352 mitigation).
 * Run with: bun test src/lib/oauth-state.test.ts
 */
import { describe, expect, it, beforeEach, mock } from "bun:test";

const store = new Map<string, string>();

mock.module("../lib/config.js", () => ({
	config: { BETTER_AUTH_SECRET: "x".repeat(48) },
	getConfig: () => ({
		BETTER_AUTH_SECRET: "x".repeat(48),
		NODE_ENV: "test",
	}),
}));

mock.module("../lib/logger.js", () => {
	const childLogger = {
		warn: () => {},
		error: () => {},
		info: () => {},
	};
	const pinoLogger = {
		child: () => childLogger,
		info: () => {},
		warn: () => {},
		error: () => {},
		debug: () => {},
	};
	return {
		logger: pinoLogger,
		getLogger: () => pinoLogger,
	};
});

mock.module("../lib/redis.js", () => ({
	redis: {
		setex: async (key: string, _ttl: number, value: string) => {
			store.set(key, value);
		},
		getdel: async (key: string) => {
			const v = store.get(key) ?? null;
			store.delete(key);
			return v;
		},
	},
	config: { BETTER_AUTH_SECRET: "x".repeat(48) },
	logger: {
		child: () => ({ warn: () => {}, error: () => {}, info: () => {} }),
		warn: () => {},
		error: () => {},
		info: () => {},
	},
}));

process.env.OAUTH_STATE_SECRET = "a".repeat(48);

const { generateState, validateState } = await import("./oauth-state.js");

describe("oauth-state", () => {
	beforeEach(() => {
		store.clear();
	});

	it("generates a state containing the csrf and platform", async () => {
		const { state, csrf } = await generateState({ platform: "instagram" });
		expect(state).toContain(".");
		expect(csrf.length).toBeGreaterThan(20);
		const dot = state.indexOf(".");
		const payload = JSON.parse(Buffer.from(state.slice(0, dot), "base64url").toString());
		expect(payload.platform).toBe("instagram");
		expect(payload.csrf).toBe(csrf);
		expect(typeof payload.ts).toBe("number");
	});

	it("rejects when state is missing", async () => {
		const result = await validateState(undefined);
		expect(result).toBeNull();
	});

	it("rejects when state is malformed", async () => {
		expect(await validateState("not-a-state")).toBeNull();
		expect(await validateState("only.one.dot.here.too.many")).toBeNull();
		expect(await validateState("")).toBeNull();
	});

	it("rejects when HMAC signature is wrong", async () => {
		const { state } = await generateState({ platform: "x" });
		const tampered = state.slice(0, -3) + "AAA";
		expect(await validateState(tampered)).toBeNull();
	});

	it("rejects when state is not in Redis (expired or used)", async () => {
		const { state } = await generateState({ platform: "x" });
		store.clear();
		expect(await validateState(state)).toBeNull();
	});

	it("rejects when csrf was already consumed (one-time use)", async () => {
		const { state } = await generateState({ platform: "linkedin" });
		const first = await validateState(state);
		expect(first?.platform).toBe("linkedin");
		const second = await validateState(state);
		expect(second).toBeNull();
	});

	it("rejects when stored state does not match returned state (tampering)", async () => {
		const { state, csrf } = await generateState({ platform: "tiktok" });
		store.set(`oauth:state:${csrf}`, "garbage.value.here");
		expect(await validateState(state)).toBeNull();
	});

	it("preserves tenantId through round-trip", async () => {
		const { state } = await generateState({ platform: "youtube", tenantId: "tenant-123" });
		const payload = await validateState(state);
		expect(payload?.tenantId).toBe("tenant-123");
		expect(payload?.platform).toBe("youtube");
	});
});
