// sheetRollPopover.js
//
// The touch-device answer to the d20 controls.
//
// THE PROBLEM THIS SOLVES
// ----------------------
// `.field-roll` is three 44px targets in a pill that sits `position:
// absolute; right/bottom: 2px` inside the field it belongs to. On a
// pointer device that is fine: it is hidden until the field is hovered,
// so it is only ever over something you are already pointing at.
//
// A touch device has no hover, so the old rule forced it permanently
// visible (`@media (hover: none) { .field-roll { display: flex } }`).
// On a small cell - an ability score, a saving throw, a spell MOD or DC
// - a 132px pill is wider than the 40-60px cell it covers, so it sat
// ON the value it was supposed to help you roll. Six side by side became
// one strip. An absolutely positioned overlay cannot be made not to
// overlap something when it is wider than the thing it is on.
//
// css/phone.css already solved this for a phone in the STACKED layout by
// un-positioning the pill and giving the field two columns, so the pill
// sits BESIDE the value. That fix is scoped to
// `@media (max-width: 720px), (max-height: 480px)` - it is the phone's
// arrangement, and it must not change. What it does not cover is a
// tablet in portrait (768/834px wide) or a tablet in landscape: both are
// wider than the phone query, so the pill is still an overlay there, and
// in portrait the sheet is stacked with the overlay still on top of the
// values.
//
// THE FIX
// -------
// On those sizes the pill is hidden by default and opened by a TAP, into
// a popover anchored OUTSIDE the cell - below it, above it if there is
// no room, clamped to the viewport either way. One popover at a time, so
// two fields can never have two open rolls fighting for the same spot.
//
// The popover is not a copy of the pill. It MOVES the field's own
// `.field-roll` node into itself, and puts it back on close. That means
// the three buttons that end up in it are the exact same elements, with
// their exact same listeners, `aria-label`s, long-press tooltips and
// click handlers - no second copy of the roll UI to keep in sync, and no
// chance of the popover rolling a different field than the one it is
// anchored to.
//
// Pointer devices are untouched: nothing here runs unless `(hover: none)`
// matches AND the screen is past the phone query's width and height.

/** The media condition that mirrors css/phone.css's sheet section -
 *  `(max-width: 720px), (max-height: 480px)`. Inverted, because this is
 *  the "the phone rules are NOT in charge here" case. Written as a
 *  positive min- query so a browser that does not understand it says
 *  "no match" and leaves the sheet alone, which is the safe direction. */
export const POPOVER_MEDIA = "(min-width: 721px) and (min-height: 481px)";

/** Whether this environment should use the tap-to-open popover at all.
 *
 *  Both conditions are required:
 *
 *  - `(hover: none)`. Without it this opens a popover over a desktop
 *    sheet that already reveals the pill on hover, and two ways to do
 *    one thing is a regression, not a fix.
 *  - past the phone query on BOTH axes. Inside that query css/phone.css
 *    has already un-positioned the pill into its own two-column row,
 *    which covers nothing - re-opening it in a popover there would take
 *    away a better arrangement and change a phone layout that works.
 *
 *  `win` is injectable so this is testable without a browser. */
export function shouldUseRollPopover(win = globalThis) {
  const mq = win?.matchMedia;
  if (typeof mq !== "function") return false;
  const noHover = win.matchMedia("(hover: none)");
  const wide = win.matchMedia(POPOVER_MEDIA);
  return Boolean(noHover.matches && wide.matches);
}

