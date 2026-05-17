#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packetSource = readFileSync(".pi/extensions/pi-realtime/state-packets.ts", "utf8");
const serviceSource = readFileSync(".pi/extensions/pi-realtime/service.ts", "utf8");

assert.match(packetSource, /buildCitationDeckFromBranch/);
assert.match(packetSource, /pinotator\.citations/);
assert.match(packetSource, /display_ref/);
assert.match(packetSource, /alias/);
assert.match(packetSource, /citationId/);
assert.match(serviceSource, /pinotator_citation_resolve/);
assert.match(serviceSource, /resolveCitation/);

function parse(content) {
  const regex = /<pinotator_citation\s+([^>]*)>([\s\S]*?)<\/pinotator_citation>/g;
  const items = [];
  let match;
  while ((match = regex.exec(content))) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([a-zA-Z_:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    items.push({ displayRef: attrs.display_ref, alias: attrs.alias, citationId: attrs.id, snippet: match[2].trim() });
  }
  return items;
}
function revision(items) {
  let hash = 0;
  for (const item of items) for (const ch of item.citationId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash || 1;
}
function resolve(items, ref) {
  return items.find((item) => item.displayRef === ref || item.alias === ref || item.citationId === ref || item.displayRef === `[${ref}]`);
}

const deck1 = parse('<pinotator_citation display_ref="[1]" alias="@p1" id="cit_a" origin="transcript" source="assistant/message/raw_exact">Alpha</pinotator_citation>');
const deck2 = parse('<pinotator_citation display_ref="[1]" alias="@p1" id="cit_a" origin="transcript" source="assistant/message/raw_exact">Alpha</pinotator_citation><pinotator_citation display_ref="[2]" alias="@p2" id="cit_b" origin="manual" source="manual">Beta</pinotator_citation>');
assert.equal(resolve(deck1, "[1]").citationId, "cit_a");
assert.equal(resolve(deck1, "@p1").citationId, "cit_a");
assert.equal(resolve(deck1, "1").citationId, "cit_a");
assert.notEqual(revision(deck1), revision(deck2));
console.log("PASS pi-realtime Pinotator citation deck revision probe");
