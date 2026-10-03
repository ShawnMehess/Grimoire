// dialogs.js
//
// Promise-returning replacements for window.alert / confirm / prompt.
//
// Why bother, when the native ones already work:
//
//   - They cannot be styled. Every other surface in this app is themed, and
//     a stock OS dialog in the middle of it reads as a different program.
//   - They are not keyboard-reachable in a useful way. A native confirm has
//     no visible focus ring to move between choices, and a native prompt's
//     text field cannot be validated with an error the user can read.
//   - prompt() cannot render options. The shape-ratio picker was a numbered
//     text menu asking the user to type "2" - validation had to happen after
//     the fact, in a second dialog.
//   - They block. The whole UI thread stops, which is why the code around
//     them grew workarounds.
//
// A native dialog is still used for one thing, deliberately: the unsaved
// -changes guard on real browser navigation. Browsers do not permit an
// asynchronous dialog during unload, and a guard that cannot run is worse
// than an inelegant one. See leaveCurrentSheet in main.js.
//
// Each function resolves rather than throws: alert -> undefined, confirm ->
// boolean, prompt -> string or null (null means cancelled), choose -> the
// chosen value or null. Callers `await` them, so a call site reads like the
// straight-line code it replaces.

import { el } from "../render/sheet/sheetHelpers.js";

/** Builds the shared overlay and returns `{ overlay, box, close, buttons }`.
 *  `buttons` is a row the caller fills; `close` resolves the promise via the
 *  caller's own settle function.
 *
 *  `cancelValue` is what Escape and a backdrop click resolve. It exists
 *  because the three ways out of a dialog are not always the same value:
 *  confirm's own Cancel button answers false, and so must its Escape key,
 *  while a prompt's Cancel, Escape and backdrop all answer null. Resolving
 *  one as null and the other as false makes every caller's `if (!ok)` work
 *  by accident rather than by contract.
 *
 *  The Escape key and a click on the backdrop both cancel, and focus moves to
 *  the first button on open so Enter and Tab both work from the first
 *  keystroke. Restoring focus on close is the part native dialogs give you
 *  free and a hand-rolled one usually drops, and dropping it strands keyboard
 *  users at the top of the document. */
function buildDialog({ title, message, messageNode = null, tone = "default", initialFocus = null, ariaLabelExtra = "", cancelValue = null }) {
  const previouslyFocused = document.activeElement;
  let settled = false;
  let settle = () => {};

  const overlay = el("div", { class: "modal-overlay app-dialog", role: "presentation" });
  const box = el("div", {
    class: `modal-box app-dialog__box${tone === "danger" ? " app-dialog__box--danger" : ""}`,
    role: "dialog",
    "aria-modal": "true",
    "aria-label": [title, ariaLabelExtra].filter(Boolean).join(" — ") || "Dialog",
  });
  if (title) box.append(el("h3", { class: "app-dialog__title", text: title }));
  if (messageNode) box.append(messageNode);
  else if (message) box.append(el("p", { class: "app-dialog__message", text: message }));
  const buttons = el("div", { class: "modal-actions app-dialog__actions" });
  box.append(buttons);
  overlay.append(box);
  // A click anywhere that is not the box dismisses. Stop propagation on the
  // box itself so an ordinary click inside it is not read as a backdrop
  // click by some ancestor handler.
  box.addEventListener("click", (e) => e.stopPropagation());
  overlay.addEventListener("click", () => settle(cancelValue));

  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      settle(cancelValue);
      return;
    }
    if (e.key !== "Tab") return;
    // Keep Tab inside the dialog. A dialog the keyboard can tab out of is
    // not modal, and focus landing back on the sheet behind it - which is
    // still there and still live - is the worst outcome here.
    const focusable = [...box.querySelectorAll("button, input, textarea, select, [tabindex]")]
      .filter((n) => !n.disabled && n.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", onKey, true);

  const close = () => {
    if (settled) return;
    settled = true;
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    if (previouslyFocused && typeof previouslyFocused.focus === "function") {
      previouslyFocused.focus();
    }
  };

  const promise = new Promise((resolve) => {
    settle = (value) => {
      close();
      resolve(value);
    };
  });

  const focusTarget = initialFocus ? box.querySelector(initialFocus) : buttons.querySelector("button");
  // Focus after the node is in the document, or the browser ignores it.
  queueMicrotask(() => {
    if (focusTarget && typeof focusTarget.focus === "function") focusTarget.focus();
  });

  document.body.append(overlay);
  return { overlay, box, buttons, promise, settle: (v) => settle(v) };
}

/** A yes/no dialog. Resolves true for the confirm button, false for cancel,
 *  Escape, or a backdrop click. `tone: "danger"` marks a destructive choice.
 *
 *   if (await confirmDialog({ title: "Delete?", message: "...", confirmLabel: "Delete", tone: "danger" })) ...
 *
 *  `messageNode` takes a built element instead of a `message` string, for the
 *  cases that need more than one paragraph — a list of what an action will
 *  undo, say. It is the same hook the other dialogs already use, so a
 *  multi-line confirm needs no new rendering path.
 */
