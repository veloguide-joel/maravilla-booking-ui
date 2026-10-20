// UX1: dedicated property URLs. The local server emulates the vercel.json rewrite (/property/:id -> the page).
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync } from "node:fs";
import { PAGE_PATH } from "../lib/page-source.mjs";
import { htmlFor, enableLegacyModal, openLegacyModal } from "../lib/modal-entry.mjs"; // UX7a: test-only legacy modal entry (see lib)
import { TODAY, PROXY, listings, calendarFor, quoteFor, overlaps, nightsOf, PNG_1x1 } from "../fixtures/pilots.mjs";

const PAGE = readFileSync(PAGE_PATH, "utf8");
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost:5500");
  if (u.pathname === "/consumer/booking-test.html" || u.pathname === "/" || /^\/property\/[^/]+\/?$/.test(u.pathname)) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(htmlFor(req, PAGE)); return; }
  res.writeHead(404); res.end("not found");
});
await new Promise((r) => server.listen(5500, "localhost", r));
const results = {}; let failed = 0;
const ok = (name, cond, detail) => { results[name] = cond ? "PASS" : "FAIL " + JSON.stringify(detail); if (!cond) { failed++; console.log("FAIL", name, JSON.stringify(detail)); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const browser = await chromium.launch();

async function make({ vp = { width: 1280, height: 900 }, listingsHook = null, legacyModal = false } = {}) {
  const ctx = await browser.newContext({ viewport: vp });
  if (legacyModal) await enableLegacyModal(ctx);
  const FIXED = new Date(TODAY + "T12:00:00").getTime();
  await ctx.addInitScript((FIXED) => { const D = Date; class M extends D { constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); } static now() { return FIXED; } } window.Date = M; }, FIXED);
  const page = await ctx.newPage();
  const T = { page, api: [], errors: [], listingsHook };
  page.on("pageerror", (e) => T.errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) T.errors.push(m.text()); });
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === PROXY) {
      const p = Object.fromEntries(u.searchParams); T.api.push(u.pathname + u.search);
      const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", headers: { "access-control-allow-origin": "http://localhost:5500" }, body: JSON.stringify(b) });
      if (u.pathname === "/api/booking/listings") { const h = T.listingsHook && T.listingsHook(); if (h) { if (h.delayMs) await new Promise((r) => setTimeout(r, h.delayMs)); if (h.status) return json(h.body ?? { ok: false }, h.status); } return json(listings); }
      if (u.pathname === "/api/booking/calendar") { const c = calendarFor(p.id, p.from, p.to); return json(c.body, c.status); }
      if (u.pathname === "/api/booking/quote") { const id = Number(p.id), n = nightsOf(p.from, p.to); const base = { ok: true, listingId: id, from: p.from, to: p.to, nights: n, guests: Number(p.guests), currency: "MXN", checkedAt: "x" }; if (overlaps(id, p.from, p.to)) return json({ ...base, available: false, decision: "unavailable", reasons: [{ code: "NIGHT_UNAVAILABLE", message: "One or more selected nights are not available." }] }); const q = quoteFor(id, n); return json({ ...base, available: true, decision: "quoted", total: q.total, nightlyAverage: q.total / n, breakdown: q.breakdown, direct: q.direct, note: "Quote only." }); }
      return json({ ok: false }, 404);
    }
    if (u.hostname === "example.com") return route.fulfill({ status: 200, contentType: "image/png", body: PNG_1x1 });
    if (u.hostname === "localhost") return route.continue();
    T.api.push("OTHER " + u.href); return route.abort();
  });
  T.go = async (path) => { await page.goto("http://localhost:5500" + path); await page.waitForFunction(() => document.querySelector(".mv-card") || /not found|not configured|could not be loaded/i.test(document.getElementById("mvPropertyView").innerText), null, { timeout: 15000 }); };
  T.state = () => page.evaluate(() => {
    const pv = document.getElementById("mvPropertyView"), app = document.getElementById("mv-app");
    const vis = (el) => !el.classList.contains("mv-view-hidden") && getComputedStyle(el).display !== "none";
    const dupIds = (() => { const seen = new Map(); document.querySelectorAll("[id]").forEach((el) => seen.set(el.id, (seen.get(el.id) || 0) + 1)); return [...seen].filter(([, n]) => n > 1).map(([id]) => id); })();
    return { path: location.pathname + location.search, title: document.title, propVisible: vis(pv), appVisible: vis(app), h1: pv.querySelector("h1")?.textContent || null, where: pv.querySelector(".mv-prop__where")?.textContent || null, facts: [...pv.querySelectorAll("#mvPropFacts .mv-pill")].map((p) => p.textContent), hero: pv.querySelector(".mv-prop__hero")?.getAttribute("src") || (pv.querySelector(".mv-prop__hero") ? "placeholder" : null), summary: pv.querySelector(".mv-prop__summary")?.textContent || null, request: (() => { const a = document.getElementById("mvPanelCheckin")?.textContent; return a && a !== "Add date" ? [a, document.getElementById("mvPanelCheckout").textContent, document.getElementById("mvPanelGuests").textContent].join(" | ") : null; })() /* UX3: booking panel fields replaced the UX1 request line */, note: pv.querySelector(".mv-prop__note")?.textContent || null, back: !!document.getElementById("mvPropBack"), bookingIdsInView: ["mvHostawayCalendar", "mvHostawayQuote", "mvHostawaySelection", "mvGuests", "mvCheckin"].filter((id) => pv.querySelector("#" + id)).length, dupIds, checkin: document.getElementById("mvCheckin").value, checkout: document.getElementById("mvCheckout").value, guests: document.getElementById("mvGuests").value, datesBtn: document.getElementById("mvDatesBtn").textContent, cards: [...document.querySelectorAll(".mv-card")].map((c) => c.dataset.apartmentId), modalOpen: document.getElementById("mvModal").getAttribute("aria-hidden") === "false", reserveBtn: [...pv.querySelectorAll("button,a")].some((b) => /reserve|book now|checkout|pay\b|check price|availability/i.test(b.textContent)), focus: document.activeElement.id, saved: document.getElementById("mvShowSaved").textContent };
  });
  T.done = () => ctx.close();
  return T;
}

