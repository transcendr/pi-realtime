import { spawn, type ChildProcess } from "node:child_process";

const PCM_SAMPLE_RATE = 24_000;
const PCM_CHANNELS = 1;
const STOP_KILL_GRACE_MS = 1500;

export type AudioPlaybackStatus = "idle" | "running" | "stopping";

export type AudioPlaybackController = {
	readonly status: AudioPlaybackStatus;
	start(onError?: (error: Error) => void): Promise<void>;
	write(chunk: Buffer): void;
	stop(): Promise<void>;
};

export function createFfplayAudioPlayback(): AudioPlaybackController {
	return new FfplayAudioPlayback();
}

class FfplayAudioPlayback implements AudioPlaybackController {
	private proc: ChildProcess | undefined;
	private stderr = "";
	private stopping = false;

	get status(): AudioPlaybackStatus {
		if (this.stopping) return "stopping";
		return this.proc ? "running" : "idle";
	}

	async start(onError?: (error: Error) => void): Promise<void> {
		if (this.proc) return;
		this.stopping = false;
		const proc = spawn("ffplay", ["-hide_banner", "-loglevel", "warning", "-nodisp", "-autoexit", "-f", "s16le", "-ar", String(PCM_SAMPLE_RATE), "-ch_layout", PCM_CHANNELS === 1 ? "mono" : "stereo", "-"], { stdio: ["pipe", "ignore", "pipe"] });
		this.proc = proc;
		proc.stderr?.on("data", (data: Buffer) => { this.stderr = `${this.stderr}${data.toString()}`.slice(-4000); });
		proc.on("error", (error) => {
			this.proc = undefined;
			this.stopping = false;
			onError?.(error);
		});
		proc.on("exit", (code, signal) => {
			const wasStopping = this.stopping;
			this.proc = undefined;
			this.stopping = false;
			if (!wasStopping && code && !signal) onError?.(new Error(`ffplay audio playback exited with code ${code}: ${this.stderr.trim()}`));
		});
	}

	write(chunk: Buffer): void {
		if (!this.proc?.stdin?.writable) return;
		this.proc.stdin.write(chunk);
	}

	async stop(): Promise<void> {
		const proc = this.proc;
		if (!proc) return;
		this.stopping = true;
		proc.stdin?.end();
		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => { proc.kill("SIGKILL"); resolve(); }, STOP_KILL_GRACE_MS);
			proc.once("exit", () => { clearTimeout(timer); resolve(); });
		});
		this.proc = undefined;
		this.stopping = false;
	}
}
