import { spawn, type ChildProcess } from "node:child_process";

const PCM_SAMPLE_RATE = 24_000;
const PCM_CHANNELS = 1;
const PCM_BYTES_PER_SAMPLE = 2;
const CHUNK_MS = 100;
const STOP_KILL_GRACE_MS = 1500;
const CHUNK_BYTES = PCM_SAMPLE_RATE * PCM_CHANNELS * PCM_BYTES_PER_SAMPLE * CHUNK_MS / 1000;

export type AudioCaptureStatus = "idle" | "running" | "stopping";

export type AudioCaptureController = {
	readonly status: AudioCaptureStatus;
	start(onChunk: (chunk: Buffer) => Promise<void>, onError?: (error: Error) => void): Promise<void>;
	stop(): Promise<void>;
};

export function createMacOSFfmpegAudioCapture(inputDevice = ":0"): AudioCaptureController {
	return new MacOSFfmpegAudioCapture(inputDevice);
}

class MacOSFfmpegAudioCapture implements AudioCaptureController {
	private proc: ChildProcess | undefined;
	private stderr = "";
	private queue = Promise.resolve();
	private stopping = false;

	constructor(private readonly inputDevice: string) {}

	get status(): AudioCaptureStatus {
		if (this.stopping) return "stopping";
		return this.proc ? "running" : "idle";
	}

	async start(onChunk: (chunk: Buffer) => Promise<void>, onError?: (error: Error) => void): Promise<void> {
		if (this.proc) throw new Error("Microphone capture is already running.");
		this.stopping = false;
		let buffer = Buffer.alloc(0);
		const proc = spawn("ffmpeg", ["-hide_banner", "-loglevel", "warning", "-f", "avfoundation", "-i", this.inputDevice, "-ac", "1", "-ar", String(PCM_SAMPLE_RATE), "-f", "s16le", "-"], { stdio: ["ignore", "pipe", "pipe"] });
		this.proc = proc;
		proc.stdout?.on("data", (data: Buffer) => {
			buffer = Buffer.concat([buffer, data]);
			while (buffer.length >= CHUNK_BYTES) {
				const chunk = buffer.subarray(0, CHUNK_BYTES);
				buffer = buffer.subarray(CHUNK_BYTES);
				this.queue = this.queue.then(() => onChunk(Buffer.from(chunk))).catch((error: unknown) => onError?.(error instanceof Error ? error : new Error(String(error))));
			}
		});
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
			if (!wasStopping && code && !signal) onError?.(new Error(`ffmpeg microphone capture exited with code ${code}: ${this.stderr.trim()}`));
		});
	}

	async stop(): Promise<void> {
		const proc = this.proc;
		if (!proc) return;
		this.stopping = true;
		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => { proc.kill("SIGKILL"); resolve(); }, STOP_KILL_GRACE_MS);
			proc.once("exit", () => { clearTimeout(timer); resolve(); });
			proc.kill("SIGTERM");
		});
		this.proc = undefined;
		this.stopping = false;
	}
}
