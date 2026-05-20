const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const startButton = document.getElementById("start");
const remoteAudio = document.getElementById("remote");
const providerSessionId = decodeURIComponent(location.pathname.split("/").pop() || "");
const outboxPollTracer = createOutboxPollTracer();
let dc;
let currentPc;
let currentStream;
let lastOutboxId = 0;
let pollTimer;
let pollInFlight = false;
let interactionConfig;

function outboxCursorStorageKey() {
	return `pi-realtime:${providerSessionId}:lastOutboxId`;
}

startButton.addEventListener("click", () => start().catch((error) => reportError(error)));
start().catch((error) => reportError(error));

async function start() {
	setStatus("Connecting…", "warn");
	cleanupCurrentConnection();
	const config = await json(`/pi-realtime/openai/${encodeURIComponent(providerSessionId)}/config`);
	interactionConfig = config.interaction;
	lastOutboxId = initialOutboxCursor(config);
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
		log(`debug trace: ${config.debugTracePath || "not configured"}`);
		postEvent({ type: "connected" });
		sendContext(config.initialContext);
		pollTimer = setInterval(() => pollOutbox().catch((error) => log(`poll failed: ${error.message}`)), 250);
	});
	dc.addEventListener("message", (event) => {
		trace("openai_inbound_raw", { bytes: event.data.length });
		handleRealtimeEvent(JSON.parse(event.data));
	});
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
	traceRealtimeEvent("openai_inbound", event);
	if (event.type === "response.function_call_arguments.done") return postEvent({ type: "tool_call", providerEventId: event.event_id, call: { voiceToolCallId: event.call_id, providerToolCallId: event.call_id, name: event.name, arguments: parseArgs(event.arguments) } });
	if (event.type === "conversation.item.input_audio_transcription.completed") return handleInputAudioTranscription(event);
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
	if (!dc || dc.readyState !== "open" || pollInFlight) return;
	pollInFlight = true;
	try {
		const after = lastOutboxId;
		const result = await json(`/pi-realtime/openai/${encodeURIComponent(providerSessionId)}/outbox?after=${after}`);
		const returnedIds = (result.events || []).map((item) => item.id);
		outboxPollTracer.record(after, returnedIds);
		for (const item of result.events || []) {
			lastOutboxId = Math.max(lastOutboxId, item.id);
			storeOutboxCursor(lastOutboxId);
			traceRealtimeEvent("openai_outbound_from_outbox", item.event, { outboxId: item.id });
			dc.send(JSON.stringify(item.event));
			postEvent({ type: "outbox_ack", outboxId: item.id }, { log: false }).catch((error) => log(`outbox ack failed: ${error.message}`));
		}
	} finally {
		pollInFlight = false;
	}
}

function initialOutboxCursor(config) {
	const persisted = Number(sessionStorage.getItem(outboxCursorStorageKey()) || "0");
	const server = Number(config.resumeOutboxAfter || 0);
	const cursor = Math.max(Number.isFinite(persisted) ? persisted : 0, Number.isFinite(server) ? server : 0);
	storeOutboxCursor(cursor);
	return cursor;
}

function storeOutboxCursor(value) {
	sessionStorage.setItem(outboxCursorStorageKey(), String(value));
}

function sendContext(packet) {
	sendRealtime({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text: `[pi-realtime:${packet.channel}:rev-${packet.revision}] ${packet.summary}\n\n${packet.sections.map((section) => `${section.title}\n${section.text}`).join("\n\n")}` }] } });
}

function handleInputAudioTranscription(event) {
	const transcript = event.transcript || "";
	logUsage("input transcription", event.usage);
	postEvent({ type: "usage", source: "input_transcription", providerEventId: event.event_id, realtimeEvent: event }).catch((error) => log(`usage post failed: ${error.message}`));
	postEvent({ type: "user_transcript", providerEventId: event.event_id, text: transcript, final: true }).catch((error) => log(`transcript post failed: ${error.message}`));
	if (!transcript.trim()) {
		trace("response_suppressed", { reason: "empty_transcript", providerEventId: event.event_id, itemId: event.item_id, transcriptTextLength: transcript.length });
		return;
	}
	if (!isTranscriptActionable(transcript)) {
		trace("response_suppressed", { reason: "low_information_transcript", providerEventId: event.event_id, itemId: event.item_id, transcriptTextLength: transcript.length, lexicalLength: lexicalContentLength(transcript) });
		return;
	}
	if (interactionConfig?.transcriptHandling?.response === "suppress") {
		trace("response_suppressed", { reason: "direct_transcript_policy", providerEventId: event.event_id, itemId: event.item_id, transcriptTextLength: transcript.length, lexicalLength: lexicalContentLength(transcript) });
		return;
	}
	requestResponse("valid_transcript", event.event_id);
}

