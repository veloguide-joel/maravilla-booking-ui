// UX3: compact booking panel on /property/:id. Fixtures: deterministic pilot calendar/quote contracts
// (fixtures/pilots.mjs) incl. the real 603566 Dec 24–31 reservation; the proxy's capacity rule (sleeps 2) is
// emulated here exactly as the live backend answers it (decision "unavailable", CAPACITY_EXCEEDED).
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
const ok = (name, cond, detail) => { results[name] = cond ? "PASS" : "FAIL " + JSON.stringify(detail); if (!cond) { failed++; console.log("FAIL", name, JSON.stringify(detail)); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const browser = await chromium.launch();
const SHOTS = process.env.UX3_SHOTS || null;

async function make({ vp = { width: 1280, height: 900 }, hooks = {} } = {}) {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: "reduce" });
  const FIXED = new Date(TODAY + "T12:00:00").getTime();
  await ctx.addInitScript((FIXED) => { const D = Date; class M extends D { constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); } static now() { return FIXED; } } window.Date = M; }, FIXED);
  const page = await ctx.newPage();
  const T = { page, api: [], methods: [], other: [], errors: [], hooks };
  page.on("pageerror", (e) => T.errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Failed to load calendar|Quote request failed/.test(m.text())) T.errors.push(m.text()); });
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === PROXY) {
      const p = Object.fromEntries(u.searchParams); T.api.push(u.pathname + u.search); T.methods.push(route.request().method());
      const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", headers: { "access-control-allow-origin": "http://localhost:5500" }, body: JSON.stringify(b) });
      const H = T.hooks;
      if (u.pathname === "/api/booking/listings") return json(listings);
      if (u.pathname === "/api/booking/calendar") {
        const h = H.calendar && H.calendar(p); if (h && h.delayMs) await new Promise((r) => setTimeout(r, h.delayMs)); if (h && h.status) return json(h.body ?? { ok: false }, h.status);
        const c = calendarFor(p.id, p.from, p.to); if (h && h.mutate) h.mutate(c.body); return json(c.body, c.status);
      }
      if (u.pathname === "/api/booking/quote") {
        const h = H.quote && H.quote(p); if (h && h.delayMs) await new Promise((r) => setTimeout(r, h.delayMs)); if (h && h.status) return json(h.body ?? { ok: false }, h.status);
        const id = Number(p.id), n = nightsOf(p.from, p.to), g = Number(p.guests);
        const base = { ok: true, listingId: id, from: p.from, to: p.to, nights: n, guests: g, currency: "MXN", checkedAt: "2026-10-19T18:05:00Z" };
        if (g > 2) return json({ ...base, available: false, decision: "unavailable", reasons: [{ code: "CAPACITY_EXCEEDED", message: "This property sleeps up to 2 guests." }] });
        if (overlaps(id, p.from, p.to)) return json({ ...base, available: false, decision: "unavailable", reasons: [{ code: "NIGHT_UNAVAILABLE", message: "One or more selected nights are not available." }] });
        const q = quoteFor(id, n); const body = { ...base, available: true, decision: "quoted", total: q.total, nightlyAverage: q.total / n, breakdown: q.breakdown, direct: q.direct, note: "Quote only — no inventory is held." };
        if (h && h.mutate) h.mutate(body); return json(body);
      }
      return json({ ok: false }, 404);
    }
    if (u.hostname === "example.com") return route.fulfill({ status: 200, contentType: "image/png", body: PNG_1x1 });
    if (u.hostname === "localhost") return route.continue();
    T.other.push(route.request().method() + " " + u.href); return route.abort();
  });
  T.go = async (path, { settle = true } = {}) => {
    await page.goto("http://localhost:5500" + path);
    await page.waitForFunction(() => document.querySelector(".mv-card") || (document.querySelector("#mvPropertyView h1") && !/Loading/.test(document.querySelector("#mvPropertyView h1").textContent)), null, { timeout: 15000 });
    if (settle) await T.settle();
  };
  T.settle = () => page.waitForFunction(() => { const c = document.getElementById("mvPanel"); return !c || (c.dataset.state && c.dataset.state !== "loading"); }, null, { timeout: 15000 });
  T.panel = () => page.evaluate(() => {
    const c = document.getElementById("mvPanel");
    if (!c) return null;
    const txt = (sel) => c.querySelector(sel)?.textContent ?? null;
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom) }; };
    const dupIds = (() => { const seen = new Map(); document.querySelectorAll("[id]").forEach((el) => seen.set(el.id, (seen.get(el.id) || 0) + 1)); return [...seen].filter(([, n]) => n > 1).map(([id]) => id); })();
    const order = ["#mvPanelPrice", ".mv-panel__was", "#mvPanelCheckin", "#mvPanelGuests", "#mvPanelStatus", ".mv-panel__disclaimer"].map((s) => { const el = c.querySelector(s); return el ? Math.round(el.getBoundingClientRect().top) : null; });
    return {
      state: c.dataset.state, head: txt(".mv-panel__head"), price: txt("#mvPanelPrice"), was: txt(".mv-panel__was"), badge: txt(".mv-panel__badge"), sub: txt(".mv-panel__sub"),
      checkin: txt("#mvPanelCheckin"), checkout: txt("#mvPanelCheckout"), guests: txt("#mvPanelGuests"),
      status: document.getElementById("mvPanelStatus")?.innerText.trim() ?? "",
      rows: [...c.querySelectorAll("#mvPanelRows .mv-panel__row")].map((row) => [row.querySelector("dt").textContent, row.querySelector("dd").textContent]),
      disclaimers: [...c.querySelectorAll(".mv-panel__disclaimer")].map((d) => d.textContent), note: txt(".mv-prop__note"),
      change: { text: txt("#mvPanelChange"), href: c.querySelector("#mvPanelChange")?.getAttribute("href") ?? null },
      retry: !!c.querySelector("#mvPanelRetry"),
      controls: [...c.querySelectorAll("button,a,input,select,[role=button]")].map((b) => ({ tag: b.tagName, text: b.textContent.trim(), disabled: !!b.disabled })),
      live: [document.getElementById("mvPanelLive")?.getAttribute("aria-live"), document.getElementById("mvPanelStatus")?.getAttribute("aria-live")],
      fieldsTag: c.querySelector(".mv-panel__fields")?.tagName, order,
      rect: r(c), aside: r(document.getElementById("mvPropAside")), main: r(document.getElementById("mvPropMain")), gallery: r(document.getElementById("mvPropGallery")),
      sticky: getComputedStyle(document.getElementById("mvPropAside")).position,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      h1: document.querySelector("#mvPropertyView h1")?.textContent, dupIds,
      bookingIdsInView: ["mvHostawayCalendar", "mvHostawayCalendarMonths", "mvHostawayQuote", "mvHostawayQuoteBtn", "mvHostawaySelection", "mvGuests", "mvCheckin", "mvCheckout"].filter((id) => document.getElementById("mvPropertyView").querySelector("#" + id)).length,
      selectedApartment: window.mvSelectedApartmentId ?? null, text: c.innerText
    };
  });
  T.done = () => ctx.close();
  return T;
}
const CHECK = /reserve|book now|checkout now|pay\b|payment|confirm booking|request to book/i;
const isCalQuote = (a) => /^\/api\/booking\/(calendar|quote)\?/.test(a);

