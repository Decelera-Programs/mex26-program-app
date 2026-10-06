import assert from "node:assert/strict";
import { test } from "node:test";
import {
  answeredEventIds,
  isRateable,
  isTalkType,
  isValidRating,
  parseFeedbackBody,
  pendingTalks,
  type FeedbackEvent,
} from "./talkFeedback.js";

const NOW = new Date("2026-10-10T18:00:00Z");
const at = (iso: string) => new Date(iso);
const ev = (id: string, type: string, start: string, end: string): FeedbackEvent => ({
  id,
  title: id,
  type,
  start_time: at(start),
  end_time: at(end),
});
const everyone = () => true;

test("only talks, talks and panels count as talks", () => {
  for (const t of ["talk", "Talk", "talks", " panel "]) assert.equal(isTalkType(t), true);
  for (const t of ["meal", "activity", "wellness", "", null, undefined]) assert.equal(isTalkType(t), false);
});

test("ratings must be integers from 1 to 10", () => {
  for (const r of [1, 5, 10]) assert.equal(isValidRating(r), true);
  for (const r of [0, 11, -1, 5.5, "7", null, undefined, NaN]) assert.equal(isValidRating(r), false);
});

test("answered ids come from the jsonb keys and tolerate bad shapes", () => {
  assert.deepEqual([...answeredEventIds({ a: 8, b: 3 })].sort(), ["a", "b"]);
  for (const bad of [null, undefined, [], "x", 3]) assert.equal(answeredEventIds(bad).size, 0);
});

test("body is either a valid rating or an explicit didn't-watch, never both or neither", () => {
  assert.deepEqual(parseFeedbackBody({ rating: 8 }), { ok: true, value: 8 });
  assert.deepEqual(parseFeedbackBody({ didnt_watch: true }), { ok: true, value: null });
  const bad = [{}, null, undefined, "x", { rating: 11 }, { rating: 0 }, { didnt_watch: false }, { didnt_watch: "true" }, { rating: 5, didnt_watch: true }, { rating: null }];
  for (const b of bad) assert.deepEqual(parseFeedbackBody(b), { ok: false });
});

test("a skipped talk (null) still counts as answered and is not asked again", () => {
  const t1 = ev("t1", "talk", "2026-10-10T09:00:00Z", "2026-10-10T10:00:00Z");
  assert.deepEqual(pendingTalks([t1], { t1: null }, NOW, everyone), []);
});

test("a talk is only rateable once it has ended", () => {
  const ended = ev("ended", "talk", "2026-10-10T16:00:00Z", "2026-10-10T17:00:00Z");
  const running = ev("running", "talk", "2026-10-10T17:30:00Z", "2026-10-10T18:30:00Z");
  const endsExactlyNow = ev("now", "talk", "2026-10-10T17:00:00Z", "2026-10-10T18:00:00Z");
  assert.equal(isRateable(ended, NOW, everyone), true);
  assert.equal(isRateable(running, NOW, everyone), false);
  assert.equal(isRateable(endsExactlyNow, NOW, everyone), true);
});

test("non-talks and hidden talks are never asked", () => {
  const meal = ev("meal", "meal", "2026-10-10T10:00:00Z", "2026-10-10T11:00:00Z");
  const hidden = ev("hidden", "talk", "2026-10-10T10:00:00Z", "2026-10-10T11:00:00Z");
  assert.deepEqual(pendingTalks([meal, hidden], null, NOW, (e) => e.id !== "hidden"), []);
});

test("pending talks are the ended, unanswered ones, oldest first", () => {
  const t1 = ev("t1", "talk", "2026-10-10T09:00:00Z", "2026-10-10T10:00:00Z");
  const t2 = ev("t2", "talk", "2026-10-10T11:00:00Z", "2026-10-10T12:00:00Z");
  const t3 = ev("t3", "panel", "2026-10-10T13:00:00Z", "2026-10-10T14:00:00Z");
  const future = ev("future", "talk", "2026-10-10T19:00:00Z", "2026-10-10T20:00:00Z");
  const shuffled = [t3, future, t1, t2];

  assert.deepEqual(pendingTalks(shuffled, null, NOW, everyone).map((e) => e.id), ["t1", "t2", "t3"]);
  // answering one removes only that one; answered ones never come back
  assert.deepEqual(pendingTalks(shuffled, { t1: 9 }, NOW, everyone).map((e) => e.id), ["t2", "t3"]);
  assert.deepEqual(pendingTalks(shuffled, { t1: 9, t2: 4, t3: 10 }, NOW, everyone), []);
});
