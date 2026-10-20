// U5b offline browser regression: real page (git HEAD of feature/hostaway-ui) in real Chromium,
// proxy calls intercepted with fixtures mirroring the live F1/F2/F3 contracts (values from the U4 live run).
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync } from "node:fs";
import { PAGE_PATH } from "../lib/page-source.mjs";
import { htmlFor, enableLegacyModal, openLegacyModal } from "../lib/modal-entry.mjs"; // UX7a: test-only legacy modal entry (see lib)
import { TODAY } from "../fixtures/pilots.mjs";
import assert from "node:assert/strict";

const PAGE = readFileSync(PAGE_PATH, "utf8");
const server = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(htmlFor(req, PAGE)); });
await new Promise((r) => server.listen(5500, "localhost", r));
const PROXY = process.env.PROXY_ORIGIN || "https://maravilla-smoobu-proxy-git-dev-joel-goralskis-projects.vercel.app";

const listings = { ok: true, checkedAt: new Date().toISOString(), listings: [
  { id: 603564, source: "hostaway", slug: "hostaway-603564", name: "Hacienda 5 De Mayo with Ocean and Town Views", sleeps: 2, bedrooms: 1, bathrooms: 1, city: "Bucerías", tagline: "Ocean & town views", summary: "s", img: "https://example.com/a.jpg", images: [], currency: "MXN", minNights: 1, maxNights: 365 },
  { id: 603566, source: "hostaway", slug: "hostaway-603566", name: "East Side Studio with Rooftop Access & Ocean Views", sleeps: 2, bedrooms: 1, bathrooms: 1, city: "Bucerías", tagline: "Rooftop", summary: "s", img: "https://example.com/b.jpg", images: [], currency: "MXN", minNights: 1, maxNights: 365 } ] };
const iso = (d) => d.toISOString().slice(0, 10);
// fixed clock: the fixtures below use November/December 2026 dates
const today = new Date(`${TODAY}T12:00:00`); const from = iso(today); const to = iso(new Date(today.getTime() + 90 * 86400000));
const nDays = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
const calendar = (id, wf, wt) => { const f = wf || from, t = wt || to; const n = Math.round((Date.parse(t) - Date.parse(f)) / 86400000) + 1; return { ok: true, listingId: Number(id), from: f, to: t, coverage: { daysRequested: n, daysReturned: n, complete: true },
  unavailable: String(id) === "603564" ? [{ arrival: "2026-11-10", departure: "2026-11-13", nights: 3 }] : [], unavailableNights: String(id) === "603564" ? 3 : 0,
  restrictions: { closedOnArrival: [], closedOnDeparture: [], minimumStay: [], maximumStay: [] }, checkedAt: new Date().toISOString() }; };