// ===== 1. 603566 Dec 20–24 (valid departure boundary before the Dec 24–31 reservation) =====
let T = await make();
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2"); let s = await T.panel();
ok("1 603566 Dec 20–24: estimated direct total 5,760 MXN prominent, standard 6,400 struck, Save 10%", s.state === "direct" && s.price === "5,760 MXN" && s.was === "6,400 MXN" && s.badge === "Save 10%" && s.sub === "Estimated direct total · 4 nights", s);
ok("1 rows: Standard total 6,400 · Book Direct savings (10%) −640 · Estimated direct total 5,760 (server values)", same(s.rows, [["Standard total", "6,400 MXN"], ["Book Direct savings (10%)", "−640 MXN"], ["Estimated direct total", "5,760 MXN"]]), s.rows);
ok("1 fields: Check-in Dec 20, 2026 · Checkout Dec 24, 2026 · 2 guests; status 'Available for these dates'", s.checkin === "Dec 20, 2026" && s.checkout === "Dec 24, 2026" && s.guests === "2 guests" && /^Available for these dates · checked /.test(s.status), s);
ok("1 disclaimer: approved D4 note + quote-only note; 'opens soon' kept", same(s.disclaimers, ["Estimated direct-booking total. Final price confirmed at checkout. Quote only — no inventory is held."]) && s.note === "Online booking for this property opens soon.", s);
ok("1 order: price/standard, then dates, guests, status, disclaimer (top to bottom)", s.order.every((v) => v !== null) && s.order[0] < s.order[2] && s.order[1] < s.order[2] && s.order[2] < s.order[3] && s.order[3] < s.order[4] && s.order[4] < s.order[5], s.order);
ok("1 reused engine: exactly one stay-window calendar check then one quote, both GET", same(T.api, ["/api/booking/listings", "/api/booking/calendar?id=603566&from=2026-12-20&to=2026-12-24", "/api/booking/quote?id=603566&from=2026-12-20&to=2026-12-24&guests=2"]) && T.methods.every((m) => m === "GET"), { api: T.api, m: T.methods });
ok("1 no checkout: no reserve/pay/booking button, no disabled buttons; the only control is 'Change dates or guests' → search", !s.controls.some((c) => CHECK.test(c.text) || c.disabled) && same(s.controls.map((c) => c.text), ["Change dates or guests"]) && s.change.href === "/?checkin=2026-12-20&checkout=2026-12-24&guests=2", s.controls);
ok("1 no duplicate ids; no booking-engine ids inside the property view; modal selection untouched", s.dupIds.length === 0 && s.bookingIdsInView === 0 && (s.selectedApartment === null || s.selectedApartment === ""), { d: s.dupIds, b: s.bookingIdsInView, sel: s.selectedApartment });
ok("1 desktop: panel in the reserved right column (sticky), beside the main column, under the gallery", s.aside.x > s.main.r && s.sticky === "sticky" && s.aside.y > s.gallery.b && s.rect.w >= 300, { a: s.aside, m: s.main, st: s.sticky });
if (SHOTS) await T.page.screenshot({ path: `${SHOTS}/ux3-desk-603566.png`, fullPage: true });
ok("no page errors (1)", T.errors.length === 0, T.errors);
await T.done();

