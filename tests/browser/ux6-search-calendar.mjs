// UX6: homepage search picker stays open after check-out; footer Clear dates / Check availability runs the
// existing search exactly once; stale results are cleared with a notice when dates change without searching.
// Deterministic fixtures (fixed clock 2026-10-19, pilot calendar/quote contracts incl. 603566 Dec 24–31 and
// 603564 Jan 7 – Mar 2 2027 blocks). Nothing is fetched from the network.
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync } from "node:fs";
import { PAGE_PATH } from "../lib/page-source.mjs";
import { TODAY, PROXY, listings, calendarFor, quoteFor, overlaps, nightsOf, PNG_1x1 } from "../fixtures/pilots.mjs";

const PAGE = readFileSync(PAGE_PATH, "utf8");
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost:5500");
  if (u.pathname === "/consumer/booking-test.html" || u.pathname === "/" || /^\/property\/[^/]+\/?$/.test(u.pathname)) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE); return; }
  res.writeHead(404); res.end("not found");
});
await new Promise((r) => server.listen(5500, "localhost", r));
const results = {}; let failed = 0;
const ok = (name, cond, detail) => { results[name] = cond ? "PASS" : "FAIL " + JSON.stringify(detail).slice(0, 900); if (!cond) { failed++; console.log("FAIL", name, JSON.stringify(detail).slice(0, 900)); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sl = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const SHOTS = process.env.UX6_SHOTS || null;
const NOTICE = "Dates changed. Check availability to update results.";

async function make({ vp = { width: 1280, height: 900 }, hooks = {} } = {}) {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: "reduce" });
  const FIXED = new Date(TODAY + "T12:00:00").getTime();
  await ctx.addInitScript((FIXED) => { const D = Date; class M extends D { constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); } static now() { return FIXED; } } window.Date = M; }, FIXED);
  const page = await ctx.newPage();
  const T = { page, api: [], methods: [], other: [], errors: [], hooks };
  page.on("pageerror", (e) => T.errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Quote request failed/.test(m.text())) T.errors.push(m.text()); });
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === PROXY) {
      const p = Object.fromEntries(u.searchParams); T.api.push(u.pathname.replace("/api/booking/", "") + u.search); T.methods.push(route.request().method());
      const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", headers: { "access-control-allow-origin": "http://localhost:5500" }, body: JSON.stringify(b) });
      if (u.pathname === "/api/booking/listings") return json(listings);
      if (u.pathname === "/api/booking/calendar") { const c = calendarFor(p.id, p.from, p.to); return json(c.body, c.status); }
      if (u.pathname === "/api/booking/quote") {
        const h = T.hooks.quote && T.hooks.quote(p); if (h && h.delayMs) await sl(h.delayMs); if (h && h.status) return json({ ok: false }, h.status);
        const id = Number(p.id), n = nightsOf(p.from, p.to), g = Number(p.guests); const base = { ok: true, listingId: id, from: p.from, to: p.to, nights: n, guests: g, currency: "MXN", checkedAt: "2026-10-19T18:05:00Z" };
        if (overlaps(id, p.from, p.to)) return json({ ...base, available: false, decision: "unavailable", reasons: [{ code: "NIGHT_UNAVAILABLE", message: "One or more selected nights are not available." }] });
        const q = quoteFor(id, n); return json({ ...base, available: true, decision: "quoted", total: q.total, nightlyAverage: q.total / n, breakdown: q.breakdown, direct: q.direct, note: "Quote only." });
      }
      return json({ ok: false }, 404);
    }
    if (u.hostname === "example.com") return route.fulfill({ status: 200, contentType: "image/png", body: PNG_1x1 });
    if (u.hostname === "localhost") return route.continue();
    T.other.push(u.href); return route.abort();
  });
  T.go = async () => { await page.goto("http://localhost:5500/"); await page.waitForSelector(".mv-card"); await sl(100); };
  T.open = async () => { await page.click("#mvDatesBtn"); await page.waitForFunction(() => document.getElementById("mvCalendarModal").getAttribute("aria-hidden") === "false"); };
  T.goTo = async (iso) => { for (let i = 0; i < 30; i++) { if (await page.$(`#mvCalendarMonths .mv-cal__day[data-date="${iso}"]`)) return; const first = await page.evaluate(() => document.querySelector("#mvCalendarMonths .mv-cal__day")?.dataset.date); await page.click(iso < first ? "#mvCalPrev" : "#mvCalNext"); } throw new Error("not reached " + iso); };
  T.pick = async (iso) => { await T.goTo(iso); await page.click(`#mvCalendarMonths .mv-cal__day[data-date="${iso}"]`); };
  T.searchDone = () => page.waitForFunction(() => !document.getElementById("mvSearchBtn").disabled && !/Checking/.test(document.getElementById("mvSearchBtn").textContent) && !/Checking availability/.test(document.getElementById("availabilityStatus").textContent), null, { timeout: 15000 });
  T.s = () => page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom) }; };
    return {
      open: q("#mvCalendarModal").getAttribute("aria-hidden") === "false",
      start: q("#mvCalendarMonths .mv-cal__day.is-start")?.dataset.date ?? null, end: q("#mvCalendarMonths .mv-cal__day.is-end")?.dataset.date ?? null, inrange: document.querySelectorAll("#mvCalendarMonths .mv-cal__day.is-inrange").length,
      summary: q("#mvCalSummary")?.textContent ?? null, searchDisabled: q("#mvCalSearch")?.disabled ?? null, notice: q("#mvCalendarNotice").textContent,
      inputs: [q("#mvCheckin").value, q("#mvCheckout").value, q("#mvGuests").value], pill: q("#mvDatesBtn").textContent,
      status: q("#availabilityStatus").textContent, extBtn: { disabled: q("#mvSearchBtn").disabled, text: q("#mvSearchBtn").textContent },
      cards: [...document.querySelectorAll(".mv-card")].map((c) => ({ id: c.dataset.apartmentId, shown: c.style.display !== "none", text: c.querySelector(".mv-card__meta")?.innerText.replace(/\s+/g, " ").trim() ?? "" })),
      saved: q("#mvShowSaved").textContent, focus: document.activeElement?.id || document.activeElement?.tagName,
      panel: r(q("#mvCalendarPanel")), footer: r(q(".mv-calendar__footer")), searchBtn: r(q("#mvCalSearch")), clearBtn: r(q("#mvCalClear")), vw: innerWidth, vh: innerHeight,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      dupIds: (() => { const seen = new Map(); document.querySelectorAll("[id]").forEach((el) => seen.set(el.id, (seen.get(el.id) || 0) + 1)); return [...seen].filter(([, n]) => n > 1).map(([id]) => id); })()
    };
  });
  T.done = () => ctx.close();
  return T;
}
const quotes = (api) => api.filter((a) => a.startsWith("quote"));
const priced = (s) => s.cards.filter((c) => /MXN/.test(c.text));

