#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packetSource = readFileSync(".pi/extensions/pi-realtime/state-packets.ts", "utf8");
const promptSource = readFileSync(".pi/extensions/pi-realtime/prompt.ts", "utf8");
const controlPlaneSource = readFileSync(".pi/extensions/pi-realtime/control-plane.ts", "utf8");

for (const name of ["buildStatePacket", "buildCitationPacket", "buildToolSurfacePacket", "nextContextRevision", "buildCitationDeckFromBranch", "renderCitationDeck"]) assert.match(packetSource, new RegExp(`function ${name}`));
for (const tool of ["pi_state_snapshot", "pi_send_instruction", "pi_wait_for_update", "pi_realtime_status", "pinotator_citations_list", "pinotator_citation_resolve"]) assert.match(promptSource, new RegExp(tool));
assert.match(promptSource, /Never invent durable coding tasks/);
assert.match(promptSource, /latest final user utterance explicitly asks/);
assert.match(promptSource, /greetings, unclear audio, silence, background speech, or possible speaker echo/);
assert.match(controlPlaneSource, /delivery === "immediate"/);
assert.match(controlPlaneSource, /deliverAs: delivery/);

function nextContextRevision(state, providerSessionId, channel) {
  return (state.contextRevisions.get(providerSessionId)?.[channel] ?? 0) + 1;
}
const state = { contextRevisions: new Map([["openai_1", { pi_state: 3, citations: 8 }]]) };
assert.equal(nextContextRevision(state, "openai_1", "pi_state"), 4);
assert.equal(nextContextRevision(state, "openai_1", "citations"), 9);
assert.equal(nextContextRevision(state, "gemini_1", "pi_state"), 1);

const citationXml = '<pinotator_citation display_ref="[1]" alias="@p1" id="cit_abc" origin="transcript" source="assistant/message/raw_exact">Example &amp; citation</pinotator_citation>';
assert.match(citationXml, /display_ref="\[1\]"/);
assert.match(citationXml, /alias="@p1"/);
assert.match(citationXml, /id="cit_abc"/);
console.log("PASS pi-realtime context packet/citation contract probe");
