const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const startButton = document.getElementById("start");
const remoteAudio = document.getElementById("remote");
const providerSessionId = decodeURIComponent(location.pathname.split("/").pop() || "");
let dc;
let currentPc;
let currentStream;
let lastOutboxId = 0;
let pollTimer;

startButton.addEventListener("click", () => start().catch((error) => reportError(error)));
start().catch((error) => reportError(error));

async function start() {
	setStatus("Connecting…", "warn");
	cleanupCurrentConnection();
	const config = await json(`/pi-realtime/openai/${encodeURIComponent(providerSessionId)}/config`);
	const secret = await json(`/pi-realtime/openai/${encodeURIComponent(providerSessionId)}/client-secret`, { method: "POST" });
	const pc = new RTCPeerConnection();
	currentPc = pc;
	pc.ontrack = (event) => { remoteAudio.srcObject = event.streams[0]; };
	pc.onconnectionstatechange = () => log(`peer: ${pc.connectionState}`);
	const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: { ideal: true }, noiseSuppression: { ideal: true }, autoGainControl: { ideal: true }, channelCount: { ideal: 1 } } });
	currentStream = stream;
	for (const track of stream.getAudioTracks()) {
		logAudioSettings(track);
		pc.addTrack(track, stream);
	}
	dc = pc.createDataChannel("oai-events");
	dc.addEventListener("open", () => {
		setStatus(`Connected: ${config.providerSessionId}`, "status");
		postEvent({ type: "connected" });
		sendContext(config.initialContext);
		pollTimer = setInterval(() => pollOutbox().catch((error) => log(`poll failed: ${error.message}`)), 250);
	});
	dc.addEventListener("message", (event) => handleRealtimeEvent(JSON.parse(event.data)));
	dc.addEventListener("close", () => postEvent({ type: "disconnected", reason: "data channel closed" }));
	const offer = await pc.createOffer();
	await pc.setLocalDescription(offer);
	const answerSdp = await fetch("https://api.openai.com/v1/realtime/calls", { method: "POST", body: offer.sdp, headers: { authorization: `Bearer ${secret.value}`, "content-type": "application/sdp" } }).then(async (response) => {
		if (!response.ok) throw new Error(`OpenAI WebRTC calls offer failed: ${response.status} ${await response.text()}`);
		return response.text();
	});
	await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
}

function cleanupCurrentConnection() {
	clearInterval(pollTimer);
	pollTimer = undefined;
	if (dc) dc.close();
	if (currentPc) currentPc.close();
	if (currentStream) for (const track of currentStream.getTracks()) track.stop();
	dc = undefined;
	currentPc = undefined;
	currentStream = undefined;
	remoteAudio.srcObject = null;
}

function logAudioSettings(track) {
	const settings = track.getSettings ? track.getSettings() : {};
	log(`mic settings: echoCancellation=${String(settings.echoCancellation)} noiseSuppression=${String(settings.noiseSuppression)} autoGainControl=${String(settings.autoGainControl)} device=${settings.deviceId ? "set" : "unknown"}`);
	if (settings.echoCancellation !== true) log("WARNING: browser did not confirm echoCancellation=true; use headphones or select a browser/device that supports AEC.");
	if (settings.noiseSuppression !== true) log("WARNING: browser did not confirm noiseSuppression=true.");
	if (settings.autoGainControl !== true) log("WARNING: browser did not confirm autoGainControl=true.");
}

function handleRealtimeEvent(event) {
	if (event.type === "response.function_call_arguments.done") return postEvent({ type: "tool_call", providerEventId: event.event_id, call: { voiceToolCallId: event.call_id, providerToolCallId: event.call_id, name: event.name, arguments: parseArgs(event.arguments) } });
	if (event.type === "conversation.item.input_audio_transcription.completed") {
		logUsage("input transcription", event.usage);
		postEvent({ type: "usage", source: "input_transcription", providerEventId: event.event_id, realtimeEvent: event }).catch((error) => log(`usage post failed: ${error.message}`));
		return postEvent({ type: "user_transcript", providerEventId: event.event_id, text: event.transcript || "", final: true });
	}
	if (event.type === "response.output_audio_transcript.done") return postEvent({ type: "assistant_transcript", providerEventId: event.event_id, text: event.transcript || "", final: true });
	if (event.type === "response.output_text.done") return postEvent({ type: "assistant_transcript", providerEventId: event.event_id, text: event.text || "", final: true });
	if (event.type === "input_audio_buffer.speech_started") return postEvent({ type: "turn_signal", providerEventId: event.event_id, signal: "speech_started" });
	if (event.type === "input_audio_buffer.speech_stopped") return postEvent({ type: "turn_signal", providerEventId: event.event_id, signal: "speech_stopped" });
	if (event.type === "response.done") {
		logUsage("response", event.response?.usage);
		postEvent({ type: "usage", source: "response", providerEventId: event.event_id, realtimeEvent: event }).catch((error) => log(`usage post failed: ${error.message}`));
		return postEvent({ type: "turn_signal", providerEventId: event.event_id, signal: "turn_complete" });
	}
	if (event.type === "error") return postEvent({ type: "error", providerEventId: event.event_id, message: event.error?.message || "OpenAI realtime error", recoverable: true });
}

async function pollOutbox() {
	if (!dc || dc.readyState !== "open") return;
	const result = await json(`/pi-realtime/openai/${encodeURIComponent(providerSessionId)}/outbox?after=${lastOutboxId}`);
	for (const item of result.events || []) {
		lastOutboxId = Math.max(lastOutboxId, item.id);
		dc.send(JSON.stringify(item.event));
	}
}

function sendContext(packet) {
	sendRealtime({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: `[pi-realtime:${packet.channel}:rev-${packet.revision}] ${packet.summary}\n\n${packet.sections.map((section) => `${section.title}\n${section.text}`).join("\n\n")}` }] } });
}

function sendRealtime(event) {
	if (!dc || dc.readyState !== "open") return;
	dc.send(JSON.stringify(event));
}

async function postEvent(event) {
	log(event.type);
	await json(`/pi-realtime/openai/${encodeURIComponent(providerSessionId)}/event`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) });
}

async function json(url, options) {
	const response = await fetch(url, options);
	if (!response.ok) throw new Error(`${url} failed: ${response.status} ${await response.text()}`);
	return response.json();
}

function logUsage(label, usage) {
	if (!usage) return;
	const input = usage.input_token_details || {};
	const output = usage.output_token_details || {};
	log(`usage ${label}: total=${usage.total_tokens || 0} input(text=${input.text_tokens || 0},audio=${input.audio_tokens || 0},cached=${input.cached_tokens || 0}) output(text=${output.text_tokens || 0},audio=${output.audio_tokens || 0})`);
}

function parseArgs(raw) {
	try {
		const parsed = JSON.parse(raw || "{}");
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function reportError(error) {
	setStatus(error.message, "err");
	postEvent({ type: "error", message: error.message, recoverable: true }).catch(() => undefined);
}

function setStatus(text, className) {
	statusEl.textContent = text;
	statusEl.className = className;
	log(text);
}

function log(text) {
	logEl.textContent = `${new Date().toLocaleTimeString()} ${text}\n${logEl.textContent}`.slice(0, 5000);
}