// ===== 2. Other pilots and LOS cases (all figures from the server) =====
const LOS = [
  ["603564 3 nights Dec 20–23", "/property/603564?checkin=2026-12-20&checkout=2026-12-23&guests=2", "5,940 MXN", "6,600 MXN", [["Standard total", "6,600 MXN"], ["Book Direct savings (10%)", "−660 MXN"], ["Estimated direct total", "5,940 MXN"]]],
  ["603566 1 night Dec 20–21", "/property/603566?checkin=2026-12-20&checkout=2026-12-21&guests=1", "1,440 MXN", "1,600 MXN", [["Standard total", "1,600 MXN"], ["Book Direct savings (10%)", "−160 MXN"], ["Estimated direct total", "1,440 MXN"]]],
  ["603566 weekly 7 nights Jan 5–12 2027", "/property/603566?checkin=2027-01-05&checkout=2027-01-12&guests=2", "9,072 MXN", "10,080 MXN", [["Accommodation", "11,200 MXN"], ["Weekly discount", "−1,120 MXN"], ["Standard total", "10,080 MXN"], ["Book Direct savings (10%)", "−1,008 MXN"], ["Estimated direct total", "9,072 MXN"]]],
  ["603564 monthly 30 nights Nov 1–Dec 1", "/property/603564?checkin=2026-11-01&checkout=2026-12-01&guests=2", "47,520 MXN", "52,800 MXN", [["Accommodation", "66,000 MXN"], ["Monthly discount", "−13,200 MXN"], ["Standard total", "52,800 MXN"], ["Book Direct savings (10%)", "−5,280 MXN"], ["Estimated direct total", "47,520 MXN"]]],
  ["603566 monthly 30 nights Jan 5–Feb 4 2027", "/property/603566?checkin=2027-01-05&checkout=2027-02-04&guests=2", "34,560 MXN", "38,400 MXN", [["Accommodation", "48,000 MXN"], ["Monthly discount", "−9,600 MXN"], ["Standard total", "38,400 MXN"], ["Book Direct savings (10%)", "−3,840 MXN"], ["Estimated direct total", "34,560 MXN"]]]
];
T = await make();
for (const [name, path, est, std, rows] of LOS) {
  T.api.length = 0; await T.go(path); s = await T.panel();
  ok(`2 ${name}: ${est} estimated (standard ${std}), server breakdown + D4 rows`, s.state === "direct" && s.price === est && s.was === std && same(s.rows, rows) && T.api.filter(isCalQuote).length === 2, { s: [s.state, s.price, s.was], rows: s.rows, api: T.api });
}
await T.done();

