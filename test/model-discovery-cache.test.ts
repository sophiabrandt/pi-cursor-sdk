import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelListItem } from "@cursor/sdk";
import {
	buildCursorModelSelection,
	discoverModels,
	getCursorModelMetadata,
	type CursorModelCatalogProvenance,
	type CursorModelFallbackIssue,
} from "../src/model-discovery.js";
import { fingerprintApiKey, loadAnyCachedModelCatalog, saveModelListCache } from "../src/model-list-cache.js";

vi.mock("@cursor/sdk", () => ({
	Cursor: { models: { list: vi.fn() } },
}));

import { Cursor } from "@cursor/sdk";

const mockedList = vi.mocked(Cursor.models.list);

describe("discoverModels model-list cache", () => {
	const originalEnv = process.env;
	const originalArgv = process.argv;
	let tmpAgentDir: string;

	const MODEL: ModelListItem = {
		id: "composer-2",
		displayName: "Composer 2",
		variants: [{ params: [], displayName: "Composer 2", isDefault: true }],
	};

	beforeEach(() => {
		process.env = { ...originalEnv };
		delete process.env.CURSOR_API_KEY;
		delete process.env.CURSOR_TEAMID;
		delete process.env.PI_CURSOR_SDK_DISABLE_MODEL_CACHE;
		delete process.env.PI_CURSOR_SDK_MODEL_CACHE_TTL_MS;
		tmpAgentDir = mkdtempSync(join(tmpdir(), "pi-cursor-discovery-cache-"));
		process.env.PI_CODING_AGENT_DIR = tmpAgentDir;
		process.argv = ["node", "vitest"];
	});

	afterEach(() => {
		rmSync(tmpAgentDir, { recursive: true, force: true });
		process.env = originalEnv;
		process.argv = originalArgv;
		vi.clearAllMocks();
	});

	it("preserves variant-only default params without exposing them as known controls", async () => {
		process.env.CURSOR_API_KEY = "test-key-123";
		mockedList.mockResolvedValueOnce([
			{
				id: "claude-opus-4-8",
				displayName: "Opus 4.8",
				parameters: [
					{ id: "thinking", displayName: "Thinking", values: [{ value: "false" }, { value: "true" }] },
					{ id: "effort", displayName: "Effort", values: [{ value: "low" }, { value: "high" }] },
				],
				variants: [
					{
						params: [
							{ id: "cyber", value: "false" },
							{ id: "thinking", value: "true" },
							{ id: "effort", value: "high" },
						],
						displayName: "Opus 4.8",
						isDefault: true,
					},
				],
			},
		]);
		await discoverModels({ apiKey: process.env.CURSOR_API_KEY });
		expect(getCursorModelMetadata("claude-opus-4-8")?.parameterIds).toEqual({
			context: false,
			reasoning: false,
			effort: true,
			thinking: true,
			reasoning_effort: false,
			fast: false,
		});
		expect(buildCursorModelSelection("claude-opus-4-8", "low")).toEqual({
			id: "claude-opus-4-8",
			params: [
				{ id: "cyber", value: "false" },
				{ id: "thinking", value: "true" },
				{ id: "effort", value: "low" },
			],
		});
	});

	it("serves a warm catalog from cache without a second network call and labels it cached", async () => {
		process.env.CURSOR_API_KEY = "cache-key";
		mockedList.mockResolvedValueOnce([MODEL]);
		const catalogs: CursorModelCatalogProvenance[] = [];

		const first = await discoverModels({ apiKey: process.env.CURSOR_API_KEY, onCatalog: (catalog) => catalogs.push(catalog) });
		const second = await discoverModels({ apiKey: process.env.CURSOR_API_KEY, onCatalog: (catalog) => catalogs.push(catalog) });

		expect(mockedList).toHaveBeenCalledTimes(1);
		expect(second.map((model) => model.id)).toEqual(first.map((model) => model.id));
		// Neither carries a fallback issue; only the response is live.
		expect(catalogs).toEqual([{ source: "live" }, { source: "cache" }]);
	});

	it("does not read the cache when disabled via env", async () => {
		process.env.PI_CURSOR_SDK_DISABLE_MODEL_CACHE = "1";
		process.env.CURSOR_API_KEY = "cache-key";
		mockedList.mockResolvedValue([MODEL]);

		await discoverModels({ apiKey: process.env.CURSOR_API_KEY });
		await discoverModels({ apiKey: process.env.CURSOR_API_KEY });

		expect(mockedList).toHaveBeenCalledTimes(2);
	});

	it("keeps successful live discovery when cache persistence fails", async () => {
		const badAgentDir = join(tmpAgentDir, "not-a-directory");
		writeFileSync(badAgentDir, "file");
		process.env.PI_CODING_AGENT_DIR = badAgentDir;
		process.env.CURSOR_API_KEY = "cache-key";
		mockedList.mockResolvedValueOnce([MODEL]);
		const issues: CursorModelFallbackIssue[] = [];

		const models = await discoverModels({ apiKey: process.env.CURSOR_API_KEY, onCatalog: ({ issue }) => { if (issue) issues.push(issue); } });

		expect(models.map((model) => model.id)).toEqual(["composer-2"]);
		expect(issues).toEqual([]);
	});

	it("falls back to the cached catalog with a warning when a forced refresh fails", async () => {
		process.env.CURSOR_API_KEY = "cache-key";
		mockedList.mockResolvedValueOnce([MODEL]);
		await discoverModels({ apiKey: process.env.CURSOR_API_KEY });

		mockedList.mockRejectedValueOnce(new Error("network down"));
		const issues: CursorModelFallbackIssue[] = [];
		const refreshed = await discoverModels({ apiKey: process.env.CURSOR_API_KEY, forceRefresh: true, onCatalog: ({ issue }) => { if (issue) issues.push(issue); } });

		expect(refreshed.map((model) => model.id)).toEqual(["composer-2"]);
		expect(issues).toHaveLength(1);
		expect(issues[0].reason).toBe("cached-after-error");
		expect(issues[0].message).toContain("using cached Cursor model catalog");
		expect(issues[0].errorMessage).toContain("network down");
	});

	it("reports absent cached-catalog error details without blaming credentials", async () => {
		process.env.CURSOR_API_KEY = "cache-key";
		mockedList.mockResolvedValueOnce([MODEL]);
		await discoverModels({ apiKey: process.env.CURSOR_API_KEY });

		mockedList.mockRejectedValueOnce({});
		const issues: CursorModelFallbackIssue[] = [];
		await discoverModels({ apiKey: process.env.CURSOR_API_KEY, forceRefresh: true, onCatalog: ({ issue }) => { if (issue) issues.push(issue); } });

		expect(issues).toHaveLength(1);
		expect(issues[0].reason).toBe("cached-after-error");
		expect(issues[0].errorMessage).toBe("Cursor SDK request failed without further error details.");
		expect(issues[0].message).not.toMatch(/API key|\/login/);
		expect(issues[0].message).not.toContain("undefined");
	});

	it("scopes the cache key by team id: a team catalog is not served without the team and vice versa", async () => {
		process.env.CURSOR_API_KEY = "cache-key";
		// Save the catalog under the team-scoped key.
		process.env.CURSOR_TEAMID = "123";
		mockedList.mockResolvedValueOnce([MODEL]);
		const teamCatalogs: CursorModelCatalogProvenance[] = [];
		await discoverModels({ apiKey: process.env.CURSOR_API_KEY, onCatalog: (catalog) => teamCatalogs.push(catalog) });
		expect(teamCatalogs).toEqual([{ source: "live" }]);
		expect(loadAnyCachedModelCatalog(fingerprintApiKey(`cache-key\u0000123`))?.models).toHaveLength(1);
		expect(loadAnyCachedModelCatalog(fingerprintApiKey("cache-key"))).toBeUndefined();

		// The team catalog must not be served when no team resolves.
		delete process.env.CURSOR_TEAMID;
		const ambientCatalogs: CursorModelCatalogProvenance[] = [];
		await discoverModels({ apiKey: process.env.CURSOR_API_KEY, allowNetwork: false, onCatalog: (catalog) => ambientCatalogs.push(catalog) });
		expect(ambientCatalogs).toEqual([{ source: "bundled", issue: expect.objectContaining({ reason: "cache-only" }) }]);

		// Save the catalog under the plain (no-team) key and flip the direction.
		delete process.env.CURSOR_TEAMID;
		mockedList.mockResolvedValueOnce([MODEL]);
		const plainCatalogs: CursorModelCatalogProvenance[] = [];
		await discoverModels({ apiKey: process.env.CURSOR_API_KEY, onCatalog: (catalog) => plainCatalogs.push(catalog) });
		expect(plainCatalogs).toEqual([{ source: "live" }]);
		expect(loadAnyCachedModelCatalog(fingerprintApiKey("cache-key"))?.models).toHaveLength(1);

		process.env.CURSOR_TEAMID = "123";
		const teamCatalogsAgain: CursorModelCatalogProvenance[] = [];
		await discoverModels({ apiKey: process.env.CURSOR_API_KEY, allowNetwork: false, onCatalog: (catalog) => teamCatalogsAgain.push(catalog) });
		expect(teamCatalogsAgain).toEqual([{ source: "bundled", issue: expect.objectContaining({ reason: "cache-only" }) }]);
	});

	it("keeps the no-team cache key byte-identical to fingerprintApiKey(apiKey)", async () => {
		process.env.CURSOR_API_KEY = "cache-key";
		delete process.env.CURSOR_TEAMID;
		mockedList.mockResolvedValueOnce([MODEL]);
		const catalogs: CursorModelCatalogProvenance[] = [];
		await discoverModels({ apiKey: process.env.CURSOR_API_KEY, onCatalog: (catalog) => catalogs.push(catalog) });
		expect(catalogs).toEqual([{ source: "live" }]);
		// The live save must land under exactly today's no-team fingerprint, so
		// existing users' cached catalogs stay valid when the var is unset.
		expect(loadAnyCachedModelCatalog(fingerprintApiKey("cache-key"))?.models).toEqual([MODEL]);
		expect(fingerprintApiKey("cache-key\u0000123")).not.toBe(fingerprintApiKey("cache-key"));
	});
});