// ===== 1-4. Keep open, range, revise, footer search exactly once =====
let T = await make(); await T.go(); const base = T.api.length;
await T.open(); let s = await T.s();
ok("1 open without dates: footer shows 'Choose a check-in date', Check availability disabled, Clear dates present", s.open && s.summary === "Choose a check-in date" && s.searchDisabled === true && s.clearBtn !== null, s);
await T.goTo("2026-12-20"); await T.pick("2026-12-20"); s = await T.s();
ok("1 check-in picked: 'Check-in Dec 20 — choose a check-out date', still disabled (incomplete), inputs untouched", s.open && s.start === "2026-12-20" && s.summary === "Check-in Dec 20 — choose a check-out date" && s.searchDisabled === true && same(s.inputs, ["", "", "2"]), s);
await T.page.click("#mvCalSearch", { force: true }); await sl(150); s = await T.s();
ok("1 an incomplete selection cannot start a search (forced click on the disabled button: nothing happens)", s.open && quotes(T.api.slice(base)).length === 0, { s: s.open, api: T.api.slice(base) });
await T.pick("2026-12-24"); s = await T.s();
ok("2 check-out picked: picker STAYS OPEN with the range painted (Dec 20 check-in, 3 in-range, Dec 24 check-out)", s.open && s.start === "2026-12-20" && s.end === "2026-12-24" && s.inrange === 3, s);
ok("2 footer: 'Dec 20 → Dec 24 · 4 nights', Check availability enabled; inputs and date pill updated", s.summary === "Dec 20 → Dec 24 · 4 nights" && s.searchDisabled === false && same(s.inputs, ["2026-12-20", "2026-12-24", "2"]) && s.pill === "Dec 20 - Dec 24", s);
ok("2 choosing dates made no request (no automatic search/quote)", T.api.length === base && s.status === "", T.api.slice(base));
await T.pick("2026-12-21"); s = await T.s();
ok("3 revising: a new click restarts at Dec 21, Check availability disabled again; inputs keep the last complete range", s.open && s.start === "2026-12-21" && s.end === null && s.searchDisabled === true && same(s.inputs.slice(0, 2), ["2026-12-20", "2026-12-24"]), s);
await T.pick("2026-12-23"); s = await T.s();
ok("3 revised to Dec 21 → Dec 23 (2 nights): inputs follow", s.summary === "Dec 21 → Dec 23 · 2 nights" && same(s.inputs.slice(0, 2), ["2026-12-21", "2026-12-23"]) && s.pill === "Dec 21 - Dec 23", s);
if (SHOTS) await T.page.screenshot({ path: `${SHOTS}/ux6-desk-open.png` });
await T.page.click("#mvCalSearch"); await T.searchDone(); s = await T.s();
ok("4 footer Check availability: picker closed, focus back on the Dates button", !s.open && s.focus === "mvDatesBtn", { o: s.open, f: s.focus });
ok("4 exactly one search: one quote per card with the committed dates and guests (2 calls), GET only", same(quotes(T.api.slice(base)).sort(), ["quote?id=603564&from=2026-12-21&to=2026-12-23&guests=2", "quote?id=603566&from=2026-12-21&to=2026-12-23&guests=2"]) && T.methods.every((m) => m === "GET"), T.api.slice(base));
ok("4 results shown only after the authoritative checks: both cards priced, status 'Available · …'", priced(s).length === 2 && /^Available/.test(s.status), { st: s.status, c: s.cards });
// ===== 7. Stale results after changing dates without searching =====
let mark = T.api.length;
await T.open(); s = await T.s();
ok("8 reopen shows the committed range painted and Check availability enabled", s.start === "2026-12-21" && s.end === "2026-12-23" && s.searchDisabled === false, s);
await T.goTo("2026-12-31"); await T.pick("2026-12-31"); await T.pick("2027-01-03"); s = await T.s();
ok("7 new range picked after a search: old prices removed at once, notice shown, cards (inventory) kept, no request", s.open && priced(s).length === 0 && s.cards.length === 2 && s.cards.every((c) => c.shown) && s.status === NOTICE && T.api.length === mark, { st: s.status, c: s.cards, api: T.api.slice(mark) });
await T.page.keyboard.press("Escape"); s = await T.s();
ok("7 Escape: closes, keeps Dec 31 → Jan 3 in the search controls, no search, notice still says results are outdated", !s.open && same(s.inputs.slice(0, 2), ["2026-12-31", "2027-01-03"]) && s.pill === "Dec 31 - Jan 3" && s.status === NOTICE && T.api.length === mark && s.focus === "mvDatesBtn", s);
await T.page.click("#mvSearchBtn"); await T.searchDone(); s = await T.s();
ok("6 the external Check availability button still runs the same search (2 quotes for Dec 31 → Jan 3)", same(quotes(T.api.slice(mark)).sort(), ["quote?id=603564&from=2026-12-31&to=2027-01-03&guests=2", "quote?id=603566&from=2026-12-31&to=2027-01-03&guests=2"]) && priced(s).length === 2 && s.status !== NOTICE, { api: T.api.slice(mark), st: s.status });
mark = T.api.length;
await T.open(); await T.pick("2026-12-31"); await T.pick("2027-01-03"); s = await T.s();
ok("7 re-picking the SAME range keeps the current results (nothing to invalidate, no notice)", priced(s).length === 2 && s.status !== NOTICE && T.api.length === mark, { st: s.status, c: s.cards });
await T.page.mouse.click(5, 5); s = await T.s();
ok("11 outside click closes without searching", !s.open && T.api.length === mark, s.open);
await T.open(); await T.page.click("#mvCalendarClose"); s = await T.s();
ok("11 Close button closes without searching", !s.open && T.api.length === mark, s.open);
// ===== 10. Clear dates in the footer =====
await T.open(); await T.page.click("#mvCalClear"); s = await T.s();
ok("10 Clear dates: picker stays open with no selection, Check availability disabled, inputs + pill cleared, prices and status cleared, no request", s.open && s.start === null && s.end === null && s.searchDisabled === true && same(s.inputs.slice(0, 2), ["", ""]) && s.pill === "Add dates" && priced(s).length === 0 && s.status === "" && T.api.length === mark && s.cards.length === 2, s);
await T.goTo("2026-11-29"); await T.pick("2026-11-29"); await T.pick("2026-12-02"); s = await T.s();
ok("10/17 after clearing the picker still works: Nov 29 → Dec 2 (month boundary) = 3 nights", s.summary === "Nov 29 → Dec 2 · 3 nights" && same(s.inputs.slice(0, 2), ["2026-11-29", "2026-12-02"]) && s.searchDisabled === false, s);
await T.pick("2026-12-31"); await T.pick("2027-01-03"); s = await T.s();
ok("17 year boundary Dec 31 → Jan 3 = 3 nights (date-only)", s.summary === "Dec 31 → Jan 3 · 3 nights" && same(s.inputs.slice(0, 2), ["2026-12-31", "2027-01-03"]), s);
await T.pick("2027-01-05"); s = await T.s(); await T.page.keyboard.press("Escape"); const afterIncomplete = await T.s();
ok("12 closing during an unfinished revision keeps the last complete range (Dec 31 → Jan 3) in the controls", s.start === "2027-01-05" && s.end === null && same(afterIncomplete.inputs.slice(0, 2), ["2026-12-31", "2027-01-03"]) && !afterIncomplete.open, afterIncomplete);
ok("no page errors (main flow)", T.errors.length === 0, T.errors);
await T.done();