// ===== 3. Unavailable: the real Dec 24–31 reservation on 603566 =====
T = await make();
for (const [name, path, night] of [["Dec 24–31 (reservation)", "/property/603566?checkin=2026-12-24&checkout=2026-12-31&guests=2", "Dec 24"], ["Dec 23–25 (overlaps)", "/property/603566?checkin=2026-12-23&checkout=2026-12-25&guests=2", "Dec 24"], ["Dec 30–Jan 2 (last night Dec 30)", "/property/603566?checkin=2026-12-30&checkout=2027-01-02&guests=2", "Dec 30"]]) {
  T.api.length = 0; await T.go(path); s = await T.panel();
  ok(`3 603566 ${name}: 'Not available for these dates' (night ${night}), no price, no estimate, no quote request`, s.state === "unavailable" && s.head === "Not available for these dates" && new RegExp(`unavailable night \\(${night}\\)`).test(s.status) && s.price === null && s.rows.length === 0 && !T.api.some((a) => a.includes("/quote")), { s: [s.state, s.head, s.status], api: T.api });
}
T.api.length = 0; await T.go("/property/603566?checkin=2026-12-31&checkout=2027-01-03&guests=2"); s = await T.panel();
ok("3 603566 Dec 31–Jan 3 (arrival on the reservation's departure day) is priced: 4,320 MXN", s.state === "direct" && s.price === "4,320 MXN" && s.was === "4,800 MXN", s);
T.api.length = 0; await T.go("/property/603564?checkin=2027-01-05&checkout=2027-01-09&guests=2"); s = await T.panel();
ok("3 603564 block Jan 7 2027 → unavailable (night Jan 7)", s.state === "unavailable" && /\(Jan 7\)/.test(s.status) && s.price === null, s);
ok("no page errors (3)", T.errors.length === 0, T.errors);
await T.done();

// ===== 4. Capacity =====
T = await make();
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=3"); s = await T.panel();
ok("4 guests 3 > capacity 2: server CAPACITY_EXCEEDED → 'Not available', reason shown, no price or savings", s.state === "unavailable" && s.status === "This property sleeps up to 2 guests." && s.price === null && s.rows.length === 0 && s.guests === "3 guests", s);
await T.go("/property/603564?checkin=2026-12-20&checkout=2026-12-23&guests=8"); s = await T.panel();
ok("4 guests 8 on 603564: same refusal", s.state === "unavailable" && /sleeps up to 2/.test(s.status) && s.guests === "8 guests", s);
await T.done();

