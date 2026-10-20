// UX4a: before/after parity of the N2 property-modal calendar.
// Runs one deterministic script of modal interactions (fixed clock 2026-10-19, fixture backend) and records,
// after every step, a normalized snapshot of the modal calendar (day cells with state/classes/aria, nav state,
// status, selection text + buttons, quote text, dates pill, selected listing, duplicate ids) plus the ordered
// API calls made since the previous step.
//   --record <file>   write the trace (used ONCE against the committed baseline page: PAGE_SRC=<ccdefda copy>)
//   default           replay against PAGE_PATH and compare step-by-step with fixtures/ux4a-baseline-ccdefda.json
// The baseline fixture is frozen evidence from ccdefda; it is never regenerated from a refactored page.
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAGE_PATH } from "../lib/page-source.mjs";
import { TODAY, PROXY, listings, calendarFor, quoteFor, overlaps, nightsOf, PNG_1x1 } from "../fixtures/pilots.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(here, "..", "fixtures", "ux4a-baseline-ccdefda.json");
const recordTo = process.argv.includes("--record") ? process.argv[process.argv.indexOf("--record") + 1] : null;

const PAGE = readFileSync(PAGE_PATH, "utf8");
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost:5500");
  if (u.pathname === "/consumer/booking-test.html" || u.pathname === "/" || /^\/property\/[^/]+\/?$/.test(u.pathname)) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE); return; }
  res.writeHead(404); res.end("not found");
});
await new Promise((r) => server.listen(5500, "localhost", r));
const browser = await chromium.launch();

const hooks = { calendar: null, quote: null };
async function make(vp = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: "reduce" });
  const FIXED = new Date(TODAY + "T12:00:00").getTime();
  await ctx.addInitScript((FIXED) => { const D = Date; class M extends D { constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); } static now() { return FIXED; } } window.Date = M; }, FIXED);
  const page = await ctx.newPage();
  const T = { page, api: [], errors: [] };
  page.on("pageerror", (e) => T.errors.push(e.message));
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === PROXY) {
      const p = Object.fromEntries(u.searchParams);
      T.api.push(route.request().method() + " " + u.pathname + u.search);
      const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", headers: { "access-control-allow-origin": "http://localhost:5500" }, body: JSON.stringify(b) });
      if (u.pathname === "/api/booking/listings") return json(listings);
      if (u.pathname === "/api/booking/calendar") {
        const h = hooks.calendar && hooks.calendar(p); if (h && h.delayMs) await new Promise((r) => setTimeout(r, h.delayMs)); if (h && h.status) return json({ ok: false }, h.status);
        const c = calendarFor(p.id, p.from, p.to); return json(c.body, c.status);
      }
      if (u.pathname === "/api/booking/quote") {
        const h = hooks.quote && hooks.quote(p); if (h && h.delayMs) await new Promise((r) => setTimeout(r, h.delayMs)); if (h && h.status) return json({ ok: false }, h.status);
        const id = Number(p.id), n = nightsOf(p.from, p.to); const base = { ok: true, listingId: id, from: p.from, to: p.to, nights: n, guests: Number(p.guests), currency: "MXN", checkedAt: "2026-10-19T18:05:00Z" };
        if (overlaps(id, p.from, p.to)) return json({ ...base, available: false, decision: "unavailable", reasons: [{ code: "NIGHT_UNAVAILABLE", message: "One or more selected nights are not available." }] });
        const q = quoteFor(id, n); return json({ ...base, available: true, decision: "quoted", total: q.total, nightlyAverage: q.total / n, breakdown: q.breakdown, direct: q.direct, note: "Quote only." });
      }
      return json({ ok: false }, 404);
    }
    if (u.hostname === "example.com") return route.fulfill({ status: 200, contentType: "image/png", body: PNG_1x1 });
    if (u.hostname === "localhost") return route.continue();
    T.api.push("OTHER " + u.href); return route.abort();
  });
  T.snap = () => page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const norm = (t) => (t || "").replace(/\s+/g, " ").replace(/checked \d{1,2}:\d{2} [AP]M/g, "checked <time>").trim();
    const cal = q("#mvHostawayCalendar");
    const dupIds = (() => { const seen = new Map(); document.querySelectorAll("[id]").forEach((el) => seen.set(el.id, (seen.get(el.id) || 0) + 1)); return [...seen].filter(([, n]) => n > 1).map(([id]) => id); })();
    const btns = (root) => [...(root ? root.querySelectorAll("button") : [])].map((b) => ({ t: b.textContent.trim(), id: b.id || null, p: b.getAttribute("aria-pressed"), l: b.getAttribute("aria-label"), d: b.disabled || false, c: b.className }));
    const days = cal ? [...cal.querySelectorAll(".mv-cal__day")].map((c) => [c.tagName[0], c.dataset.date, c.dataset.state, [...c.classList].sort().join(" "), c.getAttribute("aria-label"), c.getAttribute("aria-pressed"), c.getAttribute("aria-disabled")]) : null;
    return {
      modalOpen: q("#mvModal").getAttribute("aria-hidden") === "false",
      selected: String(window.mvSelectedApartmentId ?? ""),
      pill: norm(q("#mvModalDatesPill")?.textContent),
      status: norm(q("#mvHostawayCalendarStatus")?.innerText), statusBtns: btns(q("#mvHostawayCalendarStatus")),
      range: norm(q("#mvHcalRange")?.textContent), prev: q("#mvHcalPrev")?.disabled ?? null, next: q("#mvHcalNext")?.disabled ?? null,
      legend: cal ? getComputedStyle(q("#mvHostawayCalendarLegend")).display : null,
      titles: cal ? [...cal.querySelectorAll(".mv-cal__title")].map((t) => t.textContent) : null,
      days,
      selection: norm(q("#mvHostawaySelection")?.innerText), selectionBtns: btns(q("#mvHostawaySelection")),
      selectionSpans: cal ? [...q("#mvHostawaySelection").querySelectorAll("span")].map((s) => [s.className, norm(s.textContent)]) : null,
      quote: norm(q("#mvHostawayQuote")?.innerText), quoteDirect: q("#mvHostawayQuote")?.classList.contains("is-direct") ?? null, quoteBtns: btns(q("#mvHostawayQuote")),
      focus: document.activeElement?.id || document.activeElement?.tagName,
      dupIds, cards: [...document.querySelectorAll(".mv-card")].map((c) => norm(c.innerText)),
      searchPicker: { btn: norm(q("#mvDatesBtn")?.textContent), ci: q("#mvCheckin").value, co: q("#mvCheckout").value, g: q("#mvGuests").value, calOpen: q("#mvCalendarModal").getAttribute("aria-hidden") },
      errorsHint: null
    };
  });
  T.done = () => ctx.close();
  return T;
}

