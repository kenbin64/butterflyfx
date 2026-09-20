// seo.test.mjs: what a search engine, a language model and a reader with no JavaScript get.
//   serve public/ on http://127.0.0.1:8877, then
//   node test/seo.test.mjs <puppeteer package.json>
// BASE=https://butterflyfx.us to check the live site instead.

import { createRequire } from "module";

const [, , puppeteerFrom] = process.argv;
const puppeteer = createRequire(puppeteerFrom)("puppeteer");
const BASE = process.env.BASE || "http://127.0.0.1:8877";
const LIVE = "https://butterflyfx.us";
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`); };

// The pages meant to be found. Working pages carry their own noindex and are checked separately.
const PUBLIC = [
  "/", "/the-case.html", "/geometry-as-data.html", "/geometry-bench.html", "/tiles.html", "/paint-by-numbers.html",
  "/self-healing.html", "/shape-of-a-file.html", "/research.html", "/resume.html", "/method.html",
  "/directing-ai.html", "/teach.html", "/about.html", "/contact.html",
  "/work/citeline.html", "/work/mcp-gateway.html", "/work/valuesai.html", "/podcast/",
];
const WORKING = [
  "/preview.html", "/sleek-preview.html", "/butterflyfx-demo.html", "/manifold-lens.html",
  "/manifold-sensors.html", "/dimensional-benchmark.html", "/create-agent.html",
  "/create-directive.html", "/bfx-ingest.html", "/manifold-ide/",
];

const browser = await puppeteer.launch({ headless: "new", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const look = async (path) => {
  const page = await browser.newPage();
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  const out = await page.evaluate(() => {
    const one = (sel, attr) => { const el = document.querySelector(sel); return el ? el.getAttribute(attr) : null; };
    return {
      title: document.title,
      description: one('meta[name="description"]', "content"),
      canonical: one('link[rel="canonical"]', "href"),
      ogTitle: one('meta[property="og:title"]', "content"),
      ogImage: one('meta[property="og:image"]', "content"),
      robots: one('meta[name="robots"]', "content"),
      lang: document.documentElement.lang,
      h1: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim()),
      ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent),
    };
  });
  await page.close();
  return out;
};

// ---- the pages meant to be found ------------------------------------------------------------
for (const path of PUBLIC) {
  const m = await look(path);
  const name = path === "/" ? "the home page" : path;
  check(`${name} has a title, a description and a canonical address`,
    m.title.length >= 10 && m.description && m.description.length >= 70 && m.canonical === LIVE + path,
    `${m.title.length} title, ${m.description ? m.description.length : 0} description, ${m.canonical}`);
  check(`${name} has sharing tags`, !!m.ogTitle && !!m.ogImage);
  check(`${name} declares its language and has one main heading`, m.lang === "en" && m.h1.length === 1, `${m.lang}, headings: ${m.h1.join(" | ") || "none"}`);
  check(`${name} is not accidentally hidden from search`, !m.robots || !/noindex/.test(m.robots), String(m.robots));
  let parsed = null;
  try { parsed = m.ld.map((t) => JSON.parse(t)); } catch { parsed = null; }
  check(`${name} carries structured data that parses and names its author`,
    !!parsed && parsed.length > 0 && /Kenneth W. Bingham/.test(JSON.stringify(parsed)), parsed ? "" : "broken JSON");
}

// ---- the pages that are not finished ----------------------------------------------------------
for (const path of WORKING) {
  const m = await look(path);
  check(`${path} is kept out of the index on purpose`, !!m.robots && /noindex/.test(m.robots), String(m.robots));
}

// ---- the files a crawler looks for --------------------------------------------------------------
{
  const robots = await (await fetch(BASE + "/robots.txt")).text();
  check("robots.txt exists and lets the public pages in", /User-agent: \*/.test(robots) && /Allow: \//.test(robots));
  check("and names the AI crawlers one by one", ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended", "CCBot"].every((b) => robots.includes(b)));
  check("and points at the sitemap", robots.includes("Sitemap: https://butterflyfx.us/sitemap.xml"));

  const sitemap = await (await fetch(BASE + "/sitemap.xml")).text();
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  check("the sitemap lists exactly the public pages", urls.length === PUBLIC.length && PUBLIC.every((p) => urls.includes(LIVE + p)),
    `${urls.length} listed against ${PUBLIC.length} public`);
  check("and lists none of the unfinished ones", WORKING.every((p) => !urls.includes(LIVE + p)));
  const codes = [];
  for (const u of urls) codes.push((await fetch(BASE + u.replace(LIVE, ""))).status);
  check("and every address in it resolves", codes.every((c) => c === 200), codes.join(","));

  const llms = await (await fetch(BASE + "/llms.txt")).text();
  check("llms.txt exists, with a title and a summary", /^# ButterflyFx/.test(llms) && /^> /m.test(llms));
  check("and it states the limits, not only the wins", /not a better general purpose compressor/.test(llms) && /PNG beat every scheme tested/.test(llms));
  check("nothing in it contains a dash", ![...llms].some((c) => c.charCodeAt(0) >= 0x2012 && c.charCodeAt(0) <= 0x2015));
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