/** Where to put the popover for an anchor of `anchorRect`, given the
 *  popover's own box, the viewport, and how much room to leave around
 *  the edges. Pure, so the placement is testable without a DOM.
 *
 *  The rules, in order:
 *
 *  1. Prefer BELOW the field. The tap was on the field, so the thing
 *     the finger is already looking at stays put and the popover lands
 *     just past its bottom edge.
 *  2. Flip ABOVE when below would run off the bottom of the viewport -
 *     which is the common case near the bottom of a long sheet, and
 *     where "the control you just opened is off-screen" would otherwise
 *     look like the tap did nothing.
 *  3. If neither side fits (a viewport shorter than the popover plus
 *     both gaps), pin to the bottom edge and let it overflow upward as
 *     little as possible. Something visible beats something ideal.
 *  4. Horizontally, RIGHT-ALIGN to the anchor's right edge and then clamp
 *     into the viewport. Right-aligned means the pill's right-hand end
 *     sits under the field's right-hand end, so the middle roll button
 *     - the one pressed most - lands under the field itself rather than
 *     off to its left. The clamp is what keeps it on screen next to a
 *     field in the right-hand column.
 *
 *  Returns `{ left, top, placement }` in CSS pixels for a
 *  `position: fixed` element. */
export function placeRollPopover({
  anchor,
  pop,
  viewport,
  gap = 6,
  margin = 8,
} = {}) {
  if (!anchor || !pop || !viewport) return { left: 0, top: 0, placement: "below" };
  const belowTop = anchor.bottom + gap;
  const aboveTop = anchor.top - gap - pop.height;
  let top = belowTop;
  let placement = "below";
  if (belowTop + pop.height > viewport.height - margin) {
    if (aboveTop >= margin) {
      top = aboveTop;
      placement = "above";
    } else {
      top = Math.max(margin, viewport.height - margin - pop.height);
      placement = "clamped";
    }
  }
  let left = anchor.right - pop.width;
  if (left < margin) left = margin;
  if (left + pop.width > viewport.width - margin) {
    left = Math.max(margin, viewport.width - margin - pop.width);
  }
  return { left, top, placement };
}

/** Class on the grid field whose popover is open. Read by CSS (which
 *  suppresses the hover shadow while a popover is up, so the field does
 *  not look like it has a pill that has jumped elsewhere) and by the
 *  tests. */
export const OPEN_FIELD_CLASS = "is-roll-popover-open";
/** Class on the popover container itself. */
export const POPOVER_CLASS = "roll-popover";

/** Wires the tap-to-open roll popover inside `root`.
 *
 *  Returns `{ destroy() }`, which removes every listener AND puts back
 *  any pill this moved. Call it from renderCustomSheet's own destroy(),
 *  for the same reason its window/document listeners are removed there:
 *  every character opened in a session would otherwise leave a
 *  document-level handler behind holding a whole stale render closure.
 *
 *  Deliberately NOT installed when shouldUseRollPopover() is false - not
 *  merely inert, absent - so a phone or a desktop pays nothing at all
 *  for this. */
