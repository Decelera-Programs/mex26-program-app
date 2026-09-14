// Per-device "seen this match" flags, persisted in localStorage. Two distinct
// concerns share this mechanism but stay separate flags:
//  - "opened": the user engaged with the card (stops the attention pulse).
//  - "intro seen": the one-time heads-up modal has already shown for this match.

function safeGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function isMatchOpened(id) {
  return safeGet(`decelera.match.${id}.opened`) === "1";
}

export function markMatchOpened(id) {
  safeSet(`decelera.match.${id}.opened`, "1");
}

export function isMatchIntroSeen(id) {
  return safeGet(`decelera.match.${id}.intro`) === "1";
}

export function markMatchIntroSeen(id) {
  safeSet(`decelera.match.${id}.intro`, "1");
}