const RATE = { 603564: 2200, 603566: 1600 };
const nightsOf = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const quoteLive = (p) => { // mirrors live priceDetails math (weekly 0.9 on 603566 ≥7; monthly 0.8 both ≥30)
  const id = Number(p.id), n = nightsOf(p.from, p.to); const base = RATE[id] * n; let disc = 0, label = null;
  if (n >= 30) { disc = -base * 0.2; label = "Monthly discount"; } else if (n >= 7 && id === 603566) { disc = -base * 0.1; label = "Weekly discount"; }
  const total = base + disc; const breakdown = [{ type: "accommodation", label: "Accommodation", total: base }]; if (disc) breakdown.push({ type: "discount", label, total: disc });
  if (Number(p.guests) > 2) return { ok: true, available: false, decision: "unavailable", listingId: id, from: p.from, to: p.to, nights: n, guests: Number(p.guests), currency: "MXN", reasons: [{ code: "CAPACITY_EXCEEDED", message: "Too many guests for this listing.", maxGuests: 2 }], checkedAt: new Date().toISOString() };
  return { ok: true, available: true, decision: "quoted", listingId: id, from: p.from, to: p.to, nights: n, guests: Number(p.guests), currency: "MXN", total, nightlyAverage: Math.round(total / n * 100) / 100, breakdown, checkedAt: new Date().toISOString(), quoteBasis: "hostaway.priceDetails.v2", note: "Quote only. Prices are calculated by the property management system; no inventory is held until a reservation is confirmed." };
};
let quoteOverride = null; // (params) => {status, body, delayMs} | null
let apiLog = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await enableLegacyModal(ctx); // LEGACY-MODAL suite: the N2 modal is reached only through the test hook since UX7a
const FIXED = new Date(`${TODAY}T12:00:00`).getTime();
await ctx.addInitScript((FIXED) => { const D = Date; class M extends D { constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); } static now() { return FIXED; } } window.Date = M; }, FIXED);
const page = await ctx.newPage();
const consoleErrors = []; page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message)); page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
await page.route("**/*", async (route) => {
  const u = new URL(route.request().url());
  if (u.origin === PROXY) {
    apiLog.push(u.pathname + u.search);
    const p = Object.fromEntries(u.searchParams);
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "http://localhost:5500" }, body: JSON.stringify(body) });
    if (u.pathname === "/api/booking/listings") return json(listings);
    if (u.pathname === "/api/booking/calendar") return json(calendar(p.id, p.from, p.to));
    if (u.pathname === "/api/booking/quote") { const o = quoteOverride && quoteOverride(p); if (o) { if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs)); return json(o.body, o.status || 200); } return json(quoteLive(p)); }
    return json({ ok: false, error: "NOT_FOUND" }, 404);
  }
  if (u.hostname === "example.com") return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64") });
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return route.continue();
  apiLog.push("OTHER " + u.href); return route.abort();
});
// NOTE: the page maps hostname "localhost" (not 127.0.0.1) to the feature proxy; use localhost.
await page.goto("http://localhost:5500/consumer/booking-test.html");
try { await page.waitForSelector(".mv-card", { timeout: 15000 }); } catch (e) { console.log("DEBUG msg:", await page.evaluate(() => document.getElementById("mvMsg").textContent), "apiLog:", apiLog, "errors:", consoleErrors); throw e; }

const $ = (id) => page.locator("#" + id);
const setDate = (id, v) => page.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, [id, v]);
const setGuests = (v) => page.evaluate((v) => { const el = document.getElementById("mvGuests"); el.value = String(v); el.dispatchEvent(new Event("change", { bubbles: true })); }, v);
const waitIdle = () => page.waitForFunction(() => !document.getElementById("mvSearchBtn").disabled, null, { timeout: 15000 });
const snap = () => page.evaluate(() => ({ status: document.getElementById("availabilityStatus").textContent, msg: document.getElementById("mvMsg").textContent, cards: [...document.querySelectorAll(".mv-card")].map((c) => ({ id: c.dataset.apartmentId, shown: c.style.display !== "none", unconf: c.classList.contains("is-unconfirmed"), sub: c.querySelector(".mv-card__meta span:last-child").textContent })) }));
const search = async (ci, co, g) => { if (g) await setGuests(g); await setDate("mvCheckin", ci); await setDate("mvCheckout", co); await $("mvSearchBtn").click(); await waitIdle(); return snap(); };
const results = {}; process.on("uncaughtException", (e) => { console.log(JSON.stringify(results, null, 1)); console.log("UNCAUGHT", e.message.split("\n")[0]); process.exit(2); }); const ok = (name, cond, detail) => { results[name] = cond ? "PASS" : "FAIL " + JSON.stringify(detail); if (!cond) console.log("FAIL", name, JSON.stringify(detail)); };

