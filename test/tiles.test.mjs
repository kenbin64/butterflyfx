// tiles.test.mjs: the tile page, and whether its counters are telling the truth.
//   serve public/ on http://127.0.0.1:8877, then
//   node test/tiles.test.mjs <puppeteer package.json> <axe.min.js>

import { createRequire } from "module";
import fs from "fs";

const [, , puppeteerFrom, axePath] = process.argv;
const puppeteer = createRequire(puppeteerFrom)("puppeteer");
const BASE = process.env.BASE || "http://127.0.0.1:8877";
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "   " + d : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: "new", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 950 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/api/")) errors.push(`${r.status()} ${r.url()}`); });
await page.goto(`${BASE}/tiles.html`, { waitUntil: "domcontentloaded" });
await wait(1200);

const txt = (id) => page.$eval(`#${id}`, (e) => e.textContent.trim());
const ink = () => page.evaluate(() => {
  const c = document.getElementById("map");
  const t = document.createElement("canvas");
  t.width = 60; t.height = 60;
  const g = t.getContext("2d");
  g.drawImage(c, 0, 0, 60, 60);
  const d = g.getImageData(0, 0, 60, 60).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4) seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
  return seen.size;
});

// ---- it draws, from a store of the size it claims -------------------------------------------
check("the map draws something with real variation in it", (await ink()) > 8, `${await ink()} colours`);
check("the store is the size the page says it is", await page.evaluate(() =>
  window.__tiles.storeBytes === window.__tiles.corners * 4 && window.__tiles.corners === 129 * 129));
check("and that is 65 kB, as claimed on the page", (await txt("held")) === "67 kB" || (await txt("held")) === "65 kB",
  await txt("held"));
check("tiles were made to fill the screen", (await page.evaluate(() => window.__tiles.tilesMade)) > 0,
  `${await txt("tiles-made")} made, ${await txt("tile-ms")} each`);

// ---- the value at a point comes from the corners, not from the field -------------------------
{
  const agree = await page.evaluate(() => {
    // The store was sampled from truth at the corners, so at a corner the two must agree exactly,
    // and between corners they must not, or nothing is being interpolated at all.
    const M = 128;
    const atCorner = Math.abs(window.__tiles.read(64 / M, 32 / M) - window.__tiles.truth(64 / M, 32 / M));
    const between = Math.abs(window.__tiles.read(64.5 / M, 32.5 / M) - window.__tiles.truth(64.5 / M, 32.5 / M));
    return { atCorner, between };
  });
  check("at a stored corner the answer is the measurement itself", agree.atCorner < 1e-6, agree.atCorner.toExponential(1));
  check("and between corners it is worked out, not looked up", agree.between > 0, agree.between.toExponential(1));
}

// ---- the counters are arithmetic, not decoration ----------------------------------------------
{
  const pyramid = await page.evaluate(() => {
    // Every tile at every zoom, 256 by 256, one byte a pixel.
    const want = (z) => { let t = 0; for (let i = 0; i <= z; i++) t += Math.pow(4, i); return t * 256 * 256; };
    return [0, 5, 10].map((z) => ({ z, page: window.__tiles.pyramidBytes(z), want: want(z) }));
  });
  check("the pyramid counter is the real sum of the tiles it would take",
    pyramid.every((p) => p.page === p.want), pyramid.map((p) => `z${p.z}: ${p.page}`).join(", "));
  check("and at zoom 10 that is about 92 GB against 65 kB",
    Math.abs(pyramid[2].page / 1e9 - 91.6) < 1, `${(pyramid[2].page / 1e9).toFixed(1)} GB`);
}