// ===== 13. Unavailable / unconfirmed through the footer =====
T = await make({ hooks: { quote: (p) => (p.id === "603564" && p.from === "2027-01-05" ? { status: 502 } : null) } }); await T.go();
await T.open(); await T.goTo("2026-12-24"); await T.pick("2026-12-24"); await T.pick("2026-12-31"); await T.page.click("#mvCalSearch"); await T.searchDone(); s = await T.s();
ok("13 Dec 24 → 31: 603566 (real reservation) hidden as unavailable, 603564 priced — existing summary rules", s.cards.find((c) => c.id === "603566").shown === false && /MXN/.test(s.cards.find((c) => c.id === "603564").text) && /^Available/.test(s.status), s.cards);
await T.open(); await T.goTo("2027-01-05"); await T.pick("2027-01-05"); await T.pick("2027-01-12"); await T.page.click("#mvCalSearch"); await T.searchDone(); s = await T.s();
ok("13 Jan 5 → 12 with 603564's quote failing: 603564 unconfirmed (not shown as available), 603566 weekly priced; status mentions unconfirmed", /MXN/.test(s.cards.find((c) => c.id === "603566").text) && !/MXN/.test(s.cards.find((c) => c.id === "603564").text) && /could not be checked/.test(s.status), { c: s.cards, st: s.status });
await T.done();

