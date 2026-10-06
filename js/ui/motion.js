// motion.js
//
// One place that decides whether anything moves.
//
// WHY THIS IS A MODULE AND NOT A `prefers-reduced-motion` MEDIA QUERY
//
// css/base.css already has the obvious thing:
//
//   @media (prefers-reduced-motion: reduce) {
//     *, *::before, *::after { animation-duration: .01ms !important; ... }
//   }
//
// That covers CSS animations and transitions and nothing else. The Web
// Animations API - `element.animate(...)` - is NOT CSS: those animations are
// driven by the compositor and the rule above does not touch them. So an app
// whose only animation is written with `element.animate` animates at full
// speed for a player who has asked their operating system for less motion,
// with no way to see it from the stylesheet. That is not a hypothetical here:
// every row expand and collapse in the wizard was written that way.
//
// So the preference is also read in JavaScript, and every WAAPI call goes
// through animateWith below.
//
// WHY THE CALLER SUPPLIES matchMedia
//
// Reading `window.matchMedia` at module scope captures the answer once, at
// load, and a player who changes the setting mid-session would keep getting
// the old answer. Reading it per call is a little more work and is correct.
// It is also injectable, so the rule can be tested without a browser - the
// alternative is a test that passes because the stub has no matchMedia and
// every code path reads false.

/** Whether this player has asked for reduced motion. True when there is no
 *  way to tell: an unknown preference is treated as "reduce", because the
 *  cost of that mistake is a missing animation and the cost of the other
 *  mistake is motion somebody did not want. */
export function prefersReducedMotion(win = null) {
  const view = win ?? (typeof window === "undefined" ? null : window);
  if (!view || typeof view.matchMedia !== "function") return true;
  try {
    return !!view.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    // A browser that throws here is one we cannot ask. Same reasoning as
    // above: don't animate.
    return true;
  }
}

/** `element.animate(...)`, unless the player asked for reduced motion.
 *
 *  Returns whatever `animate` returns when it runs, and `null` when it is
 *  skipped - so a caller can still chain `.finished` when it got an
 *  animation, and can tell the difference between "finished instantly" and
 *  "never started".
 *
 *  Skipping means the element is left EXACTLY as the caller built it, which
 *  is the point: the animation is decoration on top of a correct final
 *  state, so with no animation the final state is simply already there. That
 *  is why callers must set the end state in markup rather than in the last
 *  keyframe - a habit worth keeping for its own sake, since it is also what
 *  makes this helper correct.
 *
 *  Returns null for a missing element, an element with no `animate`
 *  (the DOM stubs under scripts/), or a thrown call. Never throws: motion is
 *  not worth taking a page down for. */
export function animateWith(element, keyframes, options, win = null) {
  if (!element || typeof element.animate !== "function") return null;
  if (prefersReducedMotion(win)) return null;
  try {
    return element.animate(keyframes, options) || null;
  } catch {
    return null;
  }
}