// ===== A. Direct loads =====
let T = await make();
await T.go("/property/603564"); let s = await T.state();
ok("A /property/603564 loads directly: property view shown, search hidden", s.propVisible && !s.appVisible && s.h1 === "Hacienda 5 De Mayo", s);
ok("A verified facts only: location, sleeps, bedrooms, bathrooms, summary, hero image", s.where === "Bucerías, Nayarit, Mexico" && same(s.facts, ["Sleeps 2", "1 bedroom", "1 bath"]) && s.hero === "https://example.com/a.jpg" && s.summary === "s", s);
ok("A non-bookable: no reserve/price/availability controls; booking-soon note; no booking ids inside the view", !s.reserveBtn && /opens soon/.test(s.note) && s.bookingIdsInView === 0, s);
ok("A no duplicate element ids anywhere in the document", s.dupIds.length === 0, s.dupIds);
ok("A title set per property; back link present; title focused for screen readers", /^Hacienda 5 De Mayo · /.test(s.title) && s.back && s.focus === "mvPropTitle", { t: s.title, f: s.focus });
ok("A only the listings feed was called (no calendar/quote for a property page)", T.api.length === 1 && /\/api\/booking\/listings$/.test(T.api[0]), T.api);
await T.go("/property/603566"); s = await T.state();
ok("A /property/603566 loads directly", s.h1 === "East Side Studio" && s.hero === "https://example.com/b.jpg" && s.propVisible, s);
await T.page.reload(); await T.page.waitForFunction(() => document.querySelector("#mvPropertyView h1")?.textContent === "East Side Studio"); s = await T.state();
ok("A refresh keeps the property page", s.h1 === "East Side Studio" && s.propVisible && !s.appVisible, s);
await T.go("/property/603566/"); s = await T.state(); ok("A trailing slash accepted", s.h1 === "East Side Studio", s.h1);
await T.go("/property/603566-east-side-studio"); s = await T.state(); ok("A readable slug suffix accepted (id is the key)", s.h1 === "East Side Studio", s.h1);
await T.done();

// ===== B. Unknown / unsupported ids =====
T = await make();
for (const path of ["/property/999999", "/property/0603564", "/property/603564x", "/property/<script>", "/property/603564/extra", "/property/"]) {
  T.api.length = 0;
  await T.page.goto("http://localhost:5500" + path).catch(() => {});
  await T.page.waitForTimeout(600);
  s = await T.state().catch(() => null);
  if (path === "/property/603564/extra" || path === "/property/") { ok(`B ${path}: not a property route (server 404 or search view), never a Hostaway lookup`, !s || !s.propVisible, s && s.h1); continue; }
  ok(`B ${path}: 'Property not found', no calendar/quote request, back link`, s.propVisible && s.h1 === "Property not found" && s.back && T.api.every((x) => /listings/.test(x)), { h1: s.h1, api: T.api });
}
ok("B no page errors from bad ids", T.errors.length === 0, T.errors);
await T.done();