// --- U1 ---
let s = await snap();
ok("U1 two cards, Hostaway, default subtitle", s.cards.length === 2 && s.cards.every((c) => c.sub === "Select dates to see price & availability"), s);
ok("U1 images loaded", await page.evaluate(() => [...document.querySelectorAll(".mv-card img")].every((i) => i.complete && i.naturalWidth > 0)));
ok("U1 no apartments panel in DOM", await page.evaluate(() => !document.querySelector(".mv-apartments, #mvApartmentsList, #mvApartmentsStatus")));
ok("U5a currency note", (await $("mvCurrencyNote").textContent()) === "Prices are currently displayed in Mexican pesos (MXN).");
// --- U4 live-shape search ---
s = await search("2026-11-20", "2026-11-23", 2);
ok("search 3n: 6,600 / 4,800, footer 1,600", s.cards[0].sub === "from 2,200 MXN/night · 6,600 MXN total" && s.cards[1].sub === "from 1,600 MXN/night · 4,800 MXN total" && s.status === "Available · from 1,600 MXN/night", s);
s = await search("2026-12-01", "2026-12-08");
ok("search weekly: 15,400 / 10,080", s.cards[0].sub.includes("15,400 MXN total") && s.cards[1].sub === "from 1,440 MXN/night · 10,080 MXN total", s);
s = await search("2027-01-05", "2027-02-04");
ok("search monthly: 52,800 / 38,400", s.cards[0].sub.includes("52,800 MXN total") && s.cards[1].sub.includes("38,400 MXN total") && s.status === "Available · from 1,280 MXN/night", s);
s = await search("2026-11-20", "2026-11-23", 3);
ok("guests 3: no cards, preserved footer", s.cards.length === 0 && s.status === "No availability for these dates" && s.msg === "No properties available for these dates.", s);
// --- injected states ---
quoteOverride = (p) => p.id === "603564" ? { body: { ok: true, available: false, decision: "unavailable", listingId: 603564, from: p.from, to: p.to, nights: 3, guests: 2, currency: "MXN", reasons: [{ code: "NIGHT_UNAVAILABLE", message: "One or more selected nights are not available." }], checkedAt: new Date().toISOString() } } : null;
s = await search("2026-11-20", "2026-11-23", 2);
ok("A unavailable+quoted: hidden w/ subtitle, reason in msg", !s.cards[0].shown && s.cards[0].sub === "Not available for these dates" && s.msg.startsWith("Hacienda 5 De Mayo") && s.status === "Available · from 1,600 MXN/night", s);
quoteOverride = (p) => p.id === "603564" ? { status: 502, body: { ok: false, error: "AVAILABILITY_UNAVAILABLE" } } : null;
s = await search("2026-11-20", "2026-11-24");
ok("B unconfirmed+quoted: dimmed, footer note", s.cards[0].shown && s.cards[0].unconf && s.cards[0].sub === "Availability unknown — try again" && s.status.endsWith("some properties could not be checked") && s.msg === "1 property could not be checked — try again.", s);
quoteOverride = (p) => ({ body: { ok: true, available: false, decision: "unavailable", listingId: Number(p.id), from: p.from, to: p.to, nights: 3, guests: 2, currency: "MXN", reasons: [{ code: "MIN_STAY", message: "Minimum stay not met." }], checkedAt: new Date().toISOString() } });
s = await search("2026-11-20", "2026-11-23");
ok("C all unavailable: both reasons, No availability", s.cards.every((c) => !c.shown && c.sub === "Not available for these dates") && s.status === "No availability for these dates" && s.msg.split(" · ").length === 2, s);
quoteOverride = (p) => p.id === "603564" ? { status: 502, body: { ok: false, error: "AVAILABILITY_UNAVAILABLE" } } : { body: { ok: true, available: false, decision: "unavailable", listingId: 603566, from: p.from, to: p.to, nights: 3, guests: 2, currency: "MXN", reasons: [{ code: "MIN_STAY", message: "Minimum stay not met." }], checkedAt: new Date().toISOString() } };
s = await search("2026-11-20", "2026-11-23");
ok("D unavailable+unconfirmed: not 'No availability'", s.status === "Availability could not be confirmed for these dates — try again", s);
quoteOverride = (p) => p.id === "603566" ? { body: { ...quoteLive(p), currency: "USD", total: 300, nightlyAverage: 100, breakdown: [{ type: "accommodation", label: "Accommodation", total: 300 }] } } : null;
s = await search("2026-11-20", "2026-11-23");
ok("E mixed currency footer per currency", s.status === "Available · from 2,200 MXN/night · from 100 USD/night", s);
quoteOverride = (p) => ({ status: 200, body: { ok: true, available: true, decision: "quoted", listingId: Number(p.id), from: p.from, to: p.to, nights: 3, guests: 2, currency: "MXN", total: 6600, nightlyAverage: 2200, breakdown: [{ type: "accommodation", label: "Accommodation", total: 6000 }] , checkedAt: "", quoteBasis: "", note: "" } });
s = await search("2026-11-20", "2026-11-23");
ok("F breakdown mismatch -> unconfirmed (no price shown)", s.cards.every((c) => c.unconf && !c.sub.includes("MXN total")), s);
// overlapping searches: slow stale 9,999 keyed to first search's dates
quoteOverride = (p) => p.from === "2026-11-20" ? { delayMs: 2500, body: { ...quoteLive(p), total: 9999, nightlyAverage: 3333, breakdown: [{ type: "accommodation", label: "Accommodation", total: 9999 }] } } : null;
await setDate("mvCheckin", "2026-11-20"); await setDate("mvCheckout", "2026-11-23"); await $("mvSearchBtn").click(); await page.waitForTimeout(400);
const mid = await snap();
await setDate("mvCheckin", "2026-12-10"); await setDate("mvCheckout", "2026-12-13"); await $("mvSearchBtn").click(); await page.waitForTimeout(3200); await waitIdle();
s = await snap();
ok("G overlapping: stale 9,999 never shown; Checking… only mid-pass", mid.cards.every((c) => c.sub === "Checking…") && !(await page.evaluate(() => document.body.textContent.includes("9,999"))) && s.cards[0].sub.includes("6,600"), { mid, s });
quoteOverride = null;
// guest change clears prices immediately
await setGuests(1); s = await snap();
ok("H guest change clears prices", s.cards.every((c) => c.sub === "Select dates to see price & availability") && s.status === "", s);
// --- U2/U3 modal ---
const openCard = async (id) => { await openLegacyModal(page, id); /* UX7a: was a card-title click */ await page.waitForSelector(".mv-cal__day--hostaway"); await page.waitForTimeout(150); };
const cell = (d) => page.locator(`.mv-cal__day--hostaway[data-date="${d}"]`);
const sel = async () => { await page.waitForFunction(() => !document.getElementById("mvHostawaySelection").innerText.includes("checking availability"), null, { timeout: 8000 }); return $("mvHostawaySelection").innerText(); }; // N2: the verdict follows a fresh stay check
await setDate("mvCheckin", ""); await setDate("mvCheckout", ""); // N2: a guest without search dates (with dates the modal opens on that month)
await openCard("603564");
ok("U2 3 blocked cells on 603564", (await page.locator(".mv-cal__day--hostaway.is-blocked").count()) === 3);
ok("U2 legend + status", (await $("mvHostawayCalendarStatus").textContent()).startsWith("Live calendar"));
ok("modal has no reserve/checkout controls", (await page.evaluate(() => [...document.querySelectorAll("#mvModal button, #mvModal a")].map((b) => b.textContent.trim()).filter((t) => /reserve|book|checkout|pay|check availability/i.test(t)))).length === 0);
ok("modal note MXN", await page.evaluate(() => document.querySelector("#mvModalContent").textContent.includes("currently displayed in Mexican pesos (MXN)")));
await cell("2026-11-09").click(); await cell("2026-11-10").click(); ok("U3 Nov 9→10 clear", (await sel()).includes("1 night · occupied nights clear"), await sel());
await cell("2026-11-09").click(); await cell("2026-11-11").click(); ok("U3 Nov 9→11 rejected at Nov 10", (await sel()).includes("unavailable night (Nov 10)"), await sel());
await cell("2026-11-10").click(); ok("U3 Nov 10 refused as check-in", (await sel()).startsWith("Nov 10 is not available for check-in"), await sel());
await cell("2026-11-13").click(); await cell("2026-11-15").click(); ok("U3 Nov 13→15 clear", (await sel()).includes("2 nights · occupied nights clear"), await sel());
ok("U3 search inputs untouched by modal", await page.evaluate(() => document.getElementById("mvCheckin").value === "" && document.getElementById("mvCheckout").value === ""));
// U4 modal quote
await cell("2026-11-20").click(); await cell("2026-11-23").click(); await $("mvHostawayQuoteBtn").click(); await page.waitForFunction(() => /total/.test(document.getElementById("mvHostawayQuote").textContent));
let qt = await $("mvHostawayQuote").innerText();
ok("U4 modal quote text", qt.startsWith("6,600 MXN total · 2,200 MXN/night · 3 nights · 1 guest"), qt);
// U5a reopen: refusal cleared; valid selection + quote cleared
await cell("2026-11-11").click(); ok("refusal set", (await sel()).startsWith("Nov 11 is not available"), await sel());
await page.evaluate(() => document.querySelector("#mvModal .mv-modal__backdrop").click()); await page.waitForTimeout(100);
await openCard("603564"); ok("U5a reopen -> neutral prompt", (await sel()) === "Select a check-in night, then a check-out day.", await sel());
await cell("2026-11-20").click(); await cell("2026-11-23").click(); await $("mvHostawayQuoteBtn").click(); await page.waitForFunction(() => /total/.test(document.getElementById("mvHostawayQuote").textContent));
await page.evaluate(() => document.querySelector("#mvModal .mv-modal__backdrop").click()); await page.waitForTimeout(100); await openCard("603564");
ok("U5a reopen keeps selection, drops quote", (await sel()).includes("Nov 20 → Nov 23") && (await $("mvHostawayQuote").textContent()) === "" && (await $("mvHostawayQuoteBtn").count()) === 1, await sel());
// modal unavailable / unconfirmed / stale
quoteOverride = () => ({ body: { ok: true, available: false, decision: "unavailable", listingId: 603564, from: "2026-11-20", to: "2026-11-23", nights: 3, guests: 1, currency: "MXN", reasons: [{ code: "MIN_STAY", message: "Minimum stay not met." }], checkedAt: new Date().toISOString() } });
await $("mvHostawayQuoteBtn").click(); await page.waitForFunction(() => /Minimum stay/.test(document.getElementById("mvHostawayQuote").textContent));
ok("modal unavailable shows reason, no price", !/MXN total/.test(await $("mvHostawayQuote").textContent()));
quoteOverride = () => ({ status: 502, body: { ok: false, error: "PRICE_UNAVAILABLE" } });
await $("mvHostawayQuoteBtn").click(); await page.waitForFunction(() => /could not be confirmed/i.test(document.getElementById("mvHostawayQuote").textContent));
ok("modal 502 -> unconfirmed + Retry", (await page.locator("#mvHostawayQuote button", { hasText: "Retry" }).count()) === 1);
quoteOverride = (p) => ({ delayMs: 2000, body: quoteLive(p) });
await $("mvHostawayQuoteBtn").click(); await page.waitForTimeout(200); await cell("2026-11-25").click(); await page.waitForTimeout(2500);
ok("modal stale quote discarded after date change", !/total/.test(await $("mvHostawayQuote").textContent()) && (await sel()).startsWith("Check-in Nov 25"), await $("mvHostawayQuote").textContent());
quoteOverride = null;
// isolation: 603566
await page.evaluate(() => document.querySelector("#mvModal .mv-modal__backdrop").click()); await page.waitForTimeout(100); await openCard("603566");
ok("isolation 603566: 0 blocked, own prompt", (await page.locator(".mv-cal__day--hostaway.is-blocked").count()) === 0 && (await sel()) === "Select a check-in night, then a check-out day.");
await page.keyboard.press("Escape"); ok("Escape closes modal", (await $("mvModal").getAttribute("aria-hidden")) === "true");
// search-bar picker still works after removing the __lastGoodBlockedDays reader
await $("mvDatesBtn").click(); await page.waitForTimeout(100);
ok("search picker opens with 2 months, 0 disabled future days", await page.evaluate(() => { const months = document.querySelectorAll("#mvCalendarMonths .mv-cal__month").length; const dis = [...document.querySelectorAll("#mvCalendarMonths .mv-cal__day.is-disabled")].filter((b) => b.dataset.date > new Date().toISOString().slice(0, 10)).length; return months === 2 && dis === 0; }));
const pick = (i) => page.evaluate((i) => { const d = [...document.querySelectorAll("#mvCalendarMonths .mv-cal__day:not(.is-disabled)")]; d[i].click(); return d[i].dataset.date; }, i);
const d1 = await pick(5); await page.waitForTimeout(50); const openAfterFirst = await page.evaluate(() => document.getElementById("mvCalendarModal").getAttribute("aria-hidden"));
const d2 = await pick(8); await page.waitForTimeout(100);
ok("picker stays open after second pick (UX6; was: closes)", (await page.evaluate(() => document.getElementById("mvCalendarModal").getAttribute("aria-hidden"))) === "false", { d1, d2, openAfterFirst });
ok("picker fills inputs", await page.evaluate(() => document.getElementById("mvCheckin").value && document.getElementById("mvCheckout").value > document.getElementById("mvCheckin").value));
await page.evaluate(() => document.getElementById("mvDatesClear").click()); ok("clear dates resets", await page.evaluate(() => !document.getElementById("mvCheckin").value && document.getElementById("availabilityStatus").textContent === ""));
// favorites
await page.keyboard.press("Escape"); // UX6: the picker no longer closes itself
ok("calendar overlay closed before favorites", await page.evaluate(() => getComputedStyle(document.getElementById("mvCalendarModal")).display === "none" || document.getElementById("mvCalendarModal").getAttribute("aria-hidden") !== "false")); await page.evaluate(() => document.querySelector('.mv-card[data-apartment-id="603564"] [data-heart]').click()); ok("favorite -> Saved (1)", (await $("mvShowSaved").textContent()) === "Saved (1)");
await page.evaluate(() => document.getElementById("mvShowSaved").click()); s = await snap(); ok("Saved filter -> 603564 only", s.cards.length === 1 && s.cards[0].id === "603564", s);
await page.evaluate(() => document.getElementById("mvShowAll").click()); s = await snap(); ok("Show all -> 2", s.cards.length === 2);
await page.reload(); await page.waitForSelector(".mv-card"); ok("favorite persists across reload", (await $("mvShowSaved").textContent()) === "Saved (1)");
// mobile
await page.setViewportSize({ width: 375, height: 812 }); await page.reload(); await page.waitForSelector(".mv-card");
ok("mobile: no horizontal scroll, note fits", await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && document.getElementById("mvCurrencyNote").getBoundingClientRect().right <= innerWidth + 1));
await openCard("603566");
ok("mobile: modal fits, cells tappable", await page.evaluate(() => { const r = document.querySelector(".mv-modal__panel").getBoundingClientRect(); const c = document.querySelector('.mv-cal__day--hostaway[data-date="2026-11-20"]').getBoundingClientRect(); return r.right <= innerWidth + 1 && c.width >= 40 && c.height >= 24; }));
await page.keyboard.press("Escape");
// network + console
ok("0 Smoobu endpoint calls; only booking API", apiLog.every((u) => /^\/api\/booking\/(listings|calendar|quote)/.test(u)), apiLog.filter((u) => !/^\/api\/booking\//.test(u)));
ok("no page errors / console errors outside injected failures", consoleErrors.filter((e) => !/Quote request failed|502|Failed to load/.test(e)).length === 0, consoleErrors);
ok("no USD/$ in page text (Hostaway UI)", !(await page.evaluate(() => /USD|\$\d/.test(document.body.innerText))));
console.log(JSON.stringify(results, null, 1));
console.log("API calls:", apiLog.length, "console errors:", consoleErrors);
await browser.close(); server.close();
const names = Object.keys(results), fails = names.filter((n) => results[n] !== "PASS").length; console.log(`\n${names.length - fails}/${names.length} passed`); process.exit(fails ? 1 : 0);
