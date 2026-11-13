export const CURSOR_TEAMID_ENV_VAR = "CURSOR_TEAMID";

/** Local implementation of the SDK's documented positive-safe-integer team-id rule
 * (see AgentOptions.teamId in @cursor/sdk). Accepts only plain decimal digits (no sign, exponent,
 * hex, or fraction) that form a positive safe integer; anything else is treated as unset. */
export function resolveCursorTeamId(env: NodeJS.ProcessEnv = process.env): number | undefined {
	const raw = env.CURSOR_TEAMID;
	if (raw === undefined) return undefined;
	const trimmed = raw.trim();
	if (!trimmed) return undefined;
	if (!/^[1-9]\d*$/.test(trimmed)) return undefined;
	const value = Number(trimmed);
	return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}
