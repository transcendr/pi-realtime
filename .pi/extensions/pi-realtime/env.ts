import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

let loaded = false;

export function loadProjectEnv(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): void {
	if (loaded) return;
	loaded = true;
	const path = resolve(cwd, ".env");
	if (!existsSync(path)) return;
	for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
		const parsed = parseEnvLine(line);
		if (!parsed) continue;
		const [key, value] = parsed;
		if (env[key] === undefined) env[key] = value;
	}
}

function parseEnvLine(line: string): [string, string] | undefined {
	const trimmed = line.trim();
	if (!trimmed || trimmed.startsWith("#")) return undefined;
	const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
	if (!match) return undefined;
	return [match[1] ?? "", unquote(match[2] ?? "")];
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
	const commentIndex = trimmed.indexOf(" #");
	return (commentIndex >= 0 ? trimmed.slice(0, commentIndex) : trimmed).trim();
}