// ===== 5. Unconfirmed + Retry, malformed estimates =====
let calFail = true;
T = await make({ hooks: { calendar: () => (calFail ? { status: 502 } : null) } });
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2"); s = await T.panel();
ok("5 calendar 502: 'Availability could not be confirmed', Retry, no quote request, no price", s.state === "unconfirmed" && s.head === "Availability could not be confirmed" && s.retry && s.price === null && !T.api.some((a) => a.includes("/quote")), { s, api: T.api });
calFail = false; T.api.length = 0;
await T.page.click("#mvPanelRetry"); await T.settle(); s = await T.panel();
ok("5 Retry re-runs the check and prices the stay (5,760)", s.state === "direct" && s.price === "5,760 MXN" && T.api.filter(isCalQuote).length === 2, { s: s.state, api: T.api });
await T.done();
for (const [name, hooks, expect] of [
  ["calendar incomplete coverage", { calendar: () => ({ mutate: (b) => { b.coverage.complete = false; b.coverage.daysReturned -= 1; } }) }, (s) => s.state === "unconfirmed" && s.price === null],
  ["calendar wrong window (WINDOW_MISMATCH)", { calendar: () => ({ mutate: (b) => { b.to = "2026-12-25"; } }) }, (s) => s.state === "unconfirmed" && s.price === null],
  ["calendar wrong listing", { calendar: () => ({ mutate: (b) => { b.listingId = 603564; } }) }, (s) => s.state === "unconfirmed" && s.price === null],
  ["quote 502", { quote: () => ({ status: 502 }) }, (s) => s.state === "unconfirmed" && s.head === "Price could not be confirmed" && s.retry && s.price === null],
  ["quote decision 'unconfirmed'", { quote: (p) => ({ status: 200, body: { ok: true, listingId: Number(p.id), from: p.from, to: p.to, nights: nightsOf(p.from, p.to), guests: Number(p.guests), currency: "MXN", decision: "unconfirmed", available: null, reasons: [] } }) }, (s) => s.state === "unconfirmed" && s.price === null],
  ["quote echo mismatch (other listing)", { quote: () => ({ mutate: (b) => { b.listingId = 603564; } }) }, (s) => s.state === "unconfirmed" && s.price === null],
  ["direct estimate inconsistent (estimatedTotal ≠ standard − discount)", { quote: () => ({ mutate: (b) => { b.direct.estimatedTotal = 5000; } }) }, (s) => s.state === "quoted" && s.price === "6,400 MXN" && s.badge === null && s.was === null && same(s.rows, [["Total", "6,400 MXN"]]) && !/savings/i.test(s.text)],
  ["direct estimate for another total", { quote: () => ({ mutate: (b) => { b.direct.standardTotal = 7000; } }) }, (s) => s.state === "quoted" && s.price === "6,400 MXN" && !/savings/i.test(s.text)],
  ["direct missing", { quote: () => ({ mutate: (b) => { delete b.direct; } }) }, (s) => s.state === "quoted" && s.price === "6,400 MXN" && s.sub === "Total · 4 nights · 1,600 MXN/night" && !/savings/i.test(s.text)],
  ["direct estimate_unavailable", { quote: () => ({ mutate: (b) => { b.direct = { estimate: true, status: "estimate_unavailable", reason: "TAX_UNRESOLVED", currency: "MXN" }; } }) }, (s) => s.state === "quoted" && s.price === "6,400 MXN" && s.disclaimers[0].startsWith("A Book Direct savings estimate is not available") && !/savings \(/.test(s.text)],
  ["direct in another currency", { quote: () => ({ mutate: (b) => { b.direct.currency = "USD"; } }) }, (s) => s.state === "quoted" && !/USD/.test(s.text)]
]) {
  T = await make({ hooks }); await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2"); s = await T.panel();
  ok(`5 ${name}`, expect(s) && T.errors.length === 0, { s: [s.state, s.head, s.price, s.was, s.badge, s.sub, s.rows, s.disclaimers, s.status], e: T.errors });
  await T.done();
}

// ===== 6. Absent / malformed inherited values =====
T = await make();
for (const [name, path, guests] of [["no query", "/property/603566", "2 guests"], ["guests only", "/property/603566?guests=1", "1 guest"], ["check-in only", "/property/603566?checkin=2026-12-20", "2 guests"], ["reversed dates", "/property/603566?checkin=2026-12-24&checkout=2026-12-20", "2 guests"], ["past check-in", "/property/603566?checkin=2026-10-01&checkout=2026-10-05", "2 guests"], ["over 90 nights", "/property/603566?checkin=2026-12-20&checkout=2027-04-01", "2 guests"], ["beyond horizon", "/property/603566?checkin=2027-12-01&checkout=2027-12-05", "2 guests"], ["invalid date", "/property/603566?checkin=2026-02-30&checkout=2026-12-24", "2 guests"], ["script", "/property/603566?checkin=%3Cscript%3E&checkout=2026-12-24", "2 guests"], ["guests 99", "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=99", "2 guests"]]) {
  T.api.length = 0; await T.go(path); s = await T.panel();
  ok(`6 ${name}: 'Select dates to see price', fields 'Not selected', ${guests}, no calendar/quote request, no amount`, s.state === "empty" && s.head === "Select dates to see price" && s.checkin === "Not selected" && s.checkout === "Not selected" && s.guests === guests && s.price === null && !/MXN/.test(s.text) && !T.api.some(isCalQuote) && s.change.text === "Choose dates on the search page", { s: [s.state, s.checkin, s.guests, s.change], api: T.api });
}
ok("6 no page errors", T.errors.length === 0, T.errors);
await T.done();

// ===== 7. Stale responses during property / view changes =====
T = await make({ hooks: { calendar: (p) => (p.id === "603566" ? { delayMs: 1500 } : null) } });
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2", { settle: false });
await T.page.waitForFunction(() => document.getElementById("mvPanel")?.dataset.state === "loading");
await T.page.evaluate(() => { history.pushState({}, "", "/property/603564?checkin=2026-12-20&checkout=2026-12-24&guests=2"); window.dispatchEvent(new PopStateEvent("popstate", { state: {} })); });
await T.settle(); await T.page.waitForTimeout(2000); s = await T.panel();
ok("7 late 603566 answer after switching to 603564: panel shows 603564's own price (7,920), never 603566's", s.h1 === "Hacienda 5 De Mayo" && s.price === "7,920 MXN" && s.was === "8,800 MXN", s);
ok("7 the superseded 603566 check never reached the quote step", !T.api.some((a) => a.startsWith("/api/booking/quote?id=603566")), T.api);
await T.done();
T = await make({ hooks: { quote: () => ({ delayMs: 1500 }) } });
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2", { settle: false });
for (let i = 0; i < 50 && !T.api.some((a) => a.includes("/quote")); i++) await T.page.waitForTimeout(50); // the quote request is in flight
await T.page.click("#mvPropBack"); await T.page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden"));
await T.page.waitForTimeout(1800);
const hidden = await T.page.evaluate(() => ({ state: document.getElementById("mvPanel")?.dataset.state ?? null, price: document.getElementById("mvPanelPrice")?.textContent ?? null, app: !document.getElementById("mv-app").classList.contains("mv-view-hidden") }));
ok("7 late quote after leaving to the results view: discarded (hidden panel stays unpriced), results shown", hidden.app && hidden.price === null && hidden.state === "loading", hidden);
await T.page.goBack(); await T.page.waitForSelector("#mvPanel"); await T.settle(); s = await T.panel();
ok("7 coming back re-checks freshly and prices correctly", s.price === "5,760 MXN", s);
ok("7 no page errors", T.errors.length === 0, T.errors);
await T.done();
T = await make({ hooks: { calendar: () => ({ delayMs: 900 }) } });
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2", { settle: false });
await T.page.waitForFunction(() => document.getElementById("mvPanel")?.dataset.state === "loading");
await T.page.reload(); await T.page.waitForSelector("#mvPanel"); await T.settle(); s = await T.panel();
ok("7 refresh mid-check: fresh check completes normally", s.price === "5,760 MXN", s);
await T.done();

// ===== 8. Search/modal parity and isolation =====
T = await make();
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2"); const panelVals = await T.panel();
await T.page.click("#mvPanelChange"); await T.page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden"));
const searchState = await T.page.evaluate(() => ({ path: location.pathname + location.search, ci: document.getElementById("mvCheckin").value, co: document.getElementById("mvCheckout").value, g: document.getElementById("mvGuests").value }));
ok("8 'Change dates or guests' returns to the search page with the same dates and guests", searchState.path === "/?checkin=2026-12-20&checkout=2026-12-24&guests=2" && searchState.ci === "2026-12-20" && searchState.g === "2", searchState);
await T.page.click('.mv-card[data-apartment-id="603566"] .mv-card__title'); await T.page.waitForSelector("#mvHostawayCalendarMonths .mv-cal__month");
await T.page.waitForFunction(() => !/checking availability/.test(document.getElementById("mvHostawaySelection").innerText));
await T.page.click("#mvHostawayQuoteBtn"); await T.page.waitForFunction(() => /direct total/.test(document.getElementById("mvHostawayQuote").innerText));
const modal = await T.page.evaluate(() => ({ text: document.getElementById("mvHostawayQuote").innerText, sel: document.getElementById("mvHostawaySelection").innerText.split("\n")[0], path: location.pathname, selected: String(window.mvSelectedApartmentId) }));
ok("8 modal still opens from the card (URL /), carries Dec 20 → Dec 24, and quotes the same figures as the panel", modal.path === "/" && /Dec 20 → Dec 24/.test(modal.sel) && modal.text.startsWith(panelVals.price) && modal.text.includes(`Standard price: ${panelVals.was}`) && modal.text.includes("−640 MXN"), { modal, panel: [panelVals.price, panelVals.was] });
// property page while the modal state exists: no duplicate ids, modal state untouched by the panel
await T.page.keyboard.press("Escape");
await T.page.evaluate(() => { history.pushState({ mvFrom: "search" }, "", "/property/603564?checkin=2026-12-20&checkout=2026-12-24&guests=2"); window.dispatchEvent(new PopStateEvent("popstate", { state: { mvFrom: "search" } })); });
await T.settle(); s = await T.panel();
ok("8 with the modal's state built and the panel rendered: no duplicate ids; mvSelectedApartmentId still the modal's (603566-slug), not changed by the panel", s.dupIds.length === 0 && String(s.selectedApartment) === modal.selected && s.price === "7,920 MXN", { d: s.dupIds, sel: s.selectedApartment, m: modal.selected });
await T.page.goBack(); await T.page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden"));
await T.page.click('.mv-card[data-apartment-id="603566"] .mv-card__title'); await T.page.waitForSelector("#mvHostawayCalendarMonths .mv-cal__month");
await T.page.waitForFunction(() => !/checking availability/.test(document.getElementById("mvHostawaySelection").innerText));
await T.page.click("#mvHostawayQuoteBtn"); await T.page.waitForFunction(() => /direct total/.test(document.getElementById("mvHostawayQuote").innerText));
ok("8 after visiting the panel, the modal still quotes 5,760 (no shared-state interference)", /^5,760 MXN estimated direct total/.test(await T.page.evaluate(() => document.getElementById("mvHostawayQuote").innerText)));
ok("8 no page errors", T.errors.length === 0, T.errors);
await T.done();

// ===== 9. Responsive 390 / 320 =====
for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
  T = await make({ vp }); await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2"); s = await T.panel();
  ok(`9 ${vp.width}px: compact panel right under the photos, above the facts; not sticky; no overflow`, !s.overflow && s.rect.y >= s.gallery.b && s.aside.b <= s.main.y && s.sticky === "static" && s.rect.r <= vp.width, { r: s.rect, g: s.gallery, m: s.main, st: s.sticky, o: s.overflow });
  ok(`9 ${vp.width}px: price, dates and guests all readable inside the card`, s.price === "5,760 MXN" && s.checkin === "Dec 20, 2026" && s.checkout === "Dec 24, 2026" && await T.page.evaluate((w) => [...document.querySelectorAll("#mvPanel .mv-panel__field, #mvPanel .mv-panel__row")].every((e) => e.getBoundingClientRect().right <= w), vp.width), s);
  ok(`9 ${vp.width}px: panel height stays compact (< 480px)`, s.rect.h < 480, s.rect.h);
  ok(`9 ${vp.width}px: photo carousel layout unchanged; facts follow the panel`, await T.page.evaluate(() => getComputedStyle(document.getElementById("mvPropGalleryTrack")).display === "flex" && document.getElementById("mvPropFacts").getBoundingClientRect().top > document.getElementById("mvPanel").getBoundingClientRect().bottom));
  ok(`9 ${vp.width}px: redundant bottom total row hidden on phones; standard + savings rows visible`, await T.page.evaluate(() => { const rows = [...document.querySelectorAll("#mvPanelRows .mv-panel__row")]; const v = rows.filter((r) => getComputedStyle(r).display !== "none").map((r) => r.querySelector("dt").textContent); return JSON.stringify(v) === JSON.stringify(["Standard total", "Book Direct savings (10%)"]); }));
  if (SHOTS) await T.page.screenshot({ path: `${SHOTS}/ux3-m${vp.width}-603566.png`, fullPage: true });
  await T.go("/property/603564"); s = await T.panel();
  ok(`9 ${vp.width}px no dates: small 'Select dates' card, no overflow`, s.state === "empty" && s.rect.h < 300 && !s.overflow, s.rect);
  await T.done();
}

