// N2 offline browser tests: property-modal calendar navigation, editing, clearing, search-date carry-over, fail-closed behaviour.
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync } from "node:fs";
import { PAGE_PATH } from "../lib/page-source.mjs";
import { htmlFor, enableLegacyModal, openLegacyModal } from "../lib/modal-entry.mjs"; // UX7a: test-only legacy modal entry (see lib)
import { TODAY, PROXY, listings, BLOCKS, RATE, dayMs, nightsOf, addD, overlaps, quoteFor } from "../fixtures/pilots.mjs";

const PAGE = readFileSync(PAGE_PATH, "utf8");
const server = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(htmlFor(req, PAGE)); });
await new Promise((r) => server.listen(5500, "localhost", r));
const results = {}; let failed = 0;
const ok = (name, cond, detail) => { results[name] = cond ? "PASS" : "FAIL " + JSON.stringify(detail); if (!cond) { failed++; console.log("FAIL", name, JSON.stringify(detail)); } };
const browser = await chromium.launch();

async function make({ vp = { width: 1280, height: 900 }, now = TODAY } = {}) {
  const ctx = await browser.newContext({ viewport: vp });
  await enableLegacyModal(ctx); // LEGACY-MODAL suite: the N2 modal is reached only through the test hook since UX7a
  const FIXED = new Date(now + "T12:00:00").getTime();
  await ctx.addInitScript((FIXED) => { const D = Date; class M extends D { constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); } static now() { return FIXED; } } window.Date = M; }, FIXED);
  const page = await ctx.newPage();
  const T = { page, calLog: [], quoteLog: [], all: [], errors: [], hooks: { cal: null, quote: null, mutate: null } };
  page.on("pageerror", (e) => T.errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) T.errors.push(m.text()); });
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === PROXY) {
      const p = Object.fromEntries(u.searchParams); T.all.push(u.pathname + u.search);
      const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", headers: { "access-control-allow-origin": "http://localhost:5500" }, body: JSON.stringify(b) });
      if (u.pathname === "/api/booking/listings") return json(listings);
      if (u.pathname === "/api/booking/calendar") {
        T.calLog.push({ id: p.id, from: p.from, to: p.to });
        const h = T.hooks.cal && T.hooks.cal(p); if (h) { if (h.delayMs) await new Promise((r) => setTimeout(r, h.delayMs)); if (h.abort) return route.abort(); if (h.body !== undefined || h.status) return json(h.body ?? { ok: false }, h.status || 200); }
        const from = p.from, to = p.to;
        if (!from || !to || nightsOf(from, to) > 90 || from < addD(TODAY, -1)) return json({ ok: false, error: "BAD_WINDOW" }, 400);
        const n = nightsOf(from, to) + 1;
        const unavailable = (BLOCKS[p.id] || []).filter(([x, y]) => x < to && y > from).map(([x, y]) => ({ arrival: x, departure: y, nights: nightsOf(x, y) }));
        // past the observed 12-month horizon Hostaway closes everything (matches live data)
        const hz = addD(TODAY, 366); if (to >= hz) unavailable.push({ arrival: from > hz ? from : hz, departure: addD(to, 1), nights: nightsOf(from > hz ? from : hz, addD(to, 1)) });
        return json({ ok: true, listingId: Number(p.id), from, to, coverage: { daysRequested: n, daysReturned: n, complete: true }, unavailable, unavailableNights: unavailable.reduce((a, r) => a + r.nights, 0), restrictions: { closedOnArrival: [], closedOnDeparture: [], minimumStay: [], maximumStay: [] }, checkedAt: "2026-10-19T18:00:00Z" });
      }
      if (u.pathname === "/api/booking/quote") {
        T.quoteLog.push({ id: p.id, from: p.from, to: p.to, guests: p.guests });
        const id = Number(p.id), n = nightsOf(p.from, p.to);
        const base = { ok: true, listingId: id, from: p.from, to: p.to, nights: n, guests: Number(p.guests), currency: "MXN", checkedAt: "2026-10-19T18:00:00Z" };
        const h = T.hooks.quote && T.hooks.quote(p, base); if (h) { if (h.delayMs) await new Promise((r) => setTimeout(r, h.delayMs)); if (h.abort) return route.abort(); if (h.body !== undefined) return json(h.body, h.status || 200); }
        if (overlaps(id, p.from, p.to)) return json({ ...base, available: false, decision: "unavailable", reasons: [{ code: "NIGHT_UNAVAILABLE", message: "One or more selected nights are not available." }] });
        const q = quoteFor(id, n); const body = { ...base, available: true, decision: "quoted", total: q.total, nightlyAverage: Math.round(q.total / n * 100) / 100, breakdown: q.breakdown, quoteBasis: "hostaway.priceDetails.v2", note: "Quote only. Prices are calculated by the property management system; no inventory is held until a reservation is confirmed.", direct: q.direct };
        if (T.hooks.mutate) T.hooks.mutate(body);
        return json(body);
      }
      return json({ ok: false }, 404);
    }
    if (u.hostname === "example.com") return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64") });
    if (u.hostname === "localhost") return route.continue();
    T.all.push("OTHER " + u.href); return route.abort();
  });
  await page.goto("http://localhost:5500/consumer/booking-test.html");
  await page.waitForSelector(".mv-card", { timeout: 15000 });
  T.clearLogs = () => { T.calLog.length = 0; T.quoteLog.length = 0; };
  T.setDates = (a, b) => page.evaluate(([a, b]) => { for (const [id, v] of [["mvCheckin", a], ["mvCheckout", b]]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); } }, [a, b]);
  T.open = async (id) => { await openLegacyModal(page, id); /* UX7a: was a card-title click */ await page.waitForSelector("#mvHostawayCalendarMonths .mv-cal__month"); };
  T.closeModal = async () => { await page.evaluate(() => document.querySelector("#mvModal .mv-modal__backdrop").click()); await page.waitForTimeout(60); };
  T.settle = (ms = 8000) => page.waitForFunction(() => { const st = document.getElementById("mvHostawayCalendarStatus"), sm = document.getElementById("mvHostawaySelection"); return st && sm && !/Loading live calendar/.test(st.textContent) && !/checking availability/.test(sm.innerText); }, null, { timeout: ms });
  T.st = () => page.evaluate(() => { const q = (s) => document.querySelector(s); const cells = {}; document.querySelectorAll("#mvHostawayCalendarMonths .mv-cal__day--hostaway").forEach((c) => { cells[c.dataset.date] = c.dataset.state; });
    return { range: q("#mvHcalRange")?.textContent, titles: [...document.querySelectorAll("#mvHostawayCalendarMonths .mv-cal__title")].map((t) => t.textContent), prevDis: q("#mvHcalPrev")?.disabled, nextDis: q("#mvHcalNext")?.disabled, status: q("#mvHostawayCalendarStatus")?.textContent, sel: q("#mvHostawaySelection")?.innerText, quote: q("#mvHostawayQuote")?.innerText || "", checkBtn: !!q("#mvHostawayQuoteBtn"), start: q("#mvHostawayCalendarMonths .is-start")?.dataset.date || null, end: q("#mvHostawayCalendarMonths .is-end")?.dataset.date || null, cells, btns: [...document.querySelectorAll("#mvHostawaySelection button")].map((b) => b.textContent) }; });
  T.cell = (d) => page.locator(`#mvHostawayCalendarMonths .mv-cal__day--hostaway[data-date="${d}"]`);
  T.click = async (d) => { await T.cell(d).click({ force: true }); };
  T.next = async () => { await page.click("#mvHcalNext"); }; T.prev = async () => { await page.click("#mvHcalPrev"); };
  T.btn = (label) => page.locator("#mvHostawaySelection button", { hasText: label }).first();
  T.goTo = async (iso) => { for (let i = 0; i < 40; i++) { if (await page.evaluate((d) => !!document.querySelector(`#mvHostawayCalendarMonths [data-date="${d}"]`), iso)) return true; const s = await T.st(); const left = new Date(s.titles[0] + " 1"); const [y, m] = iso.split("-").map(Number); if (new Date(y, m - 1, 1) < left) { if (s.prevDis) return false; await T.prev(); } else { if (s.nextDis) return false; await T.next(); } await T.settle(); } return false; };
  T.done = () => ctx.close();
  return T;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);


