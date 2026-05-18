import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { defaultModelFor, type Service } from "./service";
import type { ProviderKind, ProviderSessionId, VoiceToolName } from "./types";

export async function handleRealtimeCommand(args: string, ctx: ExtensionCommandContext, service: Service): Promise<void> {
	service.refresh(ctx);
	const tokens = tokenize(args);
	const [cmd = "status", ...rest] = tokens;
	if (cmd === "help") return notify(ctx, helpText());
	if (cmd === "status") return notify(ctx, service.statusText());
	if (cmd === "start") return start(rest, ctx, service);
	if (cmd === "stop") return stop(rest, ctx, service);
	if (cmd === "primary") return primary(rest, ctx, service);
	if (cmd === "citations") return citations(ctx, service);
	if (cmd === "usage") return usage(rest, ctx, service);
	if (cmd === "debug") return debug(rest, ctx, service);
	if (cmd === "webrtc") return webrtcPreference(rest, ctx, service);
	if (cmd === "text") return text(rest, ctx, service);
	if (cmd === "mic") return mic(rest, ctx, service);
	if (cmd === "audio") return audio(rest, ctx, service);
	if (cmd === "openai") return openai(rest, ctx, service);
	if (cmd === "fake") return fake(rest, ctx, service);
	notify(ctx, `Unknown /realtime command: ${cmd}\n${helpText()}`, "warning");
}

export function realtimeCompletions(): string[] {
	return ["status", "start --provider fake", "start --provider openai", "text", "mic start", "mic stop", "audio start", "audio stop", "webrtc on", "webrtc off", "openai", "openai start", "openai stop", "openai text", "openai mic start", "openai mic stop", "openai audio start", "openai audio stop", "openai webrtc start", "openai webrtc stop", "openai webrtc status", "usage", "usage --details", "usage reset", "debug", "fake transcript", "fake tool pi_state_snapshot {}", "fake tool pi_send_instruction {\"instruction\":\"...\"}", "stop", "primary", "citations", "help"];
}

async function start(tokens: string[], ctx: ExtensionCommandContext, service: Service): Promise<void> {
	const provider = providerArg(tokens) ?? "fake";
	const model = valueAfter(tokens, "--model") ?? defaultModelFor(provider);
	const personaId = valueAfter(tokens, "--persona") ?? "default";
	const primary = !tokens.includes("--secondary");
	try {
		const providerSessionId = await service.startSession({ provider, model, personaId, primary }, ctx);
		notify(ctx, `Started ${provider} realtime session ${providerSessionId} (${model}).${primary ? "" : " Not primary."}`);
		if (provider === "openai") notify(ctx, service.rawEchoWarningText(), "warning");
	} catch (error) {
		notify(ctx, error instanceof Error ? error.message : String(error), "warning");
	}
}

async function stop(tokens: string[], ctx: ExtensionCommandContext, service: Service): Promise<void> {
	const state = service.state();
	const providerSessionId = valueAfter(tokens, "--session") ?? state.primaryProviderSessionId;
	if (!providerSessionId) return notify(ctx, "No realtime provider session is active.", "warning");
	await service.stopSession(providerSessionId, "user");
	notify(ctx, `Stopped realtime session ${providerSessionId}.`);
}

function primary(tokens: string[], ctx: ExtensionCommandContext, service: Service): void {
	const providerSessionId = tokens[0] as ProviderSessionId | undefined;
	if (!providerSessionId) return notify(ctx, "Usage: /realtime primary <providerSessionId>", "warning");
	service.setPrimary(providerSessionId);
	notify(ctx, `Primary realtime session set to ${providerSessionId}.`);
}

function citations(ctx: ExtensionCommandContext, service: Service): void {
	const deck = service.observeCitationDeck(ctx);
	if (deck.active.length === 0) return notify(ctx, "No active Pinotator citations observed.");
	notify(ctx, [`Pinotator deck revision ${deck.revision}:`, ...deck.active.map((item) => `${item.displayRef} ${item.citationId} ${item.snippet}`)].join("\n"));
}

