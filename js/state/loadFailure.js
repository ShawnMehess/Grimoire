// loadFailure.js
//
// Why a fetch or a render failed, in words a player can act on.
//
// Its own module because it is pure text classification and it is the only
// thing standing between a failed open and a console line nobody reading the
// app will ever see. It also cannot be tested where it used to live:
// main.js awaits `loadStore()` at module scope, so importing it in Node would
// try to reach Firebase over the network.
//
// The reported failure was a browser console line and nothing else -
// "Cross-Origin Request Blocked: … Status code: (null)" - while the symptom
// was silence: a character that simply never opened. Two things have to be
// true for a character to open, and they fail differently. The request has
// to COMPLETE, and the browser has to let the response THROUGH.
//
// A blocked request is the second. `Status code: (null)` means there was no
// response at all, which is not what a dead network produces - that one says
// "failed to fetch" or "network error" with a real reason underneath. What
// produces a null status is something refusing the request before it left:
// an ad blocker, a privacy extension, a corporate filter. Those need the
// opposite response to a dead network - retrying never helps, and the fix
// is in the browser, not the connection.

/** Firebase's own endpoints. Named because the fix is "allowlist these",
 *  and a player who is told which sites to allow can do it; "check your
 *  connection" gives them nothing to act on. */
const FIREBASE_HOSTS = ["firestore.googleapis.com", "firebaseapp.com"];

/** Does this failure look like a blocked request rather than a failed one?
 *
 *  Only used to choose the WORDING. A blocked request and an offline one
 *  both end with "it didn't work", and the two need opposite responses, so
 *  the classification matters - but it is deliberately conservative, and a
 *  timeout is NOT on the blocked side: nothing refused it, it just never
 *  arrived, which is a connection problem and gets the connection advice.
 *  The real answers from Firestore (permission-denied, not-found) are
 *  excluded too, because telling somebody to allowlist us after we said
 *  their document does not exist sends them chasing the wrong problem
 *  entirely. */
export function isBlockedRequestError(err) {
  const text = `${err?.message || err || ""}`.toLowerCase();
  if (!text) return false;
  const blocked = /cross-origin|cors|status code: \(null\)|status code: null|blocked|failed to fetch|networkerror|network request failed|load failed|err_blocked/.test(text);
  if (!blocked) return false;
  // A server that answered is not a server that was blocked.
  const answered = /permission|unauthenticated|not[- ]found|missing|insufficient|unavailable|deadline exceeded|timed? out|timeout/.test(text);
  return !answered;
}

/** `{ title, message, advice, blocked, detail }` for a failed open.
 *
 *  `advice` is the part that matters and the part that was missing: "check
 *  your connection" is wrong when an extension is blocking Google, and right
 *  when the network is down. Both are stated, because the player cannot tell
 *  which they are, and each gives them the next thing to do. */
export function explainLoadFailure(err, { action = "open that character" } = {}) {
  const detail = String(err?.message || "").trim();
  if (isBlockedRequestError(err)) {
    return {
      title: "Couldn't complete that",
      message: `Your browser or network is refusing requests to Google's servers, which is where characters are stored — so it couldn't ${action}. That is almost always an ad blocker or a privacy extension (uBlock, Brave Shields, Privacy Badger, a corporate web filter), which is why it does not look like a problem with this page at all.`,
      advice: [
        `Allow ${FIREBASE_HOSTS.join(" and ")} for this page, then try again.`,
        "Or open this same page in a private window with extensions paused, to find out whether it is one.",
        "Or add ?offline=1 to the address to work from this browser's own storage instead. Nothing syncs that way, so edits stay on this device.",
      ],
      blocked: true,
      detail,
    };
  }
  return {
    title: "Couldn't complete that",
    message: `Something went wrong trying to ${action}. Check your connection and try again.`,
    advice: [],
    blocked: false,
    detail,
  };
}