const trace = [];
let T;
let apiMark = 0;
const sl = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { // wait for calendar + quote idle (status not loading, selection not "checking", quote not "Checking price")
  await T.page.waitForFunction(() => { const st = document.getElementById("mvHostawayCalendarStatus"), se = document.getElementById("mvHostawaySelection"), qu = document.getElementById("mvHostawayQuote"); if (!st) return true; return !/Loading live calendar/.test(st.textContent) && !/checking availability/.test(se?.textContent || "") && !/Checking price/.test(qu?.textContent || ""); }, null, { timeout: 15000 }).catch(() => {});
  await sl(60);
};
async function step(name, fn, { wait = true } = {}) {
  if (fn) await fn();
  if (wait) await settle();
  const snap = await T.snap();
  const api = T.api.slice(apiMark); apiMark = T.api.length;
  trace.push({ step: name, api, snap, errors: T.errors.slice() });
}
const click = (sel) => T.page.click(sel, { force: true, timeout: 8000 }); // force: a disabled nav button must simply do nothing (real browsers drop the click)
const day = (iso) => `#mvHostawayCalendarMonths .mv-cal__day[data-date="${iso}"]`;
const openCard = async (id) => { await click(`.mv-card[data-apartment-id="${id}"] .mv-card__title`); await T.page.waitForSelector("#mvHostawayCalendarMonths .mv-cal__month"); };
const setSearch = (ci, co, g) => T.page.evaluate(([ci, co, g]) => { for (const [id, v] of [["mvCheckin", ci], ["mvCheckout", co]]) { const el = document.getElementById(id); el.value = v || ""; el.dispatchEvent(new Event("change", { bubbles: true })); } if (g) { const el = document.getElementById("mvGuests"); el.value = String(g); el.dispatchEvent(new Event("change", { bubbles: true })); } }, [ci, co, g]);
const selBtn = (label) => T.page.evaluate((label) => { const b = [...document.querySelectorAll("#mvHostawaySelection button")].find((x) => x.textContent.trim() === label); if (!b) throw new Error("no button " + label); b.click(); }, label);
const goToMonth = async (title) => { for (let i = 0; i < 30; i++) { const titles = await T.page.evaluate(() => [...document.querySelectorAll("#mvHostawayCalendarMonths .mv-cal__title")].map((x) => x.textContent)); if (titles[0] === title) return; const want = new Date(title), have = new Date(titles[0]); await T.page.evaluate((d) => document.getElementById(d).click(), want > have ? "mvHcalNext" : "mvHcalPrev"); await sl(40); } throw new Error("month not reached " + title); };
const hasSelBtn = (label) => T.page.evaluate((label) => !![...document.querySelectorAll("#mvHostawaySelection button")].find((x) => x.textContent.trim() === label), label);

