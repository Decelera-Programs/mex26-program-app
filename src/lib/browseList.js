// ---------------------------------------------------------------------------
// Remembers the ordered list of ids the user was browsing (People / Startups,
// already filtered), so a detail page can swipe to the previous / next item in
// the same order the user saw. Session-scoped, like the list filters.
// ---------------------------------------------------------------------------

const keyFor = (kind) => `decelera.browse.${kind}`;

export function saveBrowseList(kind, ids) {
  try {
    sessionStorage.setItem(keyFor(kind), JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

export function loadBrowseList(kind) {
  try {
    const raw = sessionStorage.getItem(keyFor(kind));
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Neighbours of `id` inside `items` (objects with an `id`). Returns nulls at
// the ends — no wrap-around, so the edge of the list feels like an edge.
export function neighboursOf(items, id) {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return { prev: null, next: null, index: -1, total: items.length };
  return {
    prev: items[index - 1] || null,
    next: items[index + 1] || null,
    index,
    total: items.length,
  };
}

// Order `all` by the saved browse list when it contains `id`; otherwise fall
// back to `fallback(all)` (e.g. same role, alphabetical).
export function browseOrder(kind, all, id, fallback) {
  const saved = loadBrowseList(kind);
  if (saved && saved.includes(id)) {
    const byId = new Map(all.map((item) => [item.id, item]));
    return saved.map((savedId) => byId.get(savedId)).filter(Boolean);
  }
  return fallback(all);
}