const quoteText = (T) => T.page.evaluate(() => document.getElementById("mvHostawayQuote").innerText);
const waitQuote = (T) => T.page.waitForFunction(() => { const t = document.getElementById("mvHostawayQuote").innerText; return t && !/Checking price/.test(t); }, null, { timeout: 8000 });
async function modalQuote(T, id, a, b) { await T.setDates(a, b); await T.open(id); await T.settle(); await T.btn("Check price").click(); await waitQuote(T); const t = await quoteText(T); const dom = await T.page.evaluate(() => { const q = (s) => document.querySelector("#mvHostawayQuote " + s); return { direct: q(".mv-quote__direct")?.textContent || null, save: q(".mv-quote__save")?.textContent || null, std: q(".mv-quote__std")?.textContent || null, est: q(".mv-quote__esttotal")?.textContent || null, note: q(".mv-quote__directnote")?.textContent || null, fs: q(".mv-quote__direct") ? getComputedStyle(q(".mv-quote__direct")).fontSize : null, stdFs: q(".mv-quote__std") ? getComputedStyle(q(".mv-quote__std")).fontSize : null }; }); await T.closeModal(); return { t, dom }; }
async function search(T, a, b, guests = "2") { await T.setDates(a, b); await T.page.evaluate((g) => { const el = document.getElementById("mvGuests"); el.value = g; el.dispatchEvent(new Event("change", { bubbles: true })); }, guests); await T.page.evaluate(() => { const b = document.getElementById("mvSearchBtn"); b.disabled = false; b.click(); }); await T.page.waitForFunction(() => !document.getElementById("mvSearchBtn").disabled && ![...document.querySelectorAll(".mv-card__meta span:last-child")].some((s) => /Checking/.test(s.textContent)), null, { timeout: 10000 }); return cardState(T); }
const cardState = (T) => T.page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".mv-card")].map((c) => { const s = c.querySelector(".mv-card__meta span:last-child"); return [c.dataset.apartmentId, { shown: c.style.display !== "none", text: s.innerText.replace(/\n/g, " | "), price: c.querySelector(".mv-card__directprice")?.textContent || null, save: c.querySelector(".mv-card__directsave")?.textContent || null, unconf: c.classList.contains("is-unconfirmed") }]; })));
const noSavingsAnywhere = (T) => T.page.evaluate(() => !/savings|est\. direct|estimated direct|Save \d/i.test(document.body.innerText.replace("Estimated direct-booking total. Final price confirmed at checkout.", "")));

