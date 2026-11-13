import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createExtensionCommandContext, createPiHarness } from "./helpers/pi-harness.js";

const getUsage = vi.hoisted(() => vi.fn());
vi.mock("../src/cursor-sdk-runtime.js", () => ({ loadCursorSdk: async () => ({ Agent: { getUsage } }) }));
vi.mock("../src/cursor-usage-ledger.js", () => ({
	readCursorUsageView: () => ({ agents: [], records: [] }),
	refreshCursorUsageView: async (_pi: unknown, _ctx: unknown, fetch: (id: string) => Promise<unknown>) => {
		await fetch("agent-1");
		return { agents: [], records: [] };
	},
}));
vi.mock("../src/cursor-sdk-billed-usage.js", () => ({
	fetchCursorSdkAgentUsage: async (agent: { getUsage: () => Promise<unknown> }) => agent.getUsage(),
}));

import { registerCursorUsageCommand } from "../src/cursor-usage-command.js";

async function refresh(): Promise<void> {
	const harness = createPiHarness();
	registerCursorUsageCommand(harness as unknown as ExtensionAPI);
	await harness._commands.get("cursor-usage")!.handler("refresh", createExtensionCommandContext({ cwd: process.cwd() }));
}

describe("/cursor-usage refresh team scoping", () => {
	afterEach(() => vi.unstubAllEnvs());

	it("passes CURSOR_TEAMID to Agent.getUsage", async () => {
		vi.stubEnv("CURSOR_TEAMID", "123");
		getUsage.mockResolvedValue({});
		await refresh();
		expect(getUsage).toHaveBeenCalledWith("agent-1", expect.objectContaining({ teamId: 123 }));
	});

	it("omits teamId when CURSOR_TEAMID is unset", async () => {
		vi.stubEnv("CURSOR_TEAMID", "");
		getUsage.mockResolvedValue({});
		await refresh();
		expect(getUsage.mock.calls[0][1]).not.toHaveProperty("teamId");
	});
});