// ===== 14. Overlapping searches / rapid clicks =====
T = await make({ hooks: { quote: (p) => (p.from === "2026-12-20" ? { delayMs: 900 } : null) } }); await T.go();
await T.open(); await T.goTo("2026-12-20"); await T.pick("2026-12-20"); await T.pick("2026-12-24");
mark = T.api.length;
await T.page.evaluate(() => { const b = document.getElementById("mvCalSearch"); b.click(); b.click(); b.click(); });
await T.searchDone(); s = await T.s();
ok("14 triple-click on the footer button: one search (2 quotes), not three", quotes(T.api.slice(mark)).length === 2 && priced(s).length === 2, T.api.slice(mark));
mark = T.api.length;
await T.page.click("#mvSearchBtn"); await sl(100); await T.open();
await T.page.evaluate(() => document.getElementById("mvCalSearch").click()); await T.searchDone(); await sl(1000); s = await T.s();
ok("14 footer confirm while the SAME search is already running (no date change): no second search", quotes(T.api.slice(mark)).length === 2 && !s.open, T.api.slice(mark));
mark = T.api.length;
await T.page.click("#mvSearchBtn"); await sl(150); // slow Dec 20–24 search in flight
await T.open(); await T.goTo("2027-01-05"); await T.pick("2027-01-05"); await T.pick("2027-01-12"); s = await T.s();
ok("14 changing dates during an in-flight search clears results immediately and shows the notice", priced(s).length === 0 && s.status === NOTICE, { st: s.status, c: s.cards });
await T.page.click("#mvCalSearch"); await T.searchDone(); await sl(1300); s = await T.s();
const jan = s.cards.find((c) => c.id === "603566");
ok("14 new search for Jan 5 → 12 wins; the late Dec 20–24 answers never repaint the cards", /9,072/.test(jan.text) && !s.cards.some((c) => /5,760|7,920/.test(c.text)) && s.cards.find((c) => c.id === "603564").shown === false, s.cards);
ok("14 the Jan search ran exactly once (2 quotes); the superseded Dec search stopped early (existing sequential token check: ≤ 2 quotes)", quotes(T.api.slice(mark)).filter((a) => a.includes("2027-01-05")).length === 2 && quotes(T.api.slice(mark)).filter((a) => a.includes("2026-12-20")).length <= 2, T.api.slice(mark));
ok("14 no page errors", T.errors.length === 0, T.errors);
await T.done();

