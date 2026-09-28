import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = "C:\\Users\\shawn\\Desktop\\Grimoire";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };

const require = createRequire(import.meta.url);

function findChrome() {
  if (process.env.PLAYWRIGHT_CHROME_PATH && fs.existsSync(process.env.PLAYWRIGHT_CHROME_PATH)) {
    return process.env.PLAYWRIGHT_CHROME_PATH;
  }
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google\\Chrome\\Application\\chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

const chromePath = findChrome();
if (!chromePath) {
  console.error("crawl: no Chrome binary found.");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);
  console.log("Request:", req.url, "->", file);
  fs.readFile(file, (err, data) => {
    if (err) { console.log("404:", file, err.code); res.writeHead(404); res.end("nope"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE:", m.text()); });

await page.goto(`${base}/index.html?offline=1`, { waitUntil: "networkidle" });
await new Promise(r => setTimeout(r, 1200));
console.log("Page loaded");

const newBtn = await page.$("button:has-text('+ New Character')");
console.log("New btn:", !!newBtn);
if (newBtn) await newBtn.click();
await new Promise(r => setTimeout(r, 1500));
console.log("Wizard:", !!await page.$(".wizard"));

await browser.close();
server.close();