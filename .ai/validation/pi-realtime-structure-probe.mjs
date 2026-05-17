#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runtime = readFileSync(".pi/extensions/pi-realtime/runtime.ts", "utf8");
const store = readFileSync(".pi/extensions/pi-realtime/store.ts", "utf8");
assert.match(runtime, /session_start/);
assert.match(runtime, /session_tree/);
assert.match(runtime, /session_compact/);
assert.match(runtime, /session_shutdown/);
assert.match(store, /appendEntry/);
assert.match(store, /getBranch\(\)/);
console.log("PASS pi-realtime structure probe");