// ================= SCRIPT =================
T = await make();
await T.page.goto("http://localhost:5500/"); await T.page.waitForSelector(".mv-card"); apiMark = 0;
await step("S0 search page loaded (no modal)", null, { wait: false });

// --- A. open 603566 without search dates: default view, no selection
await step("A1 open 603566 (no search dates)", () => openCard("603566"));
await step("A2 Next (Nov/Dec)", () => click("#mvHcalNext"));
await step("A3 Next (Dec/Jan)", () => click("#mvHcalNext"));
await step("A4 click Dec 20 (check-in)", () => click(day("2026-12-20")));
await step("A5 click Dec 24 (check-out on the reservation's arrival day = valid boundary)", () => click(day("2026-12-24")));
await step("A6 Check price", () => click("#mvHostawayQuoteBtn"));
await step("A7 Next (navigation drops the price, no quote request)", () => click("#mvHcalNext"));
await step("A8 Prev", () => click("#mvHcalPrev"));
await step("A9 Check price again", () => click("#mvHostawayQuoteBtn"));
// --- B. editing one end
await step("B1 Change check-in (edit mode)", () => selBtn("Change check-in"));
await step("B2 click Dec 21 (new check-in, check-out kept)", () => click(day("2026-12-21")));
await step("B3 Change check-out", () => selBtn("Change check-out"));
await step("B4 click Dec 25 (crosses the Dec 24 block → refused)", () => click(day("2026-12-25")));
await step("B5 click Dec 26 (blocked day as new start → message)", () => click(day("2026-12-26")));
await step("B6 click Dec 31 (block departure day is a valid check-in)", () => click(day("2026-12-31")));
await step("B7 click Jan 3 2027 (year boundary check-out)", () => click(day("2027-01-03")));
await step("B8 Clear dates", () => selBtn("Clear dates"));
// --- C. keyboard
await step("C1 focus calendar + PageDown", async () => { await T.page.focus("#mvHostawayCalendar"); await T.page.keyboard.press("PageDown"); });
await step("C2 PageUp", () => T.page.keyboard.press("PageUp"));
await step("C3 Tab from Prev lands on Next", async () => { await T.page.focus("#mvHcalPrev"); await T.page.keyboard.press("Tab"); }, { wait: false });
await step("C4 Enter on Next via keyboard", () => T.page.keyboard.press("Enter"));
// --- D. horizon bounds
for (let i = 0; i < 12; i++) { await T.page.evaluate(() => document.getElementById("mvHcalNext").click()); await sl(20); }
await step("D1 Next ×12 → max bound (Next disabled)", null);
await step("D2 Next at bound does nothing", () => click("#mvHcalNext").catch(() => {}));
for (let i = 0; i < 14; i++) { if (await T.page.evaluate(() => document.getElementById("mvHcalPrev").disabled)) break; await T.page.evaluate(() => document.getElementById("mvHcalPrev").click()); await sl(20); }
await step("D3 Prev to min bound (Prev disabled)", null);
await step("D4 Prev at bound does nothing", () => click("#mvHcalPrev").catch(() => {}));
// --- E. close / reopen keeps a selection, resets quote
await click("#mvHcalNext"); await click("#mvHcalNext"); await settle();
await click(day("2026-12-20")); await click(day("2026-12-24")); await settle(); await click("#mvHostawayQuoteBtn"); await settle();
await step("E1 selected Dec 20–24 + quoted", null);
await step("E2 Escape closes the modal", () => T.page.keyboard.press("Escape"), { wait: false });
await step("E3 reopen 603566: selection kept, re-checked, quote gone, view at selection month", () => openCard("603566"));
// --- F. search-date carry-over
await step("F1 close; set search Dec 20–24; open 603566 (seeded)", async () => { await T.page.keyboard.press("Escape"); await setSearch("2026-12-20", "2026-12-24", 2); await sl(300); await openCard("603566"); });
await step("F2 Check price (6,400 → 5,760)", () => click("#mvHostawayQuoteBtn"));
await step("F3 close; search Dec 24–31; open 603566 (seeded into the reservation → refused)", async () => { await T.page.keyboard.press("Escape"); await setSearch("2026-12-24", "2026-12-31", 2); await sl(300); await openCard("603566"); });
await step("F4 close; search Dec 23–25 (overlap); open", async () => { await T.page.keyboard.press("Escape"); await setSearch("2026-12-23", "2026-12-25", 2); await sl(300); await openCard("603566"); });
await step("F5 close; search Nov 29 → Dec 2 (month boundary); open 603564", async () => { await T.page.keyboard.press("Escape"); await setSearch("2026-11-29", "2026-12-02", 2); await sl(300); await openCard("603564"); });
await step("F6 Check price (3 nights 603564)", () => click("#mvHostawayQuoteBtn"));
await step("F7 close; search Jan 5 → Apr 5 2027 (90 nights, max); open 603566", async () => { await T.page.keyboard.press("Escape"); await setSearch("2027-01-05", "2027-04-05", 2); await sl(300); await openCard("603566"); });
await step("F8 Check price (90 nights monthly)", () => click("#mvHostawayQuoteBtn"));
await step("F9 close; search Jan 5 → Apr 6 2027 (91 nights); open 603566 → not usable", async () => { await T.page.keyboard.press("Escape"); await setSearch("2027-01-05", "2027-04-06", 2); await sl(300); await openCard("603566"); });
await step("F10 close; search Dec 31 → Jan 3 (block departure day arrival); open 603566", async () => { await T.page.keyboard.press("Escape"); await setSearch("2026-12-31", "2027-01-03", 2); await sl(300); await openCard("603566"); });
await step("F11 Check price", () => click("#mvHostawayQuoteBtn"));
await step("F12 guests → 1 while quoted (invalidateQuotes clears the modal quote)", () => setSearch("2026-12-31", "2027-01-03", 1));
await step("F13 Check price with 1 guest", () => click("#mvHostawayQuoteBtn"));
// --- G. switching listings (603564 block Jan 7 → Mar 2 2027)
await step("G1 close; clear search dates; open 603564", async () => { await T.page.keyboard.press("Escape"); await T.page.evaluate(() => { document.getElementById("mvDatesClear").click(); }); await sl(300); await setSearch("", "", 2); await sl(200); await openCard("603564"); });
await step("G2 navigate to Jan/Feb 2027 (block shown)", () => goToMonth("January 2027"));
await step("G3 click Jan 6 then Jan 8 (crosses Jan 7 block → refused)", async () => { await click(day("2027-01-06")); await click(day("2027-01-08")); });
await step("G4 click Jan 4 then Jan 7 (check-out on block arrival day → valid)", async () => { await click(day("2027-01-04")); await click(day("2027-01-07")); });
await step("G5 close; open 603566 (other listing: its own state, no 603564 selection)", async () => { await T.page.keyboard.press("Escape"); await openCard("603566"); });
await step("G6 close; reopen 603564: Jan 4–7 selection remembered and re-checked", async () => { await T.page.keyboard.press("Escape"); await openCard("603564"); });
await T.done();

