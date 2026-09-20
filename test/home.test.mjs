// home.test.mjs: the front page as an employer meets it, at three widths.
//   serve public/ on http://127.0.0.1:8877, then
//   node test/home.test.mjs <puppeteer package.json> <axe.min.js>
// BASE=https://butterflyfx.us to check the live site instead.

import { createRequire } from "module";
import fs from "fs";

const [, , puppeteerFrom, axePath] = process.argv;
const puppeteer = createRequire(puppeteerFrom)("puppeteer");
const BASE = process.env.BASE || "http://127.0.0.1:8877";
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: "new", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
// Headless Chrome asks for reduced motion unless told otherwise, and the page honours that by
// holding the artwork still. Say what is wanted, or the test would be checking the wrong thing.
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// The browser also logs a line for every failed request, without saying which one, so the
// response handler above is the one that judges those and this skips the echo.
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
// The page asks its own API for live numbers and copes when there is no answer. A plain file
// server has no API, so those are not errors here; the live run below checks they really answer.
page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/api/")) errors.push(`${r.status()} ${r.url()}`); });

// ---- the nav is not cut off, at any width -----------------------------------------------------
// It was: thirteen links wrapped to a second row inside a bar with a fixed height, and centring a
// taller thing inside a shorter one put the first row above the top of the screen.
for (const [w, h] of [[1440, 900], [1024, 800], [760, 900], [390, 844]]) {
  await page.setViewport({ width: w, height: h });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await wait(350);
  const nav = await page.evaluate(() => {
    const bar = document.querySelector(".masthead");
    const b = bar.getBoundingClientRect();
    const links = [...bar.querySelectorAll("a")].map((a) => {
      const r = a.getBoundingClientRect();
      return { text: a.textContent.trim(), top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    });
    return { top: b.top, bottom: b.bottom, right: b.right, links, count: links.length };
  });
  check(`at ${w} wide every link is inside the bar, top and bottom`,
    nav.links.every((l) => l.top >= nav.top - 0.5 && l.bottom <= nav.bottom + 0.5),
    nav.links.filter((l) => l.top < nav.top - 0.5 || l.bottom > nav.bottom + 0.5).map((l) => `${l.text} at ${Math.round(l.top)}`).join(", ") || "all inside");
  check(`at ${w} wide nothing in the bar runs off the side`,
    nav.links.every((l) => l.left >= -0.5 && l.right <= nav.right + 0.5));
  check(`at ${w} wide no link is above the top of the window`, nav.links.every((l) => l.top >= -0.5),
    `highest is ${Math.round(Math.min(...nav.links.map((l) => l.top)))}`);
}

// ---- what an employer sees first ----------------------------------------------------------------
await page.setViewport({ width: 1440, height: 900 });
// Not networkidle0: the live page keeps asking its own API for numbers, so the network never
// goes quiet and the wait would never end.
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await wait(1400);
{
  const nav = await page.$$eval(".masthead nav a", (a) => a.map((x) => x.textContent.trim()));
  check("the navigation is short enough to read at a glance", nav.length <= 8, `${nav.length}: ${nav.join(", ")}`);

  const fold = await page.evaluate(() => {
    const seen = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return r.top < window.innerHeight && r.bottom > 0; };
    return {
      h1: document.querySelector("h1").textContent.trim(),
      h1Visible: seen("h1"),
      cta: seen(".hero .btn"),
      art: seen("#hero-shape"),
      proof: [...document.querySelectorAll(".proof li")].filter((li) => li.getBoundingClientRect().top < window.innerHeight).length,
    };
  });
  check("the headline, a call to action and the artwork are all above the fold", fold.h1Visible && fold.cta && fold.art, fold.h1);
  check("and so are all four proof cards", fold.proof === 4, `${fold.proof} of 4`);

  const proof = await page.$$eval(".proof li", (li) => li.map((x) => ({
    head: x.querySelector("strong").textContent.trim(),
    body: x.querySelector("span").textContent.trim(),
    href: x.querySelector("a").getAttribute("href"),
  })));
  check("every proof card carries a number or a plain claim, and a link to where it is measured",
    proof.length === 4 && proof.every((p) => p.head.length > 5 && p.body.length > 40 && p.href.startsWith("/")),
    proof.map((p) => p.head).join(" | "));
  const links = [...new Set(proof.map((p) => p.href.split("#")[0]))];
  const codes = [];
  for (const href of links) codes.push((await fetch(BASE + href)).status);
  check("and each of those links resolves", codes.every((c) => c === 200), codes.join(","));

  // The artwork is a real drawing, not a blank box.
  const lit = await page.evaluate(() => {
    const c = document.getElementById("hero-shape");
    const t = document.createElement("canvas");
    t.width = 80; t.height = 80;
    const g = t.getContext("2d");
    g.drawImage(c, 0, 0, 80, 80);
    const d = g.getImageData(0, 0, 80, 80).data;
    let on = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 12) on++;
    return on;
  });
  check("the saddle in the hero is actually drawn", lit > 200, `${lit} lit pixels of 6400`);
  const turning = await page.evaluate(async () => {
    const shot = () => { const c = document.getElementById("hero-shape"); return c.toDataURL().length; };
    const a = shot();
    await new Promise((r) => setTimeout(r, 900));
    return a !== shot();
  });
  check("and it is turning", turning);
}

// ---- housekeeping ---------------------------------------------------------------------------------
check("no dashes on the front page", await page.evaluate(() => ![...(document.title + document.body.innerText)].some((c) => c.charCodeAt(0) >= 0x2012 && c.charCodeAt(0) <= 0x2015)));
await page.addScriptTag({ content: fs.readFileSync(axePath, "utf8") });
const axe = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } })).violations.map((v) => `${v.id}: ${v.nodes.length}`));
check("passes an axe-core WCAG 2 A and AA audit", axe.length === 0, axe.join(" | "));
check("no JavaScript errors or missing files", errors.length === 0, errors.slice(0, 3).join(" | "));
if (BASE.startsWith("https://")) {
  const api = [];
  for (const path of ["/api/citeline/healthz", "/api/citeline/stats"]) api.push((await fetch(BASE + path)).status);
  check("and the live numbers on the page really are live", api.every((c) => c === 200), api.join(","));
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