// ===== P. Six pilot prices (modal + card consistency) =====
const PILOTS = [
  ["603564", "2026-11-10", "2026-11-13", "6,600", "660", "5,940", null],
  ["603566", "2026-11-10", "2026-11-13", "4,800", "480", "4,320", null],
  ["603566", "2026-11-20", "2026-11-21", "1,600", "160", "1,440", null],
  ["603566", "2026-11-01", "2026-11-08", "10,080", "1,008", "9,072", "Weekly discount: -1,120 MXN"],
  ["603564", "2026-11-01", "2026-12-01", "52,800", "5,280", "47,520", "Monthly discount: -13,200 MXN"],
  ["603566", "2027-01-05", "2027-02-04", "38,400", "3,840", "34,560", "Monthly discount: -9,600 MXN"],
];
let T = await make();
for (const [id, a, b, std, save, est, los] of PILOTS) {
  const m = await modalQuote(T, id, a, b);
  ok(`P modal ${id} ${a}->${b}: ${std} standard, -${save} savings, ${est} est. direct total (prominent)`, m.dom.direct === `${est} MXN estimated direct total` && m.dom.std.startsWith(`Standard price: ${std} MXN`) && m.dom.save === `Estimated Book Direct savings (10%): −${save} MXN` && m.dom.est === `Estimated direct total: ${est} MXN` && m.dom.note === "Estimated direct-booking total. Final price confirmed at checkout." && parseFloat(m.dom.fs) > parseFloat(m.dom.stdFs), m.dom);
  if (los) ok(`P modal ${id} ${a}->${b}: Hostaway LOS discount line kept under the standard price (stacking)`, m.t.includes(los.replace("-", "-")) || m.t.includes(los), m.t);
  const c = await search(T, a, b);
  ok(`P card ${id} ${a}->${b}: primary ${est} est. direct total, Save ${save} (10%) · standard ${std}; same as modal`, c[id].price === `${est} MXN est. direct total` && c[id].save === `Save ${save} MXN (10%) · standard ${std} MXN`, c[id]);
}
ok("P every quote was user-initiated (one per Check price, one per card per search) and went to proxy DEV only", T.all.every((x) => !x.startsWith("OTHER")), T.all.filter((x) => x.startsWith("OTHER")));
await T.done();

