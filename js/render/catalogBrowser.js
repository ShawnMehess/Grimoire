// catalogBrowser.js
//
// The PLAYER-facing side of a Catalog field (see catalogLibraryEditor.js
// for the DM/author side) — browse a catalog's tabs and items, and
// spend from a linked money field to acquire one. Unlike the
// formula/bundle/catalog EDITORS, this is a blocking modal
// (.modal-overlay), not the non-blocking floating-panel pattern —
// there's no reason to want the rest of the sheet interactive while
// you're shopping, and centering it reads more like "here's an
// interface," matching the request that prompted this.

import { ensureCatalogShape, effectiveSectionRows } from "./catalogLibraryEditor.js";

function fmtCost(n) {
  return Number.isFinite(n) ? n : 0;
}

// An item's Acquisition Costs section can hold any combination of
// fields (gold, materials, a DM-defined thing, ...), not just one
// number — so the balance line below sums whichever of those fields
// parse as plain numbers (that's the only kind of cost this simple
// money-field deduction can act on) while still *displaying* every
// field, numeric or not, so a "3 iron ore" requirement is visible
// even though it can't be auto-deducted.
function acquisitionCosts(catalog, tab, entry) {
  const rows = effectiveSectionRows(catalog, tab, entry, "acquisitionCosts");
  const parts = rows
    .map((row) => ({ label: row.label || "Cost", value: (entry.fieldValues && entry.fieldValues[row.id]) || "" }))
    .filter((r) => r.value !== "");
  const numericTotal = parts.reduce((sum, r) => {
    const n = parseFloat(r.value);
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);
  return { parts, numericTotal };
}

/**
 * @param catalog     { name, tabs: [{ id, name, entries: [...] }] }
 * @param getMoney     () => current numeric value of the linked money field
 * @param spendMoney   (amount) => void — deducts amount from the money field
 * @param moneyLabel   display label for the linked field, for the balance line
 */
export function openCatalogBrowser({ catalog, getMoney, spendMoney, moneyLabel }) {
  catalog = ensureCatalogShape(catalog);
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

  const box = document.createElement("div");
  box.className = "modal-box modal-box--catalog-browser";
  box.addEventListener("click", (e) => e.stopPropagation());

  const titleRow = document.createElement("div");
  titleRow.className = "formula-editor-titlerow";
  const title = document.createElement("h3");
  title.textContent = catalog.name || "Catalog";
  const closeX = document.createElement("button");
  closeX.type = "button";
  closeX.className = "formula-editor-close";
  closeX.title = "Close";
  closeX.textContent = "✕";
  closeX.addEventListener("click", close);
  titleRow.append(title, closeX);
  box.append(titleRow);

  const balanceLine = document.createElement("div");
  balanceLine.className = "catalog-browser__balance";
  box.append(balanceLine);
  function paintBalance() {
    balanceLine.textContent = moneyLabel
      ? `${moneyLabel}: ${fmtCost(getMoney())}`
      : `Balance: ${fmtCost(getMoney())}`;
  }
  paintBalance();

  const tabs = catalog.tabs && catalog.tabs.length > 0 ? catalog.tabs : [{ id: "_all", name: "Items", entries: [] }];
  let activeTabId = tabs[0].id;

  const tabsRow = document.createElement("div");
  tabsRow.className = "catalog-browser__tabs";
  box.append(tabsRow);

  const entryList = document.createElement("div");
  entryList.className = "catalog-browser__entries";
  box.append(entryList);

  function close() { overlay.remove(); }

  function renderTabs() {
    tabsRow.innerHTML = "";
    if (tabs.length <= 1) return; // no point showing a single-tab bar
    tabs.forEach((tab) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn catalog-browser__tab" + (tab.id === activeTabId ? " active" : "");
      btn.textContent = tab.name || "Tab";
      btn.addEventListener("click", () => {
        activeTabId = tab.id;
        renderTabs();
        renderEntries();
      });
      tabsRow.append(btn);
    });
  }

  function renderEntries() {
    entryList.innerHTML = "";
    const tab = tabs.find((t) => t.id === activeTabId) || tabs[0];
    const entries = (tab && tab.entries) || [];
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "catalog-browser__empty";
      empty.textContent = "Nothing here yet.";
      entryList.append(empty);
      return;
    }
    entries.forEach((entry) => entryList.append(renderEntry(tab, entry)));
  }

  function renderEntry(tab, entry) {
    const row = document.createElement("div");
    row.className = "catalog-browser__entry";

    const thumb = document.createElement("div");
    thumb.className = "catalog-browser__entry-thumb";
    if (entry.imageData) {
      const img = document.createElement("img");
      img.src = entry.imageData;
      img.alt = "";
      thumb.append(img);
    }
    row.append(thumb);

    const info = document.createElement("div");
    info.className = "catalog-browser__entry-info";
    const nameEl = document.createElement("div");
    nameEl.className = "catalog-browser__entry-name";
    nameEl.textContent = entry.name || "Unnamed item";
    const descEl = document.createElement("div");
    descEl.className = "catalog-browser__entry-desc";
    descEl.textContent = entry.description || "";
    info.append(nameEl, descEl);
    row.append(info);

    const costs = acquisitionCosts(catalog, tab, entry);
    const costEl = document.createElement("div");
    costEl.className = "catalog-browser__entry-cost";
    costEl.textContent = costs.parts.length > 0
      ? costs.parts.map((p) => `${p.label}: ${p.value}`).join(", ")
      : "Free";
    row.append(costEl);

    const buyBtn = document.createElement("button");
    buyBtn.type = "button";
    buyBtn.className = "btn btn--primary";
    buyBtn.textContent = "Acquire";
    buyBtn.addEventListener("click", () => {
      const cost = fmtCost(costs.numericTotal);
      if (getMoney() < cost) {
        flashFeedback(buyBtn, "Not enough!", true);
        return;
      }
      spendMoney(cost);
      paintBalance();
      flashFeedback(buyBtn, "Acquired!", false);
    });
    row.append(buyBtn);

    return row;
  }

  function flashFeedback(anchorBtn, text, isWarning) {
    const existing = anchorBtn.parentElement.querySelector(".catalog-browser__feedback");
    if (existing) existing.remove();
    const badge = document.createElement("span");
    badge.className = "catalog-browser__feedback" + (isWarning ? " catalog-browser__feedback--warning" : "");
    badge.textContent = text;
    anchorBtn.after(badge);
    requestAnimationFrame(() => badge.classList.add("is-visible"));
    setTimeout(() => badge.remove(), 1200);
  }

  renderTabs();
  renderEntries();
  overlay.append(box);
  document.body.append(overlay);
}
