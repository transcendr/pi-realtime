import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { handleRealtimeCommand, realtimeCompletions } from "./commands";
import { filterRealtimeContextMessages } from "./context";
import { createControlPlane } from "./control-plane";
import { createService, type Service } from "./service";
import { createStore, type Store } from "./store";
import { registerRealtimeModelTools } from "./tools/pi";
import { renderWidget, statusText } from "./view";

const STATUS_KEY = "pi-realtime";
const WIDGET_KEY = "pi-realtime.widget";

export function registerPiRealtime(pi: ExtensionAPI): void {
	const store = createStore(pi);
	let currentCtx: ExtensionContext | undefined;
	const controlPlane = createControlPlane(pi, store, () => currentCtx);
	const service = createService(store, controlPlane);

	pi.registerCommand("realtime", {
		description: "Manage realtime voice provider sessions for Pi",
		handler: async (args, ctx) => {
			currentCtx = ctx;
			await handleRealtimeCommand(args, ctx, service);
			syncUi(ctx, service);
		},
		getArgumentCompletions: async () => realtimeCompletions().map((value) => ({ value, label: value })),
	});

	registerRealtimeModelTools(pi, service);

	pi.registerCommand("pi-realtime", {
		description: "Alias for /realtime",
		handler: async (args, ctx) => {
			currentCtx = ctx;
			await handleRealtimeCommand(args, ctx, service);
			syncUi(ctx, service);
		},
	});

	pi.on("session_start", async (_event, ctx) => { currentCtx = ctx; hydrate(ctx, store, service); syncUi(ctx, service); });
	pi.on("session_tree", async (_event, ctx) => { currentCtx = ctx; hydrate(ctx, store, service); syncUi(ctx, service); });
	pi.on("session_compact", async (_event, ctx) => { currentCtx = ctx; hydrate(ctx, store, service); syncUi(ctx, service); });
	pi.on("context", (event) => filterRealtimeContextMessages(event, service.state()));
	pi.on("session_shutdown", async () => { await service.shutdown(); currentCtx = undefined; });
}

function hydrate(ctx: ExtensionContext, store: Store, service: Service): void {
	store.hydrate(ctx);
	service.refresh(ctx);
}

function syncUi(ctx: ExtensionContext, service: Service): void {
	const state = service.state();
	ctx.ui.setStatus(STATUS_KEY, statusText(state));
	ctx.ui.setWidget(WIDGET_KEY, renderWidget(state));
}
