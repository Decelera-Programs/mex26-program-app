import assert from "node:assert/strict";
import { test } from "node:test";
import { canSeeOnePager, resolveOnePager } from "./onePager.js";

const sign = async (path: string) => `https://signed.example/${path}?t=1`;
const failingSign = async () => {
  throw new Error("boom");
};

test("founders, guests and unknown people never get a one pager", async () => {
  for (const person of [
    { contact_type: "founder" },
    { contact_type: "Founder", is_team: false },
    { contact_type: "guest" },
    { contact_type: null },
    {},
    null,
    undefined,
  ]) {
    assert.equal(canSeeOnePager(person), false);
    const res = await resolveOnePager({ person, storedPath: "mex26/v2/Xoul.pdf", sign });
    assert.equal(res.status, 403);
    assert.ok(!JSON.stringify(res.body).includes("signed.example"));
  }
});

test("experience makers, VCs and team get a signed URL", async () => {
  for (const person of [
    { contact_type: "experience_maker" },
    { contact_type: "Experience Maker" },
    { contact_type: "experiencemaker" },
    { contact_type: "vc" },
    { contact_type: "team" },
    { contact_type: "founder", is_team: true },
  ]) {
    const res = await resolveOnePager({ person, storedPath: "mex26/v2/Xoul.pdf", sign });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { url: "https://signed.example/mex26/v2/Xoul.pdf?t=1" });
  }
});

test("missing path -> 404; stored URLs are never handed out", async () => {
  const person = { contact_type: "vc" };
  for (const storedPath of [null, undefined, "", "  ", "https://example.com/x.pdf", "HTTP://example.com/x.pdf"]) {
    const res = await resolveOnePager({ person, storedPath, sign });
    assert.equal(res.status, 404);
  }
});

test("signing failures degrade to 500 without throwing", async () => {
  const person = { contact_type: "vc" };
  assert.equal((await resolveOnePager({ person, storedPath: "a.pdf", sign: failingSign })).status, 500);
  assert.equal((await resolveOnePager({ person, storedPath: "a.pdf", sign: async () => null })).status, 500);
});