export function confirmDialog({
  title = "Are you sure?",
  message = "",
  messageNode = null,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  tone = "default",
} = {}) {
  const d = buildDialog({ title, message, messageNode, tone, cancelValue: false });
  d.buttons.append(
    el("button", { type: "button", class: "btn btn--secondary", text: cancelLabel, onclick: () => d.settle(false) }),
    el("button", {
      type: "button",
      class: tone === "danger" ? "btn btn--danger" : "btn btn--primary",
      text: confirmLabel,
      onclick: () => d.settle(true),
    }),
  );
  return d.promise;
}

/** A message with one dismiss button. Resolves undefined.
 *
 *   await alertDialog({ title: "Couldn't save", message: "..." });
 */
export function alertDialog({ title = "", message = "", dismissLabel = "OK" } = {}) {
  const d = buildDialog({ title, message });
  d.buttons.append(el("button", {
    type: "button",
    class: "btn btn--primary",
    text: dismissLabel,
    onclick: () => d.settle(undefined),
  }));
  return d.promise;
}

/** A single text field. Resolves the trimmed string, or null on cancel.
 *
 * `validate(value)` returns a string to refuse the submission with (shown
 * under the field, focus returned to it) or null/undefined to accept it.
 * That is the thing a native prompt cannot do: the shape-ratio flow used to
 * take the input, close, and then open a second dialog to explain that
 * "21x9" is not a ratio.
 *
 *   const name = await promptDialog({ title: "Name this shape", label: "Name", validate: (v) => v ? null : "Give it a name." });
 */
export function promptDialog({
  title = "",
  message = "",
  label = "",
  value = "",
  placeholder = "",
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  multiline = false,
  validate = null,
} = {}) {
  const d = buildDialog({
    title,
    messageNode: (() => {
      const wrap = el("div", { class: "app-dialog__body" });
      if (message) wrap.append(el("p", { class: "app-dialog__message", text: message }));
      return wrap;
    })(),
    initialFocus: "#app-dialog-input",
  });
  const input = el(multiline ? "textarea" : "input", {
    class: "input-group__control app-dialog__input",
    id: "app-dialog-input",
    placeholder,
    value,
  });
  const error = el("p", { class: "app-dialog__error", hidden: true, role: "alert" });
  const field = el("label", { class: "app-dialog__field" },
    label ? el("span", { class: "app-dialog__label", text: label }) : null,
    input);
  d.box.insertBefore(field, d.buttons);
  d.box.insertBefore(error, d.buttons);

  const submit = () => {
    const raw = typeof input.value === "string" ? input.value : "";
    if (typeof validate === "function") {
      let complaint = null;
      try {
        complaint = validate(raw);
      } catch (err) {
        // A validator that throws must not let the dialog hang open with
        // nothing able to close it but Escape.
        console.error("promptDialog validate threw:", err);
        complaint = "Something went wrong checking that value.";
      }
      if (complaint) {
        error.textContent = String(complaint);
        error.hidden = false;
        input.focus();
        return;
      }
    }
    d.settle(raw.trim());
  };
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    submit();
  });
  // Clear the complaint as soon as they start fixing it, rather than making
  // them submit again to find out whether the previous edit was enough.
  input.addEventListener("input", () => {
    error.hidden = true;
    error.textContent = "";
  });

  d.buttons.append(
    el("button", { type: "button", class: "btn btn--secondary", text: cancelLabel, onclick: () => d.settle(null) }),
    el("button", { type: "button", class: "btn btn--primary", text: confirmLabel, onclick: submit }),
  );
  return d.promise;
}

/** One-of-N. Resolves the chosen option's `value`, or null on cancel.
 *
 * This is the replacement for the numbered text menu: the shape picker used
 * to ask the user to type "2" out of a `\n`-joined list, then had to guess
 * what they meant. Options render as a list of buttons, so there is nothing
 * to mistype and no parsing.
 *
 * `options` is `[{ value, label, description }]`. `emptyMessage` is shown
 * instead when there are none, with the dialog still offering Cancel - an
 * empty dialog with no way out is a trap.
 *
 *   const ratio = await chooseDialog({ title: "Which shape?", options: [...] });
 */
export function chooseDialog({
  title = "Choose one",
  message = "",
  options = [],
  cancelLabel = "Cancel",
  emptyMessage = "There is nothing to choose from here yet.",
  ariaLabelExtra = "",
} = {}) {
  const d = buildDialog({
    title,
    messageNode: (() => {
      const wrap = el("div", { class: "app-dialog__body" });
      if (message) wrap.append(el("p", { class: "app-dialog__message", text: message }));
      if ((options || []).length === 0) {
        wrap.append(el("p", { class: "leveling-tab__intro", text: emptyMessage }));
        return wrap;
      }
      const list = el("div", { class: "app-dialog__options", role: "group" });
      for (const opt of options) {
        list.append(el("button", {
          type: "button",
          class: "app-dialog__option",
          onclick: () => d.settle(opt.value),
        },
          el("span", { class: "app-dialog__option-label", text: opt.label }),
          opt.description ? el("span", { class: "app-dialog__option-description", text: opt.description }) : null));
      }
      wrap.append(list);
      return wrap;
    })(),
    ariaLabelExtra,
  });
  d.buttons.append(el("button", {
    type: "button",
    class: "btn btn--secondary",
    text: cancelLabel,
    onclick: () => d.settle(null),
  }));
  return d.promise;
}