// ===== 16. Horizon + 90 nights in the footer context =====
T = await make(); await T.go(); await T.open();
await T.goTo("2026-12-01"); await T.pick("2026-12-01"); await T.goTo("2027-03-02"); await T.pick("2027-03-02"); s = await T.s();
ok("16 91 nights refused: notice, new check-in Mar 2, Check availability disabled", /limited to 90 nights/.test(s.notice) && s.start === "2027-03-02" && s.end === null && s.searchDisabled === true, s);
await T.page.click("#mvCalPrev"); await T.page.click("#mvCalPrev"); await T.page.click("#mvCalPrev"); await T.pick("2026-12-01"); await T.goTo("2027-03-01"); await T.pick("2027-03-01"); s = await T.s();
ok("16 exactly 90 nights accepted: 'Dec 1 → Mar 1 · 90 nights', enabled", s.summary === "Dec 1 → Mar 1 · 90 nights" && s.searchDisabled === false, s);
for (let i = 0; i < 14; i++) { if (await T.page.evaluate(() => document.getElementById("mvCalNext").disabled)) break; await T.page.click("#mvCalNext"); }
ok("16 365-day horizon unchanged: Next disabled at Sep/Oct 2027; 2027-10-20 disabled", await T.page.evaluate(() => document.getElementById("mvCalNext").disabled && document.querySelector('[data-date="2027-10-20"]').classList.contains("is-disabled") && !document.querySelector('[data-date="2027-10-19"]').classList.contains("is-disabled")));
ok("16 month navigation made no request", T.api.filter((a) => !a.startsWith("listings")).length === 0, T.api);
await T.done();

