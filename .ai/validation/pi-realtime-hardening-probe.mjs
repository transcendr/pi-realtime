#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runtime = readFileSync(".pi/extensions/pi-realtime/runtime.ts", "utf8");
const store = readFileSync(".pi/extensions/pi-realtime/store.ts", "utf8");
const context = readFileSync(".pi/extensions/pi-realtime/context.ts", "utf8");
const commands = readFileSync(".pi/extensions/pi-realtime/commands.ts", "utf8");
const service = readFileSync(".pi/extensions/pi-realtime/service.ts", "utf8");

for (const event of ["session_start", "session_tree", "session_compact", "context", "session_shutdown"]) assert.match(runtime, new RegExp(`pi\\.on\\("${event}"`));
assert.match(store, /ctx\.sessionManager\.getBranch\(\)/);
assert.doesNotMatch(store, /getEntries\(\)/);
assert.match(context, /filterRealtimeContextMessages/);
assert.match(context, /CUSTOM_MESSAGE_TYPE/);
assert.match(context, /isActiveProviderSession/);
assert.match(service, /disconnect\(reason === "shutdown"/);
assert.match(commands, /parseJsonObject/);
assert.match(commands, /openai text/);
assert.match(commands, /sendTextInput/);
assert.match(commands, /Tool arguments must be a JSON object/);
for (const forbidden of ["confirm(", "select(", "input(", "editor("]) assert.equal(commands.includes(forbidden), false);

function filter(messages, activeProviderSessionId, lastInstructionId) {
  return messages.filter((message) => {
    if (message.role !== "custom" || message.customType !== "pi-realtime.context") return true;
    if (message.details?.providerSessionId && message.details.providerSessionId !== activeProviderSessionId) return false;
    if (message.details?.instructionId && message.details.instructionId !== lastInstructionId) return false;
    return true;
  });
}

const kept = filter([
  { role: "custom", customType: "other", details: { providerSessionId: "old" } },
  { role: "custom", customType: "pi-realtime.context", details: { providerSessionId: "active", instructionId: "i2" } },
  { role: "custom", customType: "pi-realtime.context", details: { providerSessionId: "old", instructionId: "i1" } },
], "active", "i2");
assert.equal(kept.length, 2);
assert.equal(kept[1].details.providerSessionId, "active");
console.log("PASS pi-realtime lifecycle/context hardening probe");