// ===== S. estimate_unavailable / missing / malformed =====
T = await make();
T.hooks.mutate = (b) => { b.direct = { estimate: true, status: "estimate_unavailable", reason: "TAX_POLICY_UNRESOLVED", currency: "MXN", note: "Estimated direct-booking total. Final price confirmed at checkout." }; };
let m = await modalQuote(T, "603564", "2026-11-10", "2026-11-13");
ok("S estimate_unavailable: standard quote kept, no invented savings, honest note", m.t.startsWith("6,600 MXN total") && !m.dom.direct && !m.dom.save && /savings estimate is not available/.test(m.t), m.t);
let c = await search(T, "2026-11-10", "2026-11-13");
ok("S estimate_unavailable card: standard price only", c["603564"].text.startsWith("from 2,200 MXN/night · 6,600 MXN total") && !c["603564"].price, c["603564"]);
const BAD = {
  "missing": (b) => { delete b.direct; },
  "null": (b) => { b.direct = null; },
  "estimate:false": (b) => { b.direct.estimate = false; },
  "unknown status": (b) => { b.direct.status = "approved"; },
  "currency USD": (b) => { b.direct.currency = "USD"; },
  "string amounts": (b) => { b.direct.estimatedTotal = "5940"; },
  "total != standard - discount": (b) => { b.direct.estimatedTotal = b.direct.estimatedTotal - 100; },
  "standard != quote total": (b) => { b.direct.standardTotal += 1; b.direct.estimatedTotal += 1; },
  "discount > eligible": (b) => { b.direct.eligibleAccommodation = 100; },
  "negative discount": (b) => { b.direct.discount = -660; b.direct.estimatedTotal = b.direct.standardTotal + 660; },
  "rateBps out of range": (b) => { b.direct.rateBps = 99999; },
  "rateBps non-integer": (b) => { b.direct.rateBps = "1000"; },
  "missing policyVersion": (b) => { delete b.direct.policyVersion; },
  "zero discount": (b) => { b.direct.discount = 0; b.direct.estimatedTotal = b.direct.standardTotal; },
  "array": (b) => { b.direct = [1, 2]; },
};
for (const [name, fn] of Object.entries(BAD)) {
  T.hooks.mutate = fn; m = await modalQuote(T, "603564", "2026-11-10", "2026-11-13");
  ok(`S malformed (${name}): standard price only, no savings`, m.t.startsWith("6,600 MXN total") && !m.dom.direct && !m.dom.save && !/estimated direct/i.test(m.t), m.t.slice(0, 120));
}
T.hooks.mutate = (b) => { b.direct.currency = "USD"; }; c = await search(T, "2026-11-10", "2026-11-13");
ok("S malformed direct on cards: standard price only", !c["603564"].price && !c["603566"].price && /total$/.test(c["603564"].text), c);
ok("S no page errors from malformed payloads", T.errors.length === 0, T.errors);
await T.done();