// --- H. failures and stale responses (fresh context)
T = await make(); await T.page.goto("http://localhost:5500/"); await T.page.waitForSelector(".mv-card"); apiMark = T.api.length;
hooks.calendar = () => ({ status: 502 });
await step("H1 open 603566 with calendar 502: fail closed, Retry", () => openCard("603566"));
await step("H2 Next while failing (still fail closed)", () => click("#mvHcalNext"));
hooks.calendar = null;
await step("H3 Retry → live calendar", () => click("#mvHostawayCalendarStatus button"));
await step("H4 click Dec 20, Dec 24 (view Nov/Dec after one Next)", async () => { await click("#mvHcalNext"); await settle(); await click(day("2026-12-20")); await click(day("2026-12-24")); });
hooks.quote = () => ({ status: 502 });
await step("H5 Check price with quote 502 → unconfirmed + Retry", () => click("#mvHostawayQuoteBtn"));
hooks.quote = null;
await step("H6 Retry quote → quoted", () => click("#mvHostawayQuote button"));
// stale stay check: delay the stay window, change dates before it answers
hooks.calendar = (p) => (p.from === "2026-12-20" && p.to === "2026-12-24" ? { delayMs: 1200 } : null);
await step("H7 Clear, then Dec 20 → Dec 24 (stay check delayed 1.2 s) — snapshot while pending", async () => { await selBtn("Clear dates"); await settle(); await click(day("2026-12-20")); await click(day("2026-12-24")); await sl(150); }, { wait: false });
await step("H8 immediately Dec 21 → Dec 23 (new stay); late Dec 20–24 answer must be ignored", async () => { await click(day("2026-12-21")); await click(day("2026-12-23")); await sl(1500); });
hooks.calendar = null;
// stale quote: delayed quote, then change dates
hooks.quote = () => ({ delayMs: 1200 });
await step("H9 Check price (delayed 1.2 s) then change check-out to Dec 24 → late quote discarded", async () => { await click("#mvHostawayQuoteBtn"); await sl(100); await selBtn("Change check-out"); await click(day("2026-12-24")); await sl(1600); });
hooks.quote = null;
// switch listing while a view window is loading
hooks.calendar = (p) => (p.id === "603566" ? { delayMs: 1200 } : null);
await step("H10 close; open 603566 (view delayed); immediately close and open 603564 → 603564 calendar intact, late 603566 ignored", async () => { await T.page.keyboard.press("Escape"); await openCard("603566").catch(() => {}); await sl(100); await T.page.keyboard.press("Escape"); await openCard("603564"); await sl(1600); });
hooks.calendar = null;
await step("H11 close modal: search page untouched", () => T.page.keyboard.press("Escape"), { wait: false });
await T.done();