function usage(tokens: string[], ctx: ExtensionCommandContext, service: Service): void {
	const providerSessionId = valueAfter(tokens, "--session") as ProviderSessionId | undefined;
	if (tokens[0] === "reset") return notify(ctx, service.resetUsage(providerSessionId));
	notify(ctx, service.usageText(providerSessionId, tokens.includes("--details")));
}

function debug(tokens: string[], ctx: ExtensionCommandContext, service: Service): void {
	const providerSessionId = valueAfter(tokens, "--session") as ProviderSessionId | undefined;
	notify(ctx, service.debugText(providerSessionId));
}

function webrtcPreference(tokens: string[], ctx: ExtensionCommandContext, service: Service): void {
	const [mode] = tokens;
	if (mode === "on") return notify(ctx, service.setOpenAIWebRTCEnabled(true));
	if (mode === "off") return notify(ctx, service.setOpenAIWebRTCEnabled(false));
	notify(ctx, "Usage: /realtime webrtc on|off", "warning");
}

async function text(tokens: string[], ctx: ExtensionCommandContext, service: Service): Promise<void> {
	const providerSessionId = valueAfter(tokens, "--session") ?? service.state().primaryProviderSessionId;
	const message = stripSessionFlag(tokens).join(" ").trim();
	if (!providerSessionId) return notify(ctx, "No primary realtime session. Start one with /realtime start --provider fake or openai.", "warning");
	if (!message) return notify(ctx, "Usage: /realtime text <message>", "warning");
	try {
		await service.sendTextInput(providerSessionId, message);
		notify(ctx, `Sent text input to ${providerSessionId}.`);
	} catch (error) {
		notify(ctx, error instanceof Error ? error.message : String(error), "warning");
	}
}

async function mic(tokens: string[], ctx: ExtensionCommandContext, service: Service): Promise<void> {
	const [subcommand = "status", ...rest] = tokens;
	const providerSessionId = valueAfter(rest, "--session") ?? service.state().primaryProviderSessionId;
	if (subcommand === "status") return notify(ctx, service.microphoneStatus());
	if (!providerSessionId) return notify(ctx, "No primary realtime session. Start one with /realtime start --provider openai.", "warning");
	try {
		if (subcommand === "start") {
			await service.startMicrophone(providerSessionId);
			return notify(ctx, `Started microphone streaming to ${providerSessionId}.`);
		}
		if (subcommand === "stop") {
			await service.stopMicrophone(providerSessionId);
			return notify(ctx, `Stopped microphone streaming to ${providerSessionId}.`);
		}
	} catch (error) {
		return notify(ctx, error instanceof Error ? error.message : String(error), "warning");
	}
	return notify(ctx, "Usage: /realtime mic start|stop|status [--session <providerSessionId>]", "warning");
}

async function audio(tokens: string[], ctx: ExtensionCommandContext, service: Service): Promise<void> {
	const [subcommand = "status", ...rest] = tokens;
	const providerSessionId = valueAfter(rest, "--session") ?? service.state().primaryProviderSessionId;
	if (subcommand === "status") return notify(ctx, service.audioPlaybackStatus());
	if (!providerSessionId) return notify(ctx, "No primary realtime session. Start one with /realtime start --provider openai.", "warning");
	try {
		if (subcommand === "start") {
			await service.startAudioPlayback(providerSessionId);
			return notify(ctx, `Started audio playback for ${providerSessionId}.`);
		}
		if (subcommand === "stop") {
			await service.stopAudioPlayback(providerSessionId);
			return notify(ctx, `Stopped audio playback for ${providerSessionId}.`);
		}
	} catch (error) {
		return notify(ctx, error instanceof Error ? error.message : String(error), "warning");
	}
	return notify(ctx, "Usage: /realtime audio start|stop|status [--session <providerSessionId>]", "warning");
}