// ===== U. Unavailable / unconfirmed never show savings =====
T = await make();
await T.setDates("2026-12-24", "2026-12-31"); await T.open(603566); await T.settle();
ok("U Dec 24-31 on 603566: refused before pricing, no Check price, no savings", !(await T.st()).checkBtn && await noSavingsAnywhere(T), (await T.st()).sel);
await T.closeModal();
c = await search(T, "2026-12-24", "2026-12-31");
ok("U Dec 24-31 search: 603566 hidden (unavailable), 603564 shows its own estimate (no block on 603564)", !c["603566"].shown && !c["603566"].price && c["603564"].price === "12,474 MXN est. direct total" && c["603564"].save === "Save 1,386 MXN (10%) · standard 13,860 MXN", c);
T.hooks.quote = (p) => (p.id === "603566" ? { body: { ok: true, available: false, decision: "unavailable", listingId: 603566, from: p.from, to: p.to, nights: nightsOf(p.from, p.to), guests: Number(p.guests), currency: "MXN", reasons: [{ code: "CAPACITY_EXCEEDED", message: "Too many guests." }], direct: { estimate: true, status: "estimated", currency: "MXN", standardTotal: 1, eligibleAccommodation: 1, discount: 0.1, estimatedTotal: 0.9, policyVersion: "direct-v1", rateBps: 1000 } } } : null);
m = await modalQuote(T, "603566", "2026-11-10", "2026-11-13");
ok("U backend 'unavailable' carrying a stray direct object: reasons shown, no savings", /Not available/.test(m.t) && !m.dom.direct && !/savings|estimated direct/i.test(m.t), m.t);
T.hooks.quote = (p) => (p.id === "603566" ? { status: 502, body: { ok: false } } : null);
m = await modalQuote(T, "603566", "2026-11-10", "2026-11-13");
ok("U unconfirmed (502): 'could not be confirmed' + Retry, no savings", /could not be confirmed/.test(m.t) && !m.dom.direct, m.t);
c = await search(T, "2026-11-10", "2026-11-13");
ok("U unconfirmed card: 'Availability unknown', dimmed, no savings; other card estimated", c["603566"].unconf && /Availability unknown/.test(c["603566"].text) && !c["603566"].price && c["603564"].price === "5,940 MXN est. direct total", c);
T.hooks.quote = (p, base) => (p.id === "603566" ? { body: { ...base, decision: "unconfirmed", available: null, direct: quoteFor(603566, 3).direct } } : null);
m = await modalQuote(T, "603566", "2026-11-10", "2026-11-13");
ok("U backend 'unconfirmed' with a direct object: still no savings", !m.dom.direct && !/estimated direct/i.test(m.t), m.t);
await T.done();

// ===== X. Stale protection =====
T = await make();
T.hooks.quote = (p) => (p.guests === "2" ? { delayMs: 900 } : null);
await T.setDates("2026-11-10", "2026-11-13");
await T.page.evaluate(() => { const b = document.getElementById("mvSearchBtn"); b.disabled = false; b.click(); }); await T.page.waitForTimeout(150);
await T.page.evaluate(() => { const el = document.getElementById("mvGuests"); el.value = "1"; el.dispatchEvent(new Event("change", { bubbles: true })); });
await T.page.waitForTimeout(1300); c = await cardState(T);
ok("X guest change while card quotes are in flight: late 2-guest savings never painted", !c["603564"].price && !c["603566"].price && Object.values(c).every((x) => !/Checking/.test(x.text)), c);
T.hooks.quote = null;
await T.page.evaluate(() => { const b = document.getElementById("mvSearchBtn"); b.disabled = false; b.click(); }); await T.page.waitForFunction(() => !!document.querySelector(".mv-card__directprice")); 
await T.setDates("2026-11-11", "2026-11-14"); c = await cardState(T);
ok("X date change clears card savings immediately (no stale price)", !c["603564"].price && !c["603566"].price, c);
await T.done();
T = await make(); await T.setDates("2026-11-10", "2026-11-13"); await T.open(603566); await T.settle();
T.hooks.quote = () => ({ delayMs: 900 }); await T.btn("Check price").click(); await T.page.waitForTimeout(100);
await T.btn("Change check-out").click(); await T.click("2026-11-12"); await T.settle(); await T.page.waitForTimeout(1000);
m = { t: await quoteText(T) };
ok("X modal date edit while quote in flight: old savings discarded, no auto re-quote", m.t === "" && (await T.st()).checkBtn, m.t);
T.hooks.quote = null; await T.btn("Check price").click(); await waitQuote(T); m.t = await quoteText(T);
ok("X re-quote for the new dates shows the new estimate (2n 3,200 -> 2,880)", /^2,880 MXN estimated direct total/.test(m.t), m.t.slice(0, 60));
await T.page.evaluate(() => { const el = document.getElementById("mvGuests"); el.value = "1"; el.dispatchEvent(new Event("change", { bubbles: true })); });
ok("X guest change clears modal savings", (await quoteText(T)) === "", await quoteText(T));
await T.btn("Check price").click(); await waitQuote(T); await T.next(); await T.settle();
ok("X calendar navigation clears modal savings", (await quoteText(T)) === "");
await T.btn("Check price").click(); await waitQuote(T); await T.btn("Clear dates").click();
ok("X Clear dates clears modal savings", (await quoteText(T)) === "");
await T.closeModal(); T.hooks.quote = (p) => (p.id === "603564" ? { delayMs: 900 } : null);
await T.setDates("2026-11-10", "2026-11-13"); await T.open(603564); await T.settle(); await T.btn("Check price").click(); await T.page.waitForTimeout(100);
await T.closeModal(); T.hooks.quote = null; await T.open(603566); await T.settle(); await T.page.waitForTimeout(1100);
ok("X property switch: 603564's late estimate never appears in 603566's modal", (await quoteText(T)) === "" && (await T.st()).checkBtn, await quoteText(T));
await T.done();

