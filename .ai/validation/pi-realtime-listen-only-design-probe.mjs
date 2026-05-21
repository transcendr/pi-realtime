#!/usr/bin/env node
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const design = read("docs/realtime-voice/design-realtime-listen-only-mode.md");
const extensionTypes = read("../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts");
const tuiDocs = read("../node_modules/@earendil-works/pi-coding-agent/docs/tui.md");
const service = read("../.pi/extensions/pi-realtime/service.ts");
const commands = read("../.pi/extensions/pi-realtime/commands.ts");
const runtime = read("../.pi/extensions/pi-realtime/runtime.ts");
const store = read("../.pi/extensions/pi-realtime/store.ts");
const controlPlane = read("../.pi/extensions/pi-realtime/control-plane.ts");

const checks = [
	{
		name: "design rejects per-transcript thumbs-up behavior",
		ok: design.includes("Do not implement repeated persistent `👍` replies") && design.includes("zero per-transcript custom displayed messages"),
	},
	{
		name: "design preserves typed Pi interaction while routing explicit capture commands",
		ok: design.includes("Normal typed Pi interaction remains available") && design.includes("/realtime capture text <text>") && design.includes("/realtime capture clipboard"),
	},
	{
		name: "design uses inline widget default plus overlay toggle",
		ok: design.includes("ctx.ui.setWidget") && design.includes("ctrl+shift+g") && design.includes("/realtime capture inline|overlay") && design.includes("no-op otherwise"),
	},
	{
		name: "design persists OS-temp JSONL buffer with recovery semantics",
		ok: design.includes("fs.mkdtemp(path.join(os.tmpdir()") && design.includes("entries.jsonl") && design.includes("rendered.md") && design.includes("Recovery validation"),
	},
	{
		name: "design diverts transcripts before backend instruction submission",
		ok: design.includes("append_to_capture_buffer") && design.includes("listen_only_control") && design.includes("must not become individual Pi backend instructions"),
	},
	{
		name: "design requires confirmation-first submission via normal user-message path",
		ok: (design.includes("Confirmation-first") || design.includes("Require explicit confirmation")) && design.includes("pi.sendUserMessage") && design.includes("listen_only_buffer_submitted"),
	},
	{
		name: "design adopts pi-goals style headless subprocess synthesis",
		ok: design.includes("pi-goals` churn monitor") && design.includes("pi.exec(\"pi\"") && design.includes("--fork") && design.includes("--no-tools") && design.includes("--no-extensions"),
	},
	{
		name: "Pi APIs support shortcut, widget, overlay, and session research claims",
		ok: extensionTypes.includes("registerShortcut(shortcut: KeyId") && extensionTypes.includes("setWidget(key: string") && extensionTypes.includes("overlay?: boolean") && extensionTypes.includes("newSession(options?") && extensionTypes.includes("fork(entryId"),
	},
	{
		name: "TUI docs support widget and request-render claims",
		ok: tuiDocs.includes("ctx.ui.setWidget") && tuiDocs.includes("handle.requestRender()") && tuiDocs.includes("overlay: true"),
	},
	{
		name: "current code has transcript, command, runtime, store, and control-plane seams to extend",
		ok: service.includes("routeTranscriptEvent") && commands.includes("async function text") && runtime.includes("syncUi") && store.includes("ctx.sessionManager.getBranch()") && controlPlane.includes("sendInstruction(input)") && controlPlane.includes("createControlPlane(pi"),
	},
];

let failed = 0;
for (const check of checks) {
	if (check.ok) console.log(`ok - ${check.name}`);
	else {
		failed += 1;
		console.error(`not ok - ${check.name}`);
	}
}

if (failed > 0) {
	console.error(`\n${failed} listen-only design invariant check(s) failed.`);
	process.exit(1);
}

console.log(`\n${checks.length} listen-only design invariant checks passed.`);