// ===== C. Query parameters =====
T = await make();
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2"); s = await T.state();
ok("C valid dates+guests initialise the shared search inputs and the booking panel fields (UX3)", s.checkin === "2026-12-20" && s.checkout === "2026-12-24" && s.guests === "2" && s.request === "Dec 20, 2026 | Dec 24, 2026 | 2 guests", s);
await T.page.waitForFunction(() => /checked/.test(document.getElementById("mvPanel")?.innerText || ""));
ok("C initialising from the URL triggers only the panel's stay check + quote for this property and stay (UX3; previously none)", same(T.api, ["/api/booking/listings", "/api/booking/calendar?id=603566&from=2026-12-20&to=2026-12-24", "/api/booking/quote?id=603566&from=2026-12-20&to=2026-12-24&guests=2"]), T.api);
const BAD = ["checkin=2026-12-24&checkout=2026-12-20", "checkin=2026-10-01&checkout=2026-10-05", "checkin=2026-12-20", "checkin=2026-12-20&checkout=2027-04-01", "checkin=2026-12-20&checkout=2026-12-24&guests=99", "checkin=2026-12-20&checkout=2026-12-24&guests=abc", "checkin=2026-02-30&checkout=2026-12-24", "checkin=%3Cscript%3E&checkout=2026-12-24", "checkin=2027-12-01&checkout=2027-12-05", "guests=-1"];
for (const q of BAD) {
  await T.go("/property/603566?" + q); s = await T.state();
  ok(`C invalid query ignored safely: ?${q}`, s.h1 === "East Side Studio" && s.checkin === "" && s.checkout === "" && s.guests === "2" && !s.request && T.errors.length === 0, { ci: s.checkin, co: s.checkout, g: s.guests, r: s.request });
}
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=3"); s = await T.state();
ok("C guests=3 (allowed option) applied; cards pre-filtered for return", s.guests === "3" && /3 guests/.test(s.request), s);
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2&utm=x&id=999"); s = await T.state();
ok("C unrelated parameters ignored", s.h1 === "East Side Studio" && s.checkin === "2026-12-20", s);
await T.done();

// ===== D. Back to results, history, state preservation =====
T = await make();
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2");
await T.page.click("#mvPropBack"); await T.page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden")); s = await T.state();
ok("D Back to results shows the search page at /?checkin&checkout&guests with inputs and date pill preserved", s.appVisible && !s.propVisible && s.path === "/?checkin=2026-12-20&checkout=2026-12-24&guests=2" && s.checkin === "2026-12-20" && /Dec 20/.test(s.datesBtn) && s.title === "maraVilla Booking Test", s);
ok("D cards intact after returning", same(s.cards, ["603564", "603566"]), s.cards);
await T.page.goBack(); await T.page.waitForFunction(() => document.querySelector("#mvPropertyView h1")); s = await T.state();
ok("D browser Back returns to the property page (focus on title)", s.propVisible && s.h1 === "East Side Studio" && s.focus === "mvPropTitle", s);
await T.page.goForward(); await T.page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden")); s = await T.state();
ok("D browser Forward returns to the results view", s.appVisible && !s.propVisible, s);
// favorites + filter survive the round trip
await T.page.click('.mv-card[data-apartment-id="603564"] .mv-heart'); await T.page.waitForTimeout(100);
await T.page.evaluate(() => { const el = document.getElementById("mvGuests"); el.value = "1"; el.dispatchEvent(new Event("change", { bubbles: true })); });
await T.page.goBack(); await T.page.waitForFunction(() => document.querySelector("#mvPropertyView h1")); 
await T.page.goForward(); await T.page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden")); s = await T.state();
ok("D favorites and guest selection preserved across Back/Forward (same document)", s.saved === "Saved (1)" && s.guests === "1" && await T.page.evaluate(() => localStorage.getItem("mv_saved") === '["hostaway-603564"]'), s);
// return by Back when there is no in-document history
await T.done(); T = await make(); await T.go("/property/603564"); await T.page.click("#mvPropBack"); await T.page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden")); s = await T.state();
ok("D Back to results from a cold property load: search page with current guests in the URL", s.appVisible && s.path === "/?guests=2", s.path);
await T.done();

