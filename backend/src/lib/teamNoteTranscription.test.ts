import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_NOTE_TRANSCRIPTION_ATTEMPTS,
  audioFileNameFor,
  classifyOpenAiFailure,
  decideFailureOutcome,
  hasKnownAudioContainer,
} from "./teamNoteTranscription.js";

const buf = (...bytes: number[]) => new Uint8Array([...bytes, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer;

test("recognises the containers MediaRecorder produces", () => {
  assert.equal(hasKnownAudioContainer(buf(0x1a, 0x45, 0xdf, 0xa3)), true); // webm
  assert.equal(hasKnownAudioContainer(buf(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70)), true); // mp4/m4a
  assert.equal(hasKnownAudioContainer(buf(0x4f, 0x67, 0x67, 0x53)), true); // ogg (Firefox)
  assert.equal(hasKnownAudioContainer(buf(0x52, 0x49, 0x46, 0x46)), true); // wav
  assert.equal(hasKnownAudioContainer(buf(0x49, 0x44, 0x33)), true); // mp3 (ID3)
});

test("rejects a recording that lost its first chunk (the real corrupted files)", () => {
  assert.equal(hasKnownAudioContainer(buf(0x43, 0xc3, 0x81, 0x02)), false);
  assert.equal(hasKnownAudioContainer(buf(0x43, 0xc3, 0x81, 0x03)), false);
  assert.equal(hasKnownAudioContainer(new ArrayBuffer(0)), false);
});

test("file name extension follows the container", () => {
  assert.equal(audioFileNameFor("n", "audio/webm"), "n.webm");
  assert.equal(audioFileNameFor("n", "audio/mp4"), "n.m4a");
  assert.equal(audioFileNameFor("n", "audio/ogg"), "n.ogg");
  assert.equal(audioFileNameFor("n", ""), "n.webm");
});

test("only audio-specific rejections are permanent; config/auth/capacity are never the note's fault", () => {
  assert.equal(classifyOpenAiFailure(400, "Audio file might be corrupted or unsupported"), "permanent");
  assert.equal(classifyOpenAiFailure(413, "too big"), "permanent");
  assert.equal(classifyOpenAiFailure(400, "Invalid value: 'gpt-x' is not a supported model"), "infra");
  assert.equal(classifyOpenAiFailure(404, "model not found"), "infra");
  assert.equal(classifyOpenAiFailure(401, "bad key"), "infra");
  assert.equal(classifyOpenAiFailure(429, "rate limit"), "infra");
  assert.equal(classifyOpenAiFailure(503, "overloaded"), "infra");
});

test("permanent failures fail the note immediately and keep the message", () => {
  const out = decideFailureOutcome("permanent", "Empty transcription result", null);
  assert.deepEqual(out, { status: "failed", transcript_error: "Empty transcription result" });
});

test("infra failures retry forever and never consume attempts", () => {
  let err: string | null = null;
  for (let i = 0; i < 50; i += 1) {
    const out = decideFailureOutcome("infra", "rate limit", err);
    assert.equal(out.status, "uploaded");
    err = out.transcript_error;
  }
  assert.match(err as string, /^\[intento 0\//);
});

test("note-specific failures are capped at MAX attempts, then fail", () => {
  let err: string | null = null;
  let status = "uploaded";
  let runs = 0;
  while (status === "uploaded" && runs < 20) {
    const out = decideFailureOutcome("note", "download failed", err);
    status = out.status;
    err = out.transcript_error;
    runs += 1;
  }
  assert.equal(status, "failed");
  assert.equal(runs, MAX_NOTE_TRANSCRIPTION_ATTEMPTS);
  assert.equal(err, "download failed");
});
