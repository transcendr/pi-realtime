#!/usr/bin/env node
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const design = read("docs/realtime-voice/design-realtime-listening-pause.md");
const extensionTypes = read("../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts");
const runtime = read("../.pi/extensions/pi-realtime/runtime.ts");
const service = read("../.pi/extensions/pi-realtime/service.ts");
const commands = read("../.pi/extensions/pi-realtime/commands.ts");
const providerTypes = read("../.pi/extensions/pi-realtime/providers/types.ts");
const webrtcClient = read("../.pi/extensions/pi-realtime/media/webrtc-helper/client.js");

const checks = [
	{
		name: "design states hard pause covers both media input and backend routing",
		ok: /pause both microphone media capture\/transmission[\s\S]+backend transcript routing/.test(design),
	},
	{
		name: "design makes backend input gate the authoritative invariant",
		ok: design.includes("no final user transcript from any provider/media path may become a Pi backend instruction") && design.includes("decideRealtimeInputGate"),
	},
	{
		name: "design converges shortcut, command, and model tool on one service operation",
		ok: design.includes("All control surfaces map to one service operation") && design.includes("setListeningPaused") && design.includes("ctrl+shift+m") && design.includes("/realtime listening pause|resume|toggle|status") && design.includes("realtime_set_listening"),
	},
	{
		name: "design persists pause through replay events and visible UI",
		ok: design.includes("listening_pause_changed") && design.includes("Hydration from branch replay restores the pause flag") && design.includes("ctx.ui.setStatus") && design.includes("ctx.ui.setWidget"),
	},
	{
		name: "Pi extension API supports registered shortcuts",
		ok: extensionTypes.includes("registerShortcut(shortcut: KeyId"),
	},
	{
		name: "current runtime has UI sync surface to extend",
		ok: runtime.includes("ctx.ui.setStatus") && runtime.includes("ctx.ui.setWidget") && runtime.includes("registerRealtimeModelTools"),
	},
	{
		name: "current service transcript route has a single gate point before instruction submission",
		ok: service.includes("routeTranscriptEvent") && service.includes("routeTranscriptToInstruction") && service.includes("traceInstructionSubmission") && service.indexOf("routeTranscriptToInstruction") < service.indexOf("traceInstructionSubmission"),
	},
	{
		name: "current commands and provider boundary expose the exact seams named in the design",
		ok: commands.includes("REALTIME_COMMANDS") && commands.includes("realtimeCompletions") && providerTypes.includes("RealtimeProviderAdapter") && providerTypes.includes("setAudioOutputEnabled"),
	},
	{
		name: "WebRTC helper owns local media tracks and can implement track enabled toggling",
		ok: webrtcClient.includes("currentStream") && webrtcClient.includes("getUserMedia") && webrtcClient.includes("getAudioTracks"),
	},
];

let failed = 0;
for (const check of checks) {
	if (check.ok) {
		console.log(`ok - ${check.name}`);
	} else {
		failed += 1;
		console.error(`not ok - ${check.name}`);
	}
}

if (failed > 0) {
	console.error(`\n${failed} listening-pause design invariant check(s) failed.`);
	process.exit(1);
}

console.log(`\n${checks.length} listening-pause design invariant checks passed.`);