function isTranscriptActionable(transcript) {
	return lexicalContentLength(transcript) >= 4;
}

function lexicalContentLength(transcript) {
	return transcript.replace(/[\s\p{P}\p{S}]/gu, "").length;
}

function requestResponse(reason, providerEventId) {
	sendRealtime({ type: "response.create", response: { output_modalities: ["audio"] } }, { label: "openai_outbound_response_create", reason, providerEventId });
}

function sendRealtime(event, traceOptions = {}) {
	if (!dc || dc.readyState !== "open") return;
	const { label = "openai_outbound_direct", ...extra } = traceOptions;
	traceRealtimeEvent(label, event, extra);
	dc.send(JSON.stringify(event));
}

async function postEvent(event, options = {}) {
	if (options.log !== false) log(event.type);
	await json(`/pi-realtime/openai/${encodeURIComponent(providerSessionId)}/event`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) });
}

async function json(url, options) {
	const response = await fetch(url, options);
	if (!response.ok) throw new Error(`${url} failed: ${response.status} ${await response.text()}`);
	return response.json();
}

function trace(label, data = {}) {
	postEvent({ type: "trace", trace: { label, ...data } }, { log: false }).catch((error) => log(`trace post failed: ${error.message}`));
}

function traceRealtimeEvent(label, event, extra = {}) {
	trace(label, { ...extra, ...describeRealtimeEvent(event) });
}

function createOutboxPollTracer() {
	const emptyPollTraceInterval = 40;
	let emptyCount = 0;
	let emptySinceAt;
	return {
		record(after, returnedIds) {
			const now = Date.now();
			if (returnedIds.length > 0) {
				trace("outbox_poll", { after, returnedIds, emptyPollsBeforeResult: emptyCount, emptySinceAt });
				emptyCount = 0;
				emptySinceAt = undefined;
				return;
			}
			emptySinceAt ??= now;
			emptyCount += 1;
			if (emptyCount === 1 || emptyCount % emptyPollTraceInterval === 0) trace("outbox_poll_idle", { after, emptyPolls: emptyCount, emptySinceAt, lastAt: now });
		},
	};
}

function describeRealtimeEvent(event) {
	const description = { summary: summarizeRealtimeEvent(event) };
	addTextDetails(description, "content", contentText(event));
	addTextDetails(description, "transcript", transcriptText(event));
	addTextDetails(description, "text", outputText(event));
	addTextDetails(description, "functionArguments", typeof event.arguments === "string" ? event.arguments : undefined);
	const message = event.error?.message || (typeof event.message === "string" ? event.message : undefined);
	if (message !== undefined) description.message = message;
	return description;
}

function summarizeRealtimeEvent(event) {
	return {
		type: event.type,
		eventId: event.event_id,
		responseId: event.response?.id || event.response_id,
		itemId: event.item?.id || event.item_id,
		callId: event.call_id,
		name: event.name,
		itemType: event.item?.type,
		role: event.item?.role,
		contentTypes: Array.isArray(event.item?.content) ? event.item.content.map((part) => part?.type).filter(Boolean) : undefined,
	};
}

function addTextDetails(target, prefix, text) {
	if (text === undefined) return;
	target[`${prefix}Text`] = text;
	target[`${prefix}TextLength`] = text.length;
}

function contentText(event) {
	const content = Array.isArray(event.item?.content) ? event.item.content : undefined;
	const parts = content?.flatMap((part) => {
		const text = typeof part?.text === "string" ? part.text : typeof part?.transcript === "string" ? part.transcript : undefined;
		return text === undefined ? [] : [text];
	}) ?? [];
	return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function transcriptText(event) {
	if (event.type === "conversation.item.input_audio_transcription.completed") return event.transcript || "";
	if (event.type === "response.output_audio_transcript.done") return event.transcript || "";
	return undefined;
}

function outputText(event) {
	return event.type === "response.output_text.done" ? event.text || "" : undefined;
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
