import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { discoverModels, type CursorModelCatalogProvenance } from "../src/model-discovery.js";
import { fingerprintApiKey, saveModelListCache } from "../src/model-list-cache.js";

function readTeamHeader(init: unknown): string | undefined {
	const headers = (init as { headers?: unknown } | undefined)?.headers;
	if (!headers) return undefined;
	if (typeof (headers as { get?: unknown }).get === "function") {
		return (headers as { get: (name: string) => string | null }).get("x-cursor-team-id") ?? undefined;
	}
	const value = (headers as Record<string, unknown>)["x-cursor-team-id"];
	return typeof value === "string" ? value : undefined;
}

it.each([false, true])("does not promise an automatic discovery retry (cached=%s)", async (cached) => {
	const root = mkdtempSync(join(tmpdir(), "cursor-discovery-network-"));
	const apiKey = "synthetic-offline-key";
	vi.stubEnv("PI_CODING_AGENT_DIR", root);
	vi.stubEnv("PI_CURSOR_SDK_DISABLE_MODEL_CACHE", undefined);
	vi.stubEnv("CURSOR_API_KEY", undefined);
	vi.stubEnv("CURSOR_TEAMID", undefined);
	const urls: string[] = [];
	// Keep the real SDK error conversion; only fail its network transport.
	vi.stubGlobal("fetch", (url: unknown) => {
		urls.push(String(url));
		return Promise.reject(new TypeError("fetch failed", {
			cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
		}));
	});
	try {
		if (cached) {
			expect(saveModelListCache(fingerprintApiKey(apiKey), [{ id: "cached-model", displayName: "Cached model" }])).toBe(true);
		}
		const catalogs: CursorModelCatalogProvenance[] = [];
		const models = await discoverModels({ apiKey, forceRefresh: true, onCatalog: (catalog) => catalogs.push(catalog) });
		expect(models.length).toBeGreaterThan(0);
		expect(urls.filter((url) => url.endsWith("/v1/models"))).toHaveLength(1);
		expect(catalogs).toEqual([{ source: cached ? "cache" : "bundled", issue: expect.objectContaining({ reason: cached ? "cached-after-error" : "discovery-failed" }) }]);
		const issue = catalogs[0].issue;
		expect(issue?.errorMessage).toContain("Network error");
		expect(issue?.message).not.toMatch(/automatically|auto-retry/i);
		if (cached) expect(models.map((model) => model.id)).toEqual(["cached-model"]);
		else expect(issue?.message).toContain("/cursor-refresh-models");
	} finally {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		rmSync(root, { recursive: true, force: true });
	}
});

// SDK header emission contract against the installed @cursor/sdk: the extension
// threads teamId into Cursor.models.list and the SDK puts x-cursor-team-id on
// the wire only for a positive safe integer. The fetch stub still rejects the
// network, so no real Cursor call is ever made.
it.each([
	["123", "123"],
	["0", undefined],
	["abc", undefined],
	[undefined, undefined],
])("CURSOR_TEAMID=%s yields x-cursor-team-id=%s on the /v1/models request", async (raw, expected) => {
	const root = mkdtempSync(join(tmpdir(), "cursor-discovery-team-header-"));
	const apiKey = "synthetic-offline-key";
	vi.stubEnv("PI_CODING_AGENT_DIR", root);
	vi.stubEnv("PI_CURSOR_SDK_DISABLE_MODEL_CACHE", undefined);
	vi.stubEnv("CURSOR_API_KEY", undefined);
	vi.stubEnv("CURSOR_TEAMID", raw);
	const requests: { url: string; init: unknown }[] = [];
	// Keep the real SDK error conversion; only fail its network transport.
	vi.stubGlobal("fetch", (url: unknown, init?: unknown) => {
		requests.push({ url: String(url), init });
		return Promise.reject(new TypeError("fetch failed", {
			cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
		}));
	});
	try {
		await discoverModels({ apiKey, forceRefresh: true });
		const modelRequests = requests.filter((request) => request.url.endsWith("/v1/models"));
		expect(modelRequests).toHaveLength(1);
		expect(readTeamHeader(modelRequests[0].init)).toBe(expected);
	} finally {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		rmSync(root, { recursive: true, force: true });
	}
});