// ===== 10. Keyboard / accessibility =====
T = await make(); await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2"); s = await T.panel();
const tab = []; for (let i = 0; i < 2; i++) { await T.page.keyboard.press("Tab"); tab.push(await T.page.evaluate(() => document.activeElement.id)); }
ok("10 Tab from the title: Show all photos → Change dates or guests (panel precedes the content in DOM and on phones; amenities order covered in UX2c)", same(tab, ["mvPropGalleryAll", "mvPanelChange"]), tab);
ok("10 price and status are polite live regions; dates/guests and price rows are description lists; reserved column labelled", same(s.live, ["polite", "polite"]) && s.fieldsTag === "DL" && (await T.page.evaluate(() => document.getElementById("mvPropAside").getAttribute("aria-label"))) === "Booking information", s.live);
ok("10 no fake inputs: dates/guests are text, not buttons/inputs", !(await T.page.evaluate(() => !!document.querySelector("#mvPanel input, #mvPanel select, #mvPanel .mv-panel__field button, #mvPanel [contenteditable]"))));
await T.page.focus("#mvPanelChange"); await T.page.keyboard.press("Enter"); await T.page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden"));
ok("10 Enter on 'Change dates or guests' returns to search", await T.page.evaluate(() => location.pathname === "/"));
await T.done();
T = await make({ hooks: { calendar: () => ({ status: 503 }) } }); await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2");
await T.page.focus("#mvPanelRetry"); T.api.length = 0; await T.page.keyboard.press("Enter"); await T.settle();
ok("10 Retry is a real keyboard-operable button (Enter re-runs the check)", T.api.some((a) => a.includes("/calendar")));
await T.done();

// ===== 11. Network / writes =====
T = await make(); await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2");
await T.go("/property/603564?checkin=2026-12-20&checkout=2026-12-23&guests=2");
ok("11 only GET listings/calendar/quote to the proxy; nothing else contacted; no hold/reservation/checkout/payment paths", T.other.length === 0 && T.methods.every((m) => m === "GET") && T.api.every((a) => /^\/api\/booking\/(listings|calendar|quote)(\?|$)/.test(a)) && !T.api.some((a) => /hold|reserv|checkout|pay|stripe|smoobu/i.test(a)), { other: T.other, api: T.api, m: [...new Set(T.methods)] });
ok("11 no page errors", T.errors.length === 0, T.errors);
await T.done();

await browser.close(); server.close();
const names = Object.keys(results), pass = names.filter((n) => results[n] === "PASS").length;
console.log(JSON.stringify(results, null, 1)); console.log(`\n${pass}/${names.length} passed`); process.exit(failed ? 1 : 0);
