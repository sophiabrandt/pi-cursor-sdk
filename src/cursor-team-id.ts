export const CURSOR_TEAMID_ENV_VAR = "CURSOR_TEAMID";

/** Local implementation of the SDK's documented positive-safe-integer team-id rule
 * (see AgentOptions.teamId in @cursor/sdk). Accepts only plain decimal digits (no sign, exponent,
 * hex, or fraction) that form a positive safe integer; anything else is treated as unset. */
export function resolveCursorTeamId(env: NodeJS.ProcessEnv = process.env): number | undefined {
	const trimmed = env[CURSOR_TEAMID_ENV_VAR]?.trim();
	if (!trimmed || !/^[1-9]\d*$/.test(trimmed)) return undefined;
	const value = Number(trimmed);
	return Number.isSafeInteger(value) ? value : undefined;
}

/** Spread into SDK options: omits `teamId` entirely when unset. */
export function cursorTeamIdOption(teamId: number | undefined): { teamId?: number } {
	return teamId !== undefined ? { teamId } : {};
}

/** Cache fingerprint input: unchanged for no-team so existing caches stay valid. */
export function scopeApiKeyByTeam(apiKey: string, teamId: number | undefined): string {
	return teamId !== undefined ? `${apiKey}\u0000${teamId}` : apiKey;
}