async function openai(tokens: string[], ctx: ExtensionCommandContext, service: Service): Promise<void> {
	const [subcommand, ...rest] = tokens;
	if (!subcommand) return latestActiveOpenAISession(service) ? stopOpenAI(ctx, service) : startOpenAI(rest, ctx, service);
	if (subcommand === "start") return startOpenAI(rest, ctx, service);
	if (subcommand === "stop") return stopOpenAI(ctx, service);
	const openaiSession = latestActiveOpenAISession(service);
	if (!openaiSession) return notify(ctx, "No active OpenAI realtime session. Start one with /realtime openai start.", "warning");
	if (subcommand === "text") return text(["--session", openaiSession.providerSessionId, ...rest], ctx, service);
	if (subcommand === "mic") return mic([...rest, "--session", openaiSession.providerSessionId], ctx, service);
	if (subcommand === "audio") return audio([...rest, "--session", openaiSession.providerSessionId], ctx, service);
	if (subcommand === "webrtc") return webrtc(rest, ctx, service, openaiSession.providerSessionId);
	return notify(ctx, "Usage: /realtime openai [start|stop] | openai text <message> | openai mic start|stop|status | openai audio start|stop|status | openai webrtc start|stop|status", "warning");
}

async function startOpenAI(tokens: string[], ctx: ExtensionCommandContext, service: Service): Promise<void> {
	const model = valueAfter(tokens, "--model") ?? defaultModelFor("openai");
	const personaId = valueAfter(tokens, "--persona") ?? "default";
	try {
		const providerSessionId = await service.startSession({ provider: "openai", model, personaId, primary: !tokens.includes("--secondary") }, ctx);
		if (!service.isOpenAIWebRTCEnabled()) return notify(ctx, `Started openai realtime session ${providerSessionId} (${model}). WebRTC auto-launch is off.`);
		const url = await service.startWebRTCHelper(providerSessionId, ctx);
		notify(ctx, `Started openai realtime session ${providerSessionId} (${model}) and opened WebRTC helper: ${url}`);
	} catch (error) {
		notify(ctx, error instanceof Error ? error.message : String(error), "warning");
	}
}

async function stopOpenAI(ctx: ExtensionCommandContext, service: Service): Promise<void> {
	const openaiSession = latestActiveOpenAISession(service);
	if (!openaiSession) return notify(ctx, "No active OpenAI realtime session is active.", "warning");
	await service.stopSession(openaiSession.providerSessionId, "user");
	notify(ctx, `Stopped OpenAI realtime session ${openaiSession.providerSessionId}.`);
}

async function webrtc(tokens: string[], ctx: ExtensionCommandContext, service: Service, providerSessionId: ProviderSessionId): Promise<void> {
	const [subcommand = "status"] = tokens;
	try {
		if (subcommand === "status") return notify(ctx, service.webRTCHelperStatus());
		if (subcommand === "start") {
			const url = await service.startWebRTCHelper(providerSessionId, ctx);
			return notify(ctx, `Started OpenAI WebRTC helper for ${providerSessionId}. Opened ${url}`);
		}
		if (subcommand === "stop") {
			await service.stopWebRTCHelper(providerSessionId);
			return notify(ctx, `Stopped OpenAI WebRTC helper for ${providerSessionId}.`);
		}
	} catch (error) {
		return notify(ctx, error instanceof Error ? error.message : String(error), "warning");
	}
	return notify(ctx, "Usage: /realtime openai webrtc start|stop|status", "warning");
}

function latestActiveOpenAISession(service: Service) {
	return [...service.state().sessions.values()].reverse().find((session) => session.provider === "openai" && (session.status === "active" || session.status === "starting"));
}