// ===== R. Regressions, layout, safety =====
T = await make();
await T.setDates("2026-12-20", "2026-12-24"); await T.open(603566); await T.settle(); let s = await T.st();
ok("R N2 intact: Dec 20-24 carried over on Dec/Jan, highlighted, Check price", s.start === "2026-12-20" && s.end === "2026-12-24" && s.checkBtn && s.titles[0] === "December 2026", s);
await T.btn("Check price").click(); await waitQuote(T);
ok("R Dec 20-24 estimate 6,400 -> 5,760", /^5,760 MXN estimated direct total/.test(await quoteText(T)), await quoteText(T));
ok("R no reserve/checkout/pay controls; no Airbnb claims", await T.page.evaluate(() => ![...document.querySelectorAll("#mvModal button, #mvModal a, .mv-card button, .mv-card a")].some((b) => /reserve|book now|checkout|pay\b|stripe/i.test(b.textContent)) && !/airbnb/i.test(document.getElementById("mvModal").innerText)));
ok("R quote box accessible: prominent total has an aria-label", await T.page.evaluate(() => /^Estimated direct total 5,760 MXN$/.test(document.querySelector(".mv-quote__direct").getAttribute("aria-label"))));
await T.closeModal();
ok("R favorites still toggle", await T.page.evaluate(async () => { const h = document.querySelector('.mv-card[data-apartment-id="603566"] .mv-heart'); const b = h.classList.contains("is-saved"); h.click(); await new Promise((r) => setTimeout(r, 50)); const a = h.classList.contains("is-saved"); h.click(); return a !== b; }));
ok("R no calls to other hosts, no Smoobu, no non-GET writes", T.all.every((x) => !x.startsWith("OTHER") && !/smoobu\//.test(x)), T.all.filter((x) => x.startsWith("OTHER")));
ok("R no page errors", T.errors.length === 0, T.errors);
await T.done();
T = await make({ vp: { width: 390, height: 844 } });
c = await search(T, "2026-11-01", "2026-11-08");
const lay = await T.page.evaluate(() => { const r = [...document.querySelectorAll(".mv-card")].map((card) => { const cr = card.getBoundingClientRect(), d = card.querySelector(".mv-card__direct"); const dr = d && d.getBoundingClientRect(); return { inside: d ? dr.right <= cr.right + 0.5 && dr.left >= cr.left - 0.5 : false }; }); return { r, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }; });
ok("R mobile 390: card savings block stays inside each card, no horizontal scroll", lay.r.every((x) => x.inside) && !lay.overflow, lay);
await T.open(603566); await T.settle(); await T.btn("Check price").click(); await waitQuote(T);
const ml = await T.page.evaluate(() => { const q = document.getElementById("mvHostawayQuote").getBoundingClientRect(); return { right: q.right, vw: innerWidth, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }; });
ok("R mobile 390: modal breakdown fits", ml.right <= ml.vw && !ml.overflow, ml);
await T.done();

await browser.close(); server.close();
const names = Object.keys(results), pass = names.filter((n) => results[n] === "PASS").length;
console.log(JSON.stringify(results, null, 1)); console.log(`\n${pass}/${names.length} passed`); process.exit(failed ? 1 : 0);