// --- I. mobile viewport
T = await make({ width: 390, height: 844 }); await T.page.goto("http://localhost:5500/"); await T.page.waitForSelector(".mv-card"); apiMark = T.api.length;
await step("I1 390px open 603566, Next ×2, Dec 20 → Dec 24", async () => { await openCard("603566"); await click("#mvHcalNext"); await click("#mvHcalNext"); await settle(); await click(day("2026-12-20")); await click(day("2026-12-24")); });
await T.done();

await browser.close(); server.close();

// ================= RECORD / COMPARE =================
const strip = (t) => t.map((s) => ({ step: s.step, api: s.api, snap: s.snap, errors: s.errors }));
if (recordTo) {
  writeFileSync(recordTo, JSON.stringify({ recordedFrom: process.env.PAGE_SRC || PAGE_PATH, today: TODAY, steps: strip(trace) }, null, 1));
  console.log(`recorded ${trace.length} steps → ${recordTo}`);
  process.exit(0);
}
const base = JSON.parse(readFileSync(BASELINE, "utf8"));
const results = {}; let failed = 0;
const ok = (name, cond, detail) => { results[name] = cond ? "PASS" : "FAIL " + JSON.stringify(detail).slice(0, 1500); if (!cond) { failed++; console.log("FAIL", name, JSON.stringify(detail).slice(0, 1500)); } };
ok("script length identical", base.steps.length === trace.length, [base.steps.length, trace.length]);
const n = Math.min(base.steps.length, trace.length);
// Harness determinism (found during UX4b; reproduces on the ccdefda page against its own recording, ~1 run in 6):
// E2 is snapped synchronously right after Escape hides the modal. Chromium moves focus off the now-hidden button at its
// next rendering update, so `focus` at that instant is either the quote button (what the frozen baseline caught) or BODY.
// That single field is excluded at that single step; everything else in E2, and focus everywhere else, is still compared.
const TIMING_SENSITIVE = { "E2 Escape closes the modal": ["focus"] };
const diffKeys = (a, b, step) => Object.keys({ ...a, ...b }).filter((k) => !(TIMING_SENSITIVE[step] || []).includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
for (let i = 0; i < n; i++) {
  const b = base.steps[i], t = trace[i];
  const dk = diffKeys(b.snap, t.snap, b.step);
  ok(`${b.step} — DOM/a11y/state identical`, b.step === t.step && dk.length === 0, { keys: dk, base: Object.fromEntries(dk.map((k) => [k, b.snap[k]])), now: Object.fromEntries(dk.map((k) => [k, t.snap[k]])) });
  ok(`${b.step} — API calls identical`, JSON.stringify(b.api) === JSON.stringify(t.api), { base: b.api, now: t.api });
  ok(`${b.step} — no page errors`, t.errors.length === 0, t.errors);
}
const names = Object.keys(results), pass = names.filter((k) => results[k] === "PASS").length;
console.log(`\n${pass}/${names.length} passed`); process.exit(failed ? 1 : 0);