// ===== E. LEGACY modal flow (test hook; since UX7a cards open property pages — see ux7a suite) =====
T = await make({ legacyModal: true });
await T.go("/"); s = await T.state();
ok("E / shows the search page; property view hidden; no booking ids duplicated", s.appVisible && !s.propVisible && s.dupIds.length === 0, s);
await T.page.evaluate(() => { for (const [id, v] of [["mvCheckin", "2026-12-20"], ["mvCheckout", "2026-12-24"]]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); } });
await openLegacyModal(T.page, "603566"); /* UX7a: legacy modal via test hook (was a card-title click) */ await T.page.waitForSelector("#mvHostawayCalendarMonths .mv-cal__month");
await T.page.waitForFunction(() => !/checking availability/.test(document.getElementById("mvHostawaySelection").innerText));
s = await T.state();
const modal = await T.page.evaluate(() => ({ titles: [...document.querySelectorAll("#mvHostawayCalendarMonths .mv-cal__title")].map((t) => t.textContent), sel: document.getElementById("mvHostawaySelection").innerText.split("\n")[0], check: !!document.getElementById("mvHostawayQuoteBtn") }));
ok("E LEGACY modal (test hook): N2 carry-over works, URL unchanged", s.modalOpen && s.path === "/" && same(modal.titles, ["December 2026", "January 2027"]) && /Dec 20 → Dec 24/.test(modal.sel) && modal.check, { s: s.path, modal });
await T.page.click("#mvHostawayQuoteBtn"); await T.page.waitForFunction(() => /direct total/.test(document.getElementById("mvHostawayQuote").innerText));
ok("E D4 pricing in the modal unchanged (6,400 -> 5,760)", /^5,760 MXN estimated direct total/.test(await T.page.evaluate(() => document.getElementById("mvHostawayQuote").innerText)));
await T.page.keyboard.press("Escape"); await T.page.waitForTimeout(80); s = await T.state(); ok("E Escape closes the modal; still on /", !s.modalOpen && s.path === "/", s);
// property route while the modal is open (e.g. user pastes URL in same tab): use pushState+popstate to emulate in-document navigation
await openLegacyModal(T.page, "603566"); /* UX7a: legacy modal via test hook (was a card-title click) */ await T.page.waitForSelector("#mvHostawayCalendarMonths .mv-cal__month");
await T.page.evaluate(() => { history.pushState({}, "", "/property/603564"); window.dispatchEvent(new PopStateEvent("popstate", { state: {} })); }); await T.page.waitForTimeout(100); s = await T.state();
ok("E navigating to a property route closes the search modal (modal belongs to the search view)", !s.modalOpen && s.propVisible && s.h1 === "Hacienda 5 De Mayo", s);
ok("E no page errors", T.errors.length === 0, T.errors);
await T.done();

// ===== F. Stale async: listings arrive after the user has already left the property route =====
T = await make({ listingsHook: () => ({ delayMs: 1200 }) });
await T.page.goto("http://localhost:5500/property/603564"); await T.page.waitForTimeout(150);
s = await T.state(); ok("F while listings load: 'Loading property…' shown, nothing invented", s.propVisible && s.h1 === "Loading property…" && s.facts.length === 0, s);
await T.page.evaluate(() => { history.pushState({}, "", "/"); window.dispatchEvent(new PopStateEvent("popstate", { state: {} })); });
await T.page.waitForTimeout(1600); s = await T.state();
ok("F late listings response does not resurrect the property view over the search page", s.appVisible && !s.propVisible && same(s.cards, ["603564", "603566"]), s);
await T.done();
T = await make({ listingsHook: () => ({ status: 502, body: { ok: false } }) });
await T.go("/property/603564"); s = await T.state();
ok("F listings failure on a property URL: safe message, back link, no crash", s.propVisible && s.h1 === "Property not found" && /could not be loaded/.test(await T.page.evaluate(() => document.getElementById("mvPropertyView").innerText)) && s.back, s);
await T.done();

// ===== G. Mobile + keyboard =====
T = await make({ vp: { width: 390, height: 844 } });
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2");
const m = await T.page.evaluate(() => { const r = document.querySelector(".mv-prop__hero").getBoundingClientRect(); return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, heroW: Math.round(r.width), heroInside: r.right <= innerWidth + 0.5, backH: document.getElementById("mvPropBack").getBoundingClientRect().height }; });
ok("G mobile 390: no horizontal scroll, hero fits the viewport", !m.overflow && m.heroInside && m.heroW >= 300, m);
await T.page.keyboard.press("Tab"); // from focused title to the back link? order: back link precedes title in DOM; Tab from title goes to next focusable
const after = await T.page.evaluate(() => document.activeElement.id || document.activeElement.tagName);
await T.page.focus("#mvPropBack"); await T.page.keyboard.press("Enter"); await T.page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden")); s = await T.state();
ok("G keyboard: Enter on 'Back to results' returns to the search page", s.appVisible && !s.propVisible, { after, path: s.path });
await T.done();

await browser.close(); server.close();
const names = Object.keys(results), pass = names.filter((n) => results[n] === "PASS").length;
console.log(JSON.stringify(results, null, 1)); console.log(`\n${pass}/${names.length} passed`); process.exit(failed ? 1 : 0);
