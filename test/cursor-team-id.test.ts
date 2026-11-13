import { describe, expect, it } from "vitest";
import { CURSOR_TEAMID_ENV_VAR, resolveCursorTeamId } from "../src/cursor-team-id.js";

describe("resolveCursorTeamId", () => {
	it("exposes the canonical env var name", () => {
		expect(CURSOR_TEAMID_ENV_VAR).toBe("CURSOR_TEAMID");
	});

	const table: ReadonlyArray<readonly [raw: string | undefined, expected: number | undefined]> = [
		["123", 123],
		[" 42 ", 42],
		[undefined, undefined],
		["", undefined],
		["   ", undefined],
		["abc", undefined],
		["NaN", undefined],
		["0", undefined],
		["-5", undefined],
		["1.5", undefined],
		["1e300", undefined],
		["1e3", undefined],
		["0x10", undefined],
		["+5", undefined],
		["12.0", undefined],
		["007", undefined],
	];

	it.each(table)("parses CURSOR_TEAMID=%j as %j", (raw, expected) => {
		const env: NodeJS.ProcessEnv = raw === undefined ? {} : { CURSOR_TEAMID: raw };
		expect(resolveCursorTeamId(env)).toBe(expected);
	});
});