// ===== 18. Mobile footer =====
for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  T = await make({ vp }); await T.go(); await T.open(); await T.goTo("2026-12-20"); await T.pick("2026-12-20"); await T.pick("2026-12-24"); s = await T.s();
  ok(`18 ${vp.width}×${vp.height}: picker open after check-out; footer + both buttons inside the viewport and the panel; no page overflow`, s.open && s.searchBtn.b <= vp.height && s.clearBtn.b <= vp.height && s.searchBtn.r <= vp.width && s.clearBtn.x >= 0 && s.footer.b <= s.panel.b + 1 && !s.overflow, { sb: s.searchBtn, cb: s.clearBtn, f: s.footer, p: s.panel });
  await T.page.evaluate(() => { const p = document.getElementById("mvCalendarPanel"); p.scrollTop = 0; }); const top = await T.s();
  ok(`18 ${vp.width}px: footer stays visible when the panel is scrolled to the top (sticky)`, top.searchBtn.b <= vp.height && top.searchBtn.y >= 0, top.searchBtn);
  ok(`18 ${vp.width}px: buttons are comfortable tap targets (≥ 34px high) and side by side`, s.searchBtn.h >= 34 && s.clearBtn.h >= 34 && Math.abs(s.searchBtn.y - s.clearBtn.y) <= 2, { sb: s.searchBtn, cb: s.clearBtn });
  if (SHOTS) await T.page.screenshot({ path: `${SHOTS}/ux6-m${vp.width}.png` });
  await T.page.click("#mvCalSearch"); await T.searchDone(); s = await T.s();
  ok(`18 ${vp.width}px: footer Check availability completes the search on the phone (2 priced cards)`, !s.open && priced(s).length === 2, s.cards);
  await T.done();
}

// ===== 19. Keyboard =====
T = await make(); await T.go();
await T.page.focus("#mvDatesBtn"); await T.page.keyboard.press("Enter"); await T.page.waitForFunction(() => document.getElementById("mvCalendarModal").getAttribute("aria-hidden") === "false");
await T.goTo("2026-12-20"); await T.page.focus('#mvCalendarMonths .mv-cal__day[data-date="2026-12-20"]'); await T.page.keyboard.press("Enter"); await T.page.focus('#mvCalendarMonths .mv-cal__day[data-date="2026-12-24"]'); await T.page.keyboard.press("Enter"); s = await T.s();
ok("19 keyboard: Enter on two day buttons selects Dec 20 → Dec 24 and the picker stays open", s.open && s.summary === "Dec 20 → Dec 24 · 4 nights", s);
await T.page.focus("#mvCalClear"); await T.page.keyboard.press("Tab"); s = await T.s();
ok("19 Tab order in the footer: Clear dates → Check availability", s.focus === "mvCalSearch", s.focus);
mark = T.api.length; await T.page.keyboard.press("Enter"); await T.searchDone(); s = await T.s();
ok("19 Enter on Check availability searches once and returns focus to the Dates button", !s.open && s.focus === "mvDatesBtn" && quotes(T.api.slice(mark)).length === 2, { f: s.focus, api: T.api.slice(mark) });
const a11y = await T.page.evaluate(() => ({ live: document.getElementById("mvCalSummary").getAttribute("aria-live"), btnType: document.getElementById("mvCalSearch").type, clearType: document.getElementById("mvCalClear").type }));
ok("19 summary is a polite live region; footer controls are real buttons", a11y.live === "polite" && a11y.btnType === "button" && a11y.clearType === "button", a11y);
ok("no duplicate ids; favorites untouched", s.dupIds.length === 0 && s.saved === "Saved (0)", { d: s.dupIds, saved: s.saved });
ok("network: GET only; listings/quote only on the search page; nothing else contacted; no write/hold/payment paths", T.methods.every((m) => m === "GET") && T.api.every((a) => /^(listings|quote\?)/.test(a)) && T.other.length === 0 && !T.api.some((a) => /hold|reserv|checkout|pay|stripe/i.test(a)), { api: T.api, other: T.other });
ok("no page errors (keyboard)", T.errors.length === 0, T.errors);
await T.done();

await browser.close(); server.close();
const names = Object.keys(results), pass = names.filter((n) => results[n] === "PASS").length;
console.log(JSON.stringify(results, null, 1)); console.log(`\n${pass}/${names.length} passed`); process.exit(failed ? 1 : 0);
