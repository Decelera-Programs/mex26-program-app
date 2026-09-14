import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  scoreCandidates,
  assignFoundersToEms,
  MATCH_WEIGHT_CHALLENGE,
  MATCH_WEIGHT_DIRECT_TAG,
  type MatchCandidatePerson,
  type MatchEdge,
} from "./matchingJob.js";

// Minimal, type-correct fixture builder — only the fields a given test cares
// about need overriding, everything else defaults to an inert value.
function person(overrides: Partial<MatchCandidatePerson> & { id: string }): MatchCandidatePerson {
  return {
    full_name: overrides.id,
    bio: null,
    tagline: null,
    photo_url: null,
    contact_type: null,
    company_name: null,
    expertise_tags: [],
    embedding: null,
    startup_id: null,
    arrival_date: null,
    departure_date: null,
    startup: null,
    ...overrides,
  };
}

// Shaped like a real Startup.challenges row: one section, one rated question.
function challengesWithSection(section: string, severity: number) {
  return {
    sections: {
      [section]: {
        ratings: { "Some question": `${severity} — whatever` },
      },
    },
  };
}

describe("scoreCandidates", () => {
  it("awards MATCH_WEIGHT_CHALLENGE per EM tag that matches the founder's worst challenge section", () => {
    const founder = person({
      id: "f1",
      startup_id: "s1",
      startup: {
        id: "s1",
        name: "Startup",
        challenges: challengesWithSection("team_culture", 3),
        challenge_embedding: null,
      },
    });
    // "Culture" and "Leadership" both map to team_culture in MATCH_SECTION_TO_TAGS.
    const em = person({ id: "em1", expertise_tags: ["Culture", "Leadership", "Pharma"] });

    const [top] = scoreCandidates(founder, [em], new Set());
    assert.equal(top.em.id, "em1");
    assert.equal(top.tagScore, 2 * MATCH_WEIGHT_CHALLENGE);
    assert.equal(top.textScore, 0);
    assert.equal(top.score, top.tagScore);
  });

  it("awards MATCH_WEIGHT_DIRECT_TAG per EM tag that matches the founder's own expertise_tags", () => {
    const founder = person({ id: "f1", expertise_tags: ["AI"] });
    const em = person({ id: "em1", expertise_tags: ["AI"] });

    const [top] = scoreCandidates(founder, [em], new Set());
    assert.equal(top.tagScore, MATCH_WEIGHT_DIRECT_TAG);
  });

  it("drops candidates with zero score instead of returning them", () => {
    const founder = person({ id: "f1", expertise_tags: ["AI"] });
    const noOverlap = person({ id: "em1", expertise_tags: ["Pharma"] });

    const results = scoreCandidates(founder, [noOverlap], new Set());
    assert.equal(results.length, 0);
  });

  it("excludes pairs present in hardExcludedPairs even with a real overlap", () => {
    const founder = person({ id: "f1", expertise_tags: ["AI"] });
    const em = person({ id: "em1", expertise_tags: ["AI"] });

    const results = scoreCandidates(founder, [em], new Set(["f1:em1"]));
    assert.equal(results.length, 0);
  });

  it("sorts by score descending", () => {
    const founder = person({ id: "f1", expertise_tags: ["AI", "Product"] });
    const weak = person({ id: "weak", expertise_tags: ["AI"] });
    const strong = person({ id: "strong", expertise_tags: ["AI", "Product"] });

    const results = scoreCandidates(founder, [weak, strong], new Set());
    assert.deepEqual(results.map((r) => r.em.id), ["strong", "weak"]);
  });
});

describe("assignFoundersToEms", () => {
  it("gives each founder at most one EM and respects EM capacity", () => {
    const edges: MatchEdge[] = [
      { founderId: "f1", emId: "em1", score: 10, weight: 10 },
      { founderId: "f2", emId: "em1", score: 9, weight: 9 },
      { founderId: "f3", emId: "em2", score: 5, weight: 5 },
    ];
    const assignment = assignFoundersToEms(edges, 1);

    assert.equal(assignment.get("f1")?.emId, "em1");
    assert.equal(assignment.get("f3")?.emId, "em2");
    // f2 also wants em1 but em1 is already at capacity 1 in the greedy pass —
    // the capacity+1 fill pass then rescues it onto the same EM.
    assert.equal(assignment.get("f2")?.emId, "em1");
    assert.equal(assignment.get("f2")?.method, "global_fill");
    assert.equal(assignment.get("f1")?.method, "global_greedy");
  });

  it("never exceeds capacity+1 for a single EM even across the fill pass", () => {
    const edges: MatchEdge[] = [
      { founderId: "f1", emId: "em1", score: 10, weight: 10 },
      { founderId: "f2", emId: "em1", score: 9, weight: 9 },
      { founderId: "f3", emId: "em1", score: 8, weight: 8 },
    ];
    const assignment = assignFoundersToEms(edges, 1);

    // capacity 1 -> greedy takes f1, fill (capacity 2) rescues f2, f3 has no slot left.
    assert.equal(assignment.size, 2);
    assert.ok(assignment.has("f1"));
    assert.ok(assignment.has("f2"));
    assert.ok(!assignment.has("f3"));
  });

  it("breaks weight ties deterministically regardless of input order", () => {
    // capacity 0 means only the capacity+1 fill pass has a single slot to give
    // out, so exactly one of the two equal-weight founders wins it.
    const edges: MatchEdge[] = [
      { founderId: "fB", emId: "em1", score: 5, weight: 5 },
      { founderId: "fA", emId: "em1", score: 5, weight: 5 },
    ];
    const reversed = [...edges].reverse();

    const a = assignFoundersToEms(edges, 0);
    const b = assignFoundersToEms(reversed, 0);

    // Tie-break is founderId asc, so "fA" wins the single slot either way.
    assert.equal(a.get("fA")?.emId, "em1");
    assert.equal(a.has("fB"), false);
    assert.deepEqual([...a.entries()], [...b.entries()]);
  });

  it("returns an empty assignment for no edges", () => {
    const assignment = assignFoundersToEms([], 4);
    assert.equal(assignment.size, 0);
  });
});