export function initRollPopover(root, { onBeforeOpen } = {}) {
  if (!root || !shouldUseRollPopover()) return { destroy() {} };

  let popover = null;
  let openedTrigger = null;
  let openedFieldEl = null;

  function close() {
    if (!openedTrigger) return;
    // Put the pill back where the renderer expects it: as a direct child
    // of the grid field, which is where renderFieldInner hangs it (see
    // its own comment about escaping .field-inner's overflow clip).
    if (openedFieldEl) {
      openedFieldEl.append(openedTrigger);
      openedFieldEl.classList.remove(OPEN_FIELD_CLASS);
    }
    openedTrigger = null;
    openedFieldEl = null;
    if (popover) {
      popover.remove();
      popover = null;
    }
  }

  function place() {
    if (!popover || !openedFieldEl || !openedFieldEl.isConnected) return;
    const doc = openedFieldEl.ownerDocument;
    const view = doc.defaultView || globalThis;
    const anchorRect = openedFieldEl.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const at = placeRollPopover({
      anchor: anchorRect,
      pop: { width: popRect.width, height: popRect.height },
      viewport: {
        width: doc.documentElement.clientWidth || view.innerWidth || 0,
        height: view.innerHeight || 0,
      },
    });
    popover.style.left = `${Math.round(at.left)}px`;
    popover.style.top = `${Math.round(at.top)}px`;
    popover.dataset.placement = at.placement;
  }

  function openFor(fieldEl, trigger) {
    const doc = fieldEl.ownerDocument;
    // At most one open, always. Two popovers would race for the same
    // spot and the second tap would leave both on screen.
    close();
    if (typeof onBeforeOpen === "function") onBeforeOpen(fieldEl);
    popover = doc.createElement("div");
    popover.className = POPOVER_CLASS;
    popover.setAttribute("role", "group");
    popover.setAttribute("aria-label", `Roll ${fieldLabelFor(fieldEl)}`);
    // The pill keeps its own buttons and their own accessible names; the
    // container only says what the group of them is for.
    popover.append(trigger);
    doc.body.append(popover);
    openedTrigger = trigger;
    openedFieldEl = fieldEl;
    fieldEl.classList.add(OPEN_FIELD_CLASS);
    place();
  }

  function fieldLabelFor(fieldEl) {
    const label = fieldEl.querySelector(":scope > .field-inner .field-label");
    const text = (label?.textContent || "").trim();
    return text || "this field";
  }

  /** A tap anywhere that is not inside the open popover closes it.
   *  `pointerdown` rather than `click` so the dismissing tap is not
   *  also delivered to whatever it lands on - and so a tap that scrolls
   *  the sheet dismisses too, which is the behaviour people expect from
   *  anything that floats. */
  function onPointerDown(e) {
    if (popover && popover.contains(e.target)) return;
    if (openedFieldEl && openedFieldEl.contains(e.target)) return;
    close();
  }

  /** Escape closes it and returns the focus to the field, so a keyboard
   *  user is not left with focus on a node that has just been removed. */
  function onKeyDown(e) {
    if (e.key !== "Escape" || !openedTrigger) return;
    const fieldEl = openedFieldEl;
    close();
    const target = fieldEl?.querySelector("[contenteditable='true'], input, textarea");
    if (target && typeof target.focus === "function") target.focus();
  }

  /** The open tap. Delegated, because the fields are rebuilt on every
   *  render and a per-field listener would be lost each time.
   *
   *  It is the FIELD that is tapped, not the pill: the pill is
   *  `display: none` until this runs, so it cannot be what a finger
   *  lands on. The field is found by walking up from the tap and asking
   *  whether it owns a pill at all, so a tap on a field with no dice
   *  costs one `closest` and nothing else. */
  function onTap(e) {
    const fieldEl = e.target.closest?.(".grid-node--field");
    if (!fieldEl || !root.contains(fieldEl)) return;
    const trigger = fieldEl.querySelector(":scope > .field-roll");
    if (!trigger) return;
    if (fieldEl === openedFieldEl) { close(); return; }
    openFor(fieldEl, trigger);
  }

  /** Reposition rather than close on scroll: the anchor moves with the
   *  sheet, and a popover left behind at a fixed pixel offset would be
   *  pointing at the wrong field. Capture, because the scroll container
   *  is an inner element, not the document. */
  function onReflow() {
    if (!openedTrigger) return;
    if (!openedFieldEl || !openedFieldEl.isConnected) { close(); return; }
    place();
  }

  const doc = root.ownerDocument || document;
  const view = doc.defaultView || globalThis;
  doc.addEventListener("pointerdown", onPointerDown, true);
  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("scroll", onReflow, true);
  view.addEventListener("resize", onReflow);
  // Capture on the sheet root, not a bubble listener on the document:
  // the pill stops propagation of its own pointerdown (see buildRollTrigger
  // in customSheet.js - a click on a roll button is a roll, never the
  // start of a drag or a text edit), and a bubble listener would never
  // see it.
  root.addEventListener("pointerdown", onTap, true);

  return {
    destroy() {
      doc.removeEventListener("pointerdown", onPointerDown, true);
      doc.removeEventListener("keydown", onKeyDown, true);
      doc.removeEventListener("scroll", onReflow, true);
      view.removeEventListener("resize", onReflow);
      root.removeEventListener("pointerdown", onTap, true);
      close();
    },
  };
}