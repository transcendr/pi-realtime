import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPiRealtime } from "./runtime";

export default function piRealtimeExtension(pi: ExtensionAPI): void {
	registerPiRealtime(pi);
}
