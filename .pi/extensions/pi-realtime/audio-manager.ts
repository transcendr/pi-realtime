import { createMacOSFfmpegAudioCapture, type AudioCaptureController } from "./audio";
import { createFfplayAudioPlayback, type AudioPlaybackController } from "./playback";
import type { ProviderSessionId } from "./types";
import type { RealtimeProviderAdapter } from "./providers/types";

export type AudioManagerErrorKind = "microphone" | "playback";

export type AudioManager = {
	startMicrophone(providerSessionId: ProviderSessionId, adapter: RealtimeProviderAdapter): Promise<void>;
	stopMicrophone(providerSessionId?: ProviderSessionId): Promise<void>;
	microphoneStatus(): string;
	startAudioPlayback(providerSessionId: ProviderSessionId, adapter: RealtimeProviderAdapter): Promise<void>;
	stopAudioPlayback(providerSessionId?: ProviderSessionId, adapterFor?: (providerSessionId: ProviderSessionId) => RealtimeProviderAdapter | undefined): Promise<void>;
	audioPlaybackStatus(): string;
	writeProviderAudio(providerSessionId: ProviderSessionId, audio: Buffer): void;
	shutdown(adapterFor?: (providerSessionId: ProviderSessionId) => RealtimeProviderAdapter | undefined): Promise<void>;
};

export function createAudioManager(onError?: (providerSessionId: ProviderSessionId, kind: AudioManagerErrorKind, error: Error) => void): AudioManager {
	return new RealtimeAudioManager(onError);
}

class RealtimeAudioManager implements AudioManager {
	private readonly audioCaptures = new Map<ProviderSessionId, AudioCaptureController>();
	private readonly audioPlaybacks = new Map<ProviderSessionId, AudioPlaybackController>();

	constructor(private readonly onError?: (providerSessionId: ProviderSessionId, kind: AudioManagerErrorKind, error: Error) => void) {}

	async startMicrophone(providerSessionId: ProviderSessionId, adapter: RealtimeProviderAdapter): Promise<void> {
		if (this.audioCaptures.has(providerSessionId)) throw new Error(`Microphone is already running for ${providerSessionId}`);
		const capture = createMacOSFfmpegAudioCapture();
		this.audioCaptures.set(providerSessionId, capture);
		await capture.start((chunk) => adapter.sendAudioInput(chunk).then(() => undefined), (error) => this.handleError(providerSessionId, "microphone", error));
	}

	async stopMicrophone(providerSessionId?: ProviderSessionId): Promise<void> {
		const ids = providerSessionId ? [providerSessionId] : [...this.audioCaptures.keys()];
		for (const id of ids) {
			const capture = this.audioCaptures.get(id);
			if (!capture) continue;
			await capture.stop();
			this.audioCaptures.delete(id);
		}
	}

	microphoneStatus(): string {
		if (this.audioCaptures.size === 0) return "microphone: idle";
		return ["microphone:", ...[...this.audioCaptures].map(([id, capture]) => `- ${id} ${capture.status}`)].join("\n");
	}

	async startAudioPlayback(providerSessionId: ProviderSessionId, adapter: RealtimeProviderAdapter): Promise<void> {
		if (this.audioPlaybacks.has(providerSessionId)) return;
		const playback = createFfplayAudioPlayback();
		this.audioPlaybacks.set(providerSessionId, playback);
		await playback.start((error) => this.handleError(providerSessionId, "playback", error));
		await adapter.setAudioOutputEnabled(true);
	}

	async stopAudioPlayback(providerSessionId?: ProviderSessionId, adapterFor?: (providerSessionId: ProviderSessionId) => RealtimeProviderAdapter | undefined): Promise<void> {
		const ids = providerSessionId ? [providerSessionId] : [...this.audioPlaybacks.keys()];
		for (const id of ids) {
			await adapterFor?.(id)?.setAudioOutputEnabled(false);
			const playback = this.audioPlaybacks.get(id);
			if (!playback) continue;
			await playback.stop();
			this.audioPlaybacks.delete(id);
		}
	}

	audioPlaybackStatus(): string {
		if (this.audioPlaybacks.size === 0) return "audio playback: idle";
		return ["audio playback:", ...[...this.audioPlaybacks].map(([id, playback]) => `- ${id} ${playback.status}`)].join("\n");
	}

	writeProviderAudio(providerSessionId: ProviderSessionId, audio: Buffer): void {
		this.audioPlaybacks.get(providerSessionId)?.write(audio);
	}

	async shutdown(adapterFor?: (providerSessionId: ProviderSessionId) => RealtimeProviderAdapter | undefined): Promise<void> {
		await this.stopMicrophone();
		await this.stopAudioPlayback(undefined, adapterFor);
	}

	private handleError(providerSessionId: ProviderSessionId, kind: AudioManagerErrorKind, error: Error): void {
		if (kind === "microphone") this.audioCaptures.delete(providerSessionId);
		else this.audioPlaybacks.delete(providerSessionId);
		this.onError?.(providerSessionId, kind, error);
	}
}