// ---- zooming works, and the counters follow --------------------------------------------------
{
  const startZoom = Number(await txt("zoom-now"));
  const before = await txt("pyramid");
  const madeBefore = await page.evaluate(() => window.__tiles.tilesMade);
  for (let i = 0; i < 4; i++) { await page.click("#zoom-in"); await wait(140); }
  const after = await txt("pyramid");
  check("zooming in makes the pyramid it replaces very much larger", before !== after, `${before} then ${after}`);
  check("and the zoom readout follows", Number(await txt("zoom-now")) === startZoom + 4,
    `${startZoom} then ${await txt("zoom-now")}`);
  // Deeper in, the ground really is smoother, so counting colours is the wrong question. The right
  // one is whether it drew: fresh tiles were made and the canvas is not the empty background.
  const madeAfter = await page.evaluate(() => window.__tiles.tilesMade);
  const filled = await page.evaluate(() => {
    const c = document.getElementById("map");
    const t = document.createElement("canvas");
    t.width = 40; t.height = 40;
    const g = t.getContext("2d");
    g.drawImage(c, 0, 0, 40, 40);
    const d = g.getImageData(0, 0, 40, 40).data;
    let background = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] === 13 && d[i + 1] === 17 && d[i + 2] === 23) background++;
    return 1 - background / 1600;
  });
  check("the map still draws after zooming", madeAfter > madeBefore && filled > 0.95,
    `${madeAfter - madeBefore} new tiles, ${(filled * 100).toFixed(0)}% of the canvas covered`);
}

// ---- it admits when it has run out of detail ---------------------------------------------------
{
  await page.evaluate(() => { window.__tiles.view.zoom = 2; window.__tiles.go(); });
  await wait(250);
  const close = await page.$eval("#detail-note", (e) => e.dataset.kind);
  await page.evaluate(() => { window.__tiles.view.zoom = 14; window.__tiles.go(); });
  await wait(400);
  const far = await page.$eval("#detail-note", (e) => ({ kind: e.dataset.kind, text: e.textContent }));
  check("at a sensible zoom it says the picture came from the store", close === "ok", close);
  check("and zoomed past what it knows, it says so plainly rather than looking convincing",
    far.kind === "bad" && /not new detail/.test(far.text), far.text.slice(0, 90));
}

// ---- it measures its own error rather than quoting one ------------------------------------------
{
  await page.evaluate(() => { window.__tiles.view.zoom = 3; window.__tiles.view.u = 0.5; window.__tiles.view.v = 0.5; window.__tiles.go(); });
  await wait(300);
  await page.click("#measure");
  await wait(300);
  const out = await txt("error-out");
  check("pressing measure reports a worst and a typical error", /worst [\d.]+%.*typical [\d.]+%/.test(out), out);
  const worst = parseFloat(out.match(/worst ([\d.]+)%/)[1]);
  check("and the number it reports is small but not zero, which is what an approximation looks like",
    worst > 0 && worst < 10, `${worst}%`);
  const real = await page.evaluate(() => window.__tiles.checkError());
  check("the reported error is the one it actually just worked out", Math.abs(real.worst - worst) < 2,
    `${real.worst.toFixed(2)}% on a fresh sample`);
}

// ---- the cache counter tells the truth about what keeping tiles would cost -------------------------
{
  await page.evaluate(() => { window.__tiles.view.zoom = 3; window.__tiles.go(); });
  await page.$eval("#cache", (el) => { el.checked = true; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await wait(400);
  const shown = await txt("cache-size");
  check("with the cache on it counts the tiles kept and what they weigh", /\d+ tiles, /.test(shown), shown);
  await page.$eval("#cache", (el) => { el.checked = false; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await wait(200);
  check("and turning it off says off", (await txt("cache-size")) === "off");
}

// ---- housekeeping -----------------------------------------------------------------------------------
check("no dashes anywhere on the page", await page.evaluate(() => ![...(document.title + document.body.innerText)].some((c) => c.charCodeAt(0) >= 0x2012 && c.charCodeAt(0) <= 0x2015)));
check("the page states plainly what it does not claim", await page.evaluate(() =>
  /not claimed/i.test(document.body.innerText) && /replaces a real map/i.test(document.body.innerText)));
await page.addScriptTag({ content: fs.readFileSync(axePath, "utf8") });
const axe = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.length}`));
check("passes an axe-core WCAG 2 A and AA audit", axe.length === 0, axe.join(" | "));
await page.setViewport({ width: 390, height: 844 });
await wait(500);
check("fits a phone with no sideways scrolling", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
check("no JavaScript errors or missing files", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