async function fake(tokens: string[], ctx: ExtensionCommandContext, service: Service): Promise<void> {
	const [subcommand, ...rest] = tokens;
	const providerSessionId = valueAfter(rest, "--session") ?? service.state().primaryProviderSessionId;
	if (!providerSessionId) return notify(ctx, "No primary fake realtime session. Start one with /realtime start --provider fake.", "warning");
	if (subcommand === "transcript") {
		const text = stripSessionFlag(rest).join(" ").trim();
		if (!text) return notify(ctx, "Usage: /realtime fake transcript <text>", "warning");
		service.simulateFakeTranscript(providerSessionId, text, true);
		return notify(ctx, `Fake transcript emitted for ${providerSessionId}.`);
	}
	if (subcommand === "tool") {
		const clean = stripSessionFlag(rest);
		const name = clean[0] as VoiceToolName | undefined;
		if (!name) return notify(ctx, "Usage: /realtime fake tool <tool_name> <json>", "warning");
		const args = parseJsonObject(clean.slice(1).join(" "));
		if (!args.ok) return notify(ctx, args.message, "warning");
		const callId = await service.simulateFakeToolCall(providerSessionId, name, args.value);
		return notify(ctx, `Fake tool call ${callId} emitted for ${providerSessionId}.`);
	}
	notify(ctx, "Usage: /realtime fake transcript <text> | fake tool <tool_name> <json>", "warning");
}

function stripSessionFlag(tokens: string[]): string[] {
	const index = tokens.indexOf("--session");
	return index >= 0 ? [...tokens.slice(0, index), ...tokens.slice(index + 2)] : tokens;
}

function providerArg(tokens: string[]): ProviderKind | undefined {
	const value = valueAfter(tokens, "--provider");
	return value === "fake" || value === "openai" || value === "gemini" ? value : undefined;
}

function valueAfter(tokens: string[], flag: string): string | undefined {
	const index = tokens.indexOf(flag);
	return index >= 0 ? tokens[index + 1] : undefined;
}

function parseJsonObject(input: string): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
	if (!input.trim()) return { ok: true, value: {} };
	try {
		const value = JSON.parse(input) as unknown;
		return typeof value === "object" && value !== null && !Array.isArray(value) ? { ok: true, value: value as Record<string, unknown> } : { ok: false, message: "Tool arguments must be a JSON object." };
	} catch (error) {
		return { ok: false, message: `Invalid JSON tool arguments: ${error instanceof Error ? error.message : String(error)}` };
	}
}

function tokenize(args: string): string[] {
	return args.trim().split(/\s+/).filter(Boolean);
}

function notify(ctx: ExtensionCommandContext, message: string, level: "info" | "warning" = "info"): void {
	ctx.ui.notify(message, level);
}

function helpText(): string {
	return [
		"/realtime status — show provider sessions",
		"/realtime start --provider fake|openai|gemini [--model <id>] [--secondary]",
		"/realtime text <message> — send text to the primary live provider session",
		"/realtime mic start|stop|status — stream local microphone to the primary session",
		"/realtime audio start|stop|status — play provider audio from the primary session",
		"/realtime webrtc on|off — persistently toggle OpenAI WebRTC auto-launch",
		"/realtime openai [start|stop] — toggle/start/stop OpenAI; start launches WebRTC when enabled",
		"/realtime openai text <message> — send text to the active OpenAI session",
		"/realtime openai mic start|stop|status — stream local microphone to the active OpenAI session",
		"/realtime openai audio start|stop|status — play OpenAI audio responses",
		"/realtime openai webrtc start|stop|status — use localhost browser/WebRTC media with echo cancellation",
		"/realtime fake transcript <text>",
		"/realtime fake tool <tool_name> <json>",
		"/realtime stop [--session <id>]",
		"/realtime primary <providerSessionId>",
		"/realtime citations — inspect current Pinotator citation deck",
		"/realtime usage [--session <id>] [--details] — inspect provider usage telemetry and estimated response cost",
		"/realtime usage reset [--session <id>] — reset displayed usage counters without deleting historical events",
		"/realtime debug [--session <id>] — show WebRTC diagnostic trace file paths",
	].join("\n");
}
