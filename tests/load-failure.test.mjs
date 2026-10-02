// tests/load-failure.test.mjs
//
// The wording a player sees when a character will not open.
//
// Its own module because it is the only thing between a failed fetch and a
// browser console line nobody reading this app will ever see. The reported
// symptom was silence: the character simply never opened, and the only
// explanation anywhere was "Cross-Origin Request Blocked … Status code:
// (null)". These tests pin the distinction the message is built on, because
// the two failures it separates need opposite responses from the player:
// a blocked request is fixed in the browser, a failed one by retrying.
//
// Run: node --test tests/...

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { explainLoadFailure, isBlockedRequestError } from "../js/state/loadFailure.js";

const blocked = Object.assign(new Error("Failed to fetch"), {
  name: "FirebaseError",
});

describe("isBlockedRequestError", () => {
  it("recognises the reported failure", () => {
    // The exact shape that produced silence: no response at all, so no
    // status code either.
    assert.equal(isBlockedRequestError(new Error(
      "Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at https://firestore.googleapis.com/... (Reason: CORS request did not succeed). Status code: (null).")), true);
  });

  it("recognises the other ways a request never arrives", () => {
    for (const message of [
      "Failed to fetch",
      "NetworkError when attempting to fetch resource.",
      "Load failed",
      "net::ERR_BLOCKED_BY_CLIENT",
    ]) {
      assert.equal(isBlockedRequestError(new Error(message)), true, message);
    }
  });

  it("does not call a slow connection a blocked one", () => {
    // Nothing refused it; it just never arrived. Allowlisting an extension
    // because the network was slow is exactly the wrong turn.
    assert.equal(isBlockedRequestError(new Error("The request timed out after 60000ms")), false);
    assert.equal(isBlockedRequestError(new Error("deadline-exceeded")), false);
  });

  it("does not call a server that ANSWERED blocked", () => {
    // These are real replies. Telling somebody to allowlist Firestore after
    // we said their document does not exist sends them chasing the wrong
    // problem entirely.
    for (const message of [
      "Missing or insufficient permissions.",
      "The query requires an index.",
      "5 NOT_FOUND: no entity to update",
      "unavailable: the service is currently unavailable",
    ]) {
      assert.equal(isBlockedRequestError(new Error(message)), false, message);
    }
  });

  it("has no opinion about nothing", () => {
    assert.equal(isBlockedRequestError(null), false);
    assert.equal(isBlockedRequestError(undefined), false);
    assert.equal(isBlockedRequestError(new Error("")), false);
  });
});

describe("explainLoadFailure", () => {
  it("names the cause and the fix when the request is blocked", () => {
    const why = explainLoadFailure(blocked);
    assert.equal(why.blocked, true);
    // The two words that make it actionable: it is the BROWSER refusing
    // requests, and here is which site to allow.
    assert.match(why.message, /browser or network is refusing requests/i);
    assert.match(why.message, /ad blocker|privacy extension/i);
    assert.ok(why.advice.some((line) => /firestore\.googleapis\.com/.test(line)),
      "says which host to allowlist");
    assert.ok(why.advice.some((line) => /private window/i.test(line)),
      "offers a way to test whether an extension is the cause");
    assert.ok(why.advice.some((line) => /\?offline=1/.test(line)),
      "and a way to work at all without the backend");
  });

  it("keeps the underlying message for anything more specific", () => {
    // Not "see the console": this is the line that says WHY.
    assert.equal(explainLoadFailure(blocked).detail, "Failed to fetch");
  });

  it("does not offer an allowlist when nothing was blocked", () => {
    const why = explainLoadFailure(new Error("Missing or insufficient permissions."));
    assert.equal(why.blocked, false);
    assert.deepEqual(why.advice, []);
    assert.match(why.message, /check your connection/i);
  });

  it("says what it was trying to do, rather than always 'open'", () => {
    // The same failure shape is used for the character LIST and for a
    // create, and "couldn't create that" is a different sentence from
    // "couldn't open that".
    assert.match(explainLoadFailure(blocked, { action: "load your characters" }).message,
      /couldn't load your characters/);
    assert.match(explainLoadFailure(blocked).message, /couldn't open that character/);
  });

  it("never leaves the player without something to press", () => {
    // No throw, no undefined title: this is what gets rendered on failure.
    for (const err of [blocked, new Error("Missing or insufficient permissions."), null]) {
      const why = explainLoadFailure(err);
      assert.ok(why.title && why.title.length > 0);
      assert.ok(why.message && why.message.length > 0);
      assert.equal(typeof why.blocked, "boolean");
      assert.ok(Array.isArray(why.advice));
    }
  });
});
