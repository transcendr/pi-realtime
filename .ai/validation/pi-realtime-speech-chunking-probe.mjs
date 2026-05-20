#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const source = readFileSync(".pi/extensions/pi-realtime/domain/speech-chunking.ts", "utf8");
assert.match(source, /function chunkBackendUpdateSpeech/);
assert.match(source, /COMMON_ABBREVIATIONS/);
assert.match(source, /isProtectedPeriod/);
assert.match(source, /splitByLines/);
assert.match(source, /splitBySyntaxDelimiters/);
assert.match(source, /hardSplit/);

const tempDir = mkdtempSync(join(tmpdir(), "pi-realtime-chunking-"));
const compiled = join(tempDir, "domain", "speech-chunking.js");
execFileSync("npx", ["tsc", ".pi/extensions/pi-realtime/domain/speech-chunking.ts", "--ignoreConfig", "--target", "ES2022", "--module", "commonjs", "--skipLibCheck", "--outDir", tempDir], { stdio: "inherit" });
const moduleSource = readFileSync(compiled, "utf8").replace(/require\("\.\.\/types"\);?\n?/g, "");
writeFileSync(compiled, moduleSource);
const { chunkBackendUpdateSpeech } = await import(`file://${compiled}`);

function chunk(text, maxChars = 80) {
  return chunkBackendUpdateSpeech({ text, policy: { enabled: true, maxChars, splitStrategy: "sentence" } });
}

function joined(chunks) {
  return chunks.map((item) => item.text).join("");
}

function assertChunkShape(chunks, original) {
  assert.ok(chunks.length > 0);
  chunks.forEach((item, index) => {
    assert.equal(item.index, index + 1);
    assert.equal(item.count, chunks.length);
    assert.equal(item.originalTextLength, original.trim().length);
    assert.ok(item.text.length > 0);
  });
}

{
  const text = "Short status.";
  const chunks = chunkBackendUpdateSpeech({ text, policy: { enabled: false, maxChars: 5, splitStrategy: "sentence" } });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].text, text);
}

{
  const text = "First sentence. Second sentence. Third sentence.";
  const chunks = chunk(text, 32);
  assertChunkShape(chunks, text);
  assert.equal(joined(chunks), text);
  assert.ok(chunks.every((item) => item.text.length <= 32));
}

{
  const text = "We updated v0.1.0 in .pi/extensions/foo.ts, e.g. the path src/main.ts and cost $0.079741. Next sentence.";
  const chunks = chunk(text, 90);
  assertChunkShape(chunks, text);
  assert.equal(joined(chunks), text);
  assert.ok(chunks.some((item) => item.text.includes("v0.1.0")));
  assert.ok(chunks.some((item) => item.text.includes(".pi/extensions/foo.ts")));
  assert.ok(chunks.some((item) => item.text.includes("e.g.")));
  assert.ok(chunks.some((item) => item.text.includes("src/main.ts")));
  assert.ok(chunks.some((item) => item.text.includes("$0.079741")));
}

{
  const text = "- first item without final punctuation\n- second item with src/main.ts\n- third item with v0.1.0\n";
  const chunks = chunk(text, 36);
  assertChunkShape(chunks, text);
  assert.equal(joined(chunks), text.trim());
  assert.ok(chunks.every((item) => item.text.length <= 36));
}

{
  const text = "Error: failure without sentence boundary\n    at run (/tmp/src/main.ts:1:2)\n    at next (/tmp/src/next.ts:3:4)\n";
  const chunks = chunk(text, 42);
  assertChunkShape(chunks, text);
  assert.equal(joined(chunks), text.trim());
  assert.ok(chunks.every((item) => item.text.length <= 42));
}

{
  const text = "alpha,beta,gamma,delta,epsilon,zeta,eta,theta,iota,kappa,lambda,mu";
  const chunks = chunk(text, 18);
  assertChunkShape(chunks, text);
  assert.equal(joined(chunks), text);
  assert.ok(chunks.every((item) => item.text.length <= 18));
}

{
  const text = "x".repeat(55);
  const chunks = chunk(text, 20);
  assertChunkShape(chunks, text);
  assert.equal(joined(chunks), text);
  assert.ok(chunks.every((item) => item.text.length <= 20));
}

console.log("PASS pi-realtime speech chunking probe");
