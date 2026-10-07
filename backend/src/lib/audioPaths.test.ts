import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isOwnedOneOnOnePath, isOwnedTeamNotePath } from "./audioPaths.js";

const OO = "11111111-1111-1111-1111-111111111111";
const ME = "22222222-2222-2222-2222-222222222222";
const OTHER = "33333333-3333-3333-3333-333333333333";

describe("isOwnedOneOnOnePath", () => {
  it("accepts the path the frontend writes", () => {
    assert.ok(isOwnedOneOnOnePath(`one-on-ones/${OO}/${ME}/1760000000000.webm`, OO, ME));
    assert.ok(isOwnedOneOnOnePath(`one-on-ones/${OO}/${ME}/1760000000000.m4a`, OO, ME));
  });
  it("rejects another user's folder, another 1:1, traversal and odd shapes", () => {
    assert.ok(!isOwnedOneOnOnePath(`one-on-ones/${OO}/${OTHER}/1760000000000.webm`, OO, ME));
    assert.ok(!isOwnedOneOnOnePath(`one-on-ones/${OTHER}/${ME}/1760000000000.webm`, OO, ME));
    assert.ok(!isOwnedOneOnOnePath(`one-on-ones/${OO}/${ME}/../${OTHER}/1760000000000.webm`, OO, ME));
    assert.ok(!isOwnedOneOnOnePath(`team-notes/startup/${OO}/${ME}/1760000000000.webm`, OO, ME));
    assert.ok(!isOwnedOneOnOnePath(`one-on-ones/${OO}/${ME}/x.exe`, OO, ME));
    assert.ok(!isOwnedOneOnOnePath(`one-on-ones/${OO}/${ME}/1760000000000.webm`, OO, ""));
  });
});

describe("isOwnedTeamNotePath", () => {
  it("accepts own team-notes path for the declared target", () => {
    assert.ok(isOwnedTeamNotePath(`team-notes/startup/${OO}/${ME}/1760000000000.webm`, "startup", OO, ME));
  });
  it("rejects a different target, owner or type", () => {
    assert.ok(!isOwnedTeamNotePath(`team-notes/startup/${OO}/${ME}/1760000000000.webm`, "founder", OO, ME));
    assert.ok(!isOwnedTeamNotePath(`team-notes/startup/${OO}/${ME}/1760000000000.webm`, "startup", OTHER, ME));
    assert.ok(!isOwnedTeamNotePath(`team-notes/startup/${OO}/${OTHER}/1760000000000.webm`, "startup", OO, ME));
    assert.ok(!isOwnedTeamNotePath(`team-notes/other/${OO}/${ME}/1760000000000.webm`, "other", OO, ME));
  });
});
