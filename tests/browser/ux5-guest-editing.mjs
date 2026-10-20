// UX5: guest editing in the property booking panel + automatic validated repricing through the UX3 pipeline.
// Deterministic fixtures (fixed clock 2026-10-19, real 603566 Dec 24–31 reservation, 603564 Jan 7–Mar 2 2027 block);
// the proxy's capacity rule (sleeps 2 → CAPACITY_EXCEEDED for 3+) is emulated as the live backend answers it.
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
const ok = (name, cond, detail) => { results[name] = cond ? "PASS" : "FAIL " + JSON.stringify(detail).slice(0, 900); if (!cond) { failed++; console.log("FAIL", name, JSON.stringify(detail).slice(0, 900)); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const browser = await chromium.launch();
const SHOTS = process.env.UX5_SHOTS || null;
const sl = (ms) => new Promise((r) => setTimeout(r, ms));
const UNAVAILABLE_DIRECT = (b) => { b.direct = { estimate: true, status: "estimate_unavailable", reason: "TEST_MARKER", currency: "MXN" }; };

async function make({ vp = { width: 1280, height: 900 }, hooks = {}, legacyModal = false } = {}) {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: "reduce" });
  if (legacyModal) await enableLegacyModal(ctx);
  const FIXED = new Date(TODAY + "T12:00:00").getTime();
  await ctx.addInitScript((FIXED) => { const D = Date; class M extends D { constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); } static now() { return FIXED; } } window.Date = M; }, FIXED);
  const page = await ctx.newPage();
  const T = { page, api: [], methods: [], other: [], errors: [], hooks };
  page.on("pageerror", (e) => T.errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Failed to load calendar|Quote request failed/.test(m.text())) T.errors.push(m.text()); });
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === PROXY) {
      const p = Object.fromEntries(u.searchParams); T.api.push(u.pathname.replace("/api/booking/", "") + u.search); T.methods.push(route.request().method());
      const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", headers: { "access-control-allow-origin": "http://localhost:5500" }, body: JSON.stringify(b) });
      const H = T.hooks;
      if (u.pathname === "/api/booking/listings") return json(listings);
      if (u.pathname === "/api/booking/calendar") { const h = H.calendar && H.calendar(p); if (h && h.delayMs) await sl(h.delayMs); if (h && h.status) return json({ ok: false }, h.status); const c = calendarFor(p.id, p.from, p.to); return json(c.body, c.status); }
      if (u.pathname === "/api/booking/quote") {
        const h = H.quote && H.quote(p); if (h && h.delayMs) await sl(h.delayMs); if (h && h.status) return json({ ok: false }, h.status);
        const id = Number(p.id), n = nightsOf(p.from, p.to), g = Number(p.guests); const base = { ok: true, listingId: id, from: p.from, to: p.to, nights: n, guests: g, currency: "MXN", checkedAt: "2026-10-19T18:05:00Z" };
        if (g > 2) return json({ ...base, available: false, decision: "unavailable", reasons: [{ code: "CAPACITY_EXCEEDED", message: "This property sleeps up to 2 guests." }] });
        if (overlaps(id, p.from, p.to)) return json({ ...base, available: false, decision: "unavailable", reasons: [{ code: "NIGHT_UNAVAILABLE", message: "One or more selected nights are not available." }] });
        const q = quoteFor(id, n); const body = { ...base, available: true, decision: "quoted", total: q.total, nightlyAverage: q.total / n, breakdown: q.breakdown, direct: q.direct, note: "Quote only." };
        if (h && h.mutate) h.mutate(body); return json(body);
      }
      return json({ ok: false }, 404);
    }
    if (u.hostname === "example.com") return route.fulfill({ status: 200, contentType: "image/png", body: PNG_1x1 });
    if (u.hostname === "localhost") return route.continue();
    T.other.push(u.href); return route.abort();
  });
  T.settle = () => page.waitForFunction(() => { const c = document.getElementById("mvPanel"); return !c || (c.dataset.state && c.dataset.state !== "loading"); }, null, { timeout: 15000 });
  T.go = async (path, { settle = true } = {}) => { await page.goto("http://localhost:5500" + path); await page.waitForFunction(() => document.querySelector(".mv-card") || (document.querySelector("#mvPropertyView h1") && !/Loading/.test(document.querySelector("#mvPropertyView h1").textContent)), null, { timeout: 15000 }); if (settle) await T.settle(); };
  T.pick = async (n, { settle = true } = {}) => { await page.selectOption("#mvPanelGuestsSelect", String(n)); if (settle) await T.settle(); };
  T.panel = () => page.evaluate(() => {
    const c = document.getElementById("mvPanel"); if (!c) return null; const t = (s) => c.querySelector(s)?.textContent ?? null; const sel = document.getElementById("mvPanelGuestsSelect");
    const dupIds = (() => { const seen = new Map(); document.querySelectorAll("[id]").forEach((el) => seen.set(el.id, (seen.get(el.id) || 0) + 1)); return [...seen].filter(([, n]) => n > 1).map(([id]) => id); })();
    return { state: c.dataset.state, price: t("#mvPanelPrice"), was: t(".mv-panel__was"), badge: t(".mv-panel__badge"), checkin: t("#mvPanelCheckin"), checkout: t("#mvPanelCheckout"), guests: t("#mvPanelGuests"),
      status: document.getElementById("mvPanelStatus")?.innerText.replace(/\s+/g, " ").trim() ?? "", disclaimer: t(".mv-panel__disclaimer"),
      sel: sel ? { value: sel.value, options: [...sel.options].map((o) => [o.value, o.textContent, o.disabled]), label: sel.getAttribute("aria-label"), focused: document.activeElement === sel } : null,
      over: c.querySelector(".mv-panel__field--guests")?.classList.contains("is-over") ?? null,
      url: location.pathname + location.search, hist: history.length, shared: document.getElementById("mvGuests").value, dupIds, node: c.dataset.probe || null };
  });
  T.mark = () => page.evaluate(() => { document.getElementById("mvPanel").dataset.probe = "same-node"; }); // a rebuilt panel loses this marker
  T.done = () => ctx.close();
  return T;
}
const quotes = (api) => api.filter((a) => a.startsWith("quote"));
const cals = (api) => api.filter((a) => a.startsWith("calendar"));

// ===== 1. Change guests on a priced stay (603566 Dec 20–24) =====
let T = await make();
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2"); let p = await T.panel();
ok("1 initial: committed guests 2 shown in the field; native select labelled 'Guests' with options 1..capacity (2)", p.guests === "2 guests" && p.sel.value === "2" && same(p.sel.options, [["1", "1 guest", false], ["2", "2 guests", false]]) && p.sel.label === "Guests" && p.price === "5,760 MXN", p);
const h0 = p.hist; T.api.length = 0;
await T.pick(1, { settle: false }); let mid = await T.panel();
ok("1 2 → 1: old price and savings removed immediately (checking state), field shows 1 guest", mid.state === "loading" && mid.price === null && mid.badge === null && mid.guests === "1 guest", mid);
await T.settle(); p = await T.panel();
ok("1 2 → 1: existing UX3 pipeline ran once (stay check + quote with guests=1); price 6,400 → 5,760 with Save 10%", same(T.api, ["calendar?id=603566&from=2026-12-20&to=2026-12-24", "quote?id=603566&from=2026-12-20&to=2026-12-24&guests=1"]) && p.state === "direct" && p.price === "5,760 MXN" && p.was === "6,400 MXN" && p.badge === "Save 10%", { api: T.api, p });
ok("1 2 → 1: URL replaced in place (dates and property kept), history length unchanged, search state mirrors it, focus stays on the selector", p.url === "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=1" && p.hist === h0 && p.shared === "1" && p.sel.focused && p.sel.value === "1", p);
T.api.length = 0; await T.pick(2); p = await T.panel();
ok("1 1 → 2: fresh quote with guests=2; URL back to guests=2; history still unchanged", same(quotes(T.api), ["quote?id=603566&from=2026-12-20&to=2026-12-24&guests=2"]) && p.url.endsWith("guests=2") && p.hist === h0 && p.guests === "2 guests" && p.price === "5,760 MXN", { api: T.api, p });
await T.mark(); T.api.length = 0;
await T.page.evaluate(() => { const s = document.getElementById("mvPanelGuestsSelect"); s.value = "2"; s.dispatchEvent(new Event("change", { bubbles: true })); }); await sl(300); p = await T.panel();
ok("1 same value re-selected: no request, panel not rebuilt, URL unchanged", T.api.length === 0 && p.node === "same-node" && p.url.endsWith("guests=2"), { api: T.api, node: p.node });
ok("1 no duplicate ids; no page errors", p.dupIds.length === 0 && T.errors.length === 0, { d: p.dupIds, e: T.errors });
if (SHOTS) await T.page.screenshot({ path: `${SHOTS}/ux5-desk.png` });
await T.done();

// ===== 2. Other pilot + LOS (prices from the server, nothing computed in the browser) =====
T = await make();
await T.go("/property/603564?checkin=2026-12-20&checkout=2026-12-23&guests=2"); T.api.length = 0; await T.pick(1); p = await T.panel();
ok("2 603564 3 nights, 2 → 1: quote guests=1, 6,600 → 5,940", same(quotes(T.api), ["quote?id=603564&from=2026-12-20&to=2026-12-23&guests=1"]) && p.price === "5,940 MXN" && p.was === "6,600 MXN", { api: T.api, p });
await T.go("/property/603566?checkin=2027-01-05&checkout=2027-01-12&guests=2"); await T.pick(1); p = await T.panel();
ok("2 603566 weekly after a guest change: 10,080 → 9,072 (server LOS + D4)", p.price === "9,072 MXN" && p.was === "10,080 MXN", p);
await T.go("/property/603564?checkin=2026-11-01&checkout=2026-12-01&guests=1"); await T.pick(2); p = await T.panel();
ok("2 603564 monthly after 1 → 2: 52,800 → 47,520", p.price === "47,520 MXN" && p.was === "52,800 MXN" && p.guests === "2 guests", p);
await T.done();

// ===== 3. Capacity =====
T = await make();
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=3"); p = await T.panel();
ok("3 URL guests=3 > capacity 2: server refusal shown + hint to choose fewer; no price; field flagged", p.state === "unavailable" && p.price === null && /This property sleeps up to 2 guests\./.test(p.status) && /Choose fewer guests above\./.test(p.status) && p.over === true && p.guests === "3 guests", p);
ok("3 selector shows the over-capacity count as a disabled, labelled option (not silently accepted)", p.sel.value === "3" && same(p.sel.options, [["1", "1 guest", false], ["2", "2 guests", false], ["3", "3 guests (more than this property sleeps)", true]]), p.sel);
T.api.length = 0; await T.pick(2); p = await T.panel();
ok("3 correcting to 2 on the property page reprices (quote guests=2 → 5,760); flag and extra option gone", same(quotes(T.api), ["quote?id=603566&from=2026-12-20&to=2026-12-24&guests=2"]) && p.price === "5,760 MXN" && p.over === false && p.sel.options.length === 2 && p.url.endsWith("guests=2"), { api: T.api, p });
T.api.length = 0;
await T.page.evaluate(() => { const s = document.getElementById("mvPanelGuestsSelect"); const o = document.createElement("option"); o.value = "5"; o.textContent = "5"; s.appendChild(o); s.value = "5"; s.dispatchEvent(new Event("change", { bubbles: true })); }); await sl(300); p = await T.panel();
ok("3 a forged option above capacity is rejected: value reset to 2, no request, URL unchanged", T.api.length === 0 && p.shared === "2" && p.url.endsWith("guests=2") && p.price === "5,760 MXN", { api: T.api, p: [p.shared, p.url, p.price] });
await T.go("/property/603566?guests=4"); p = await T.panel();
ok("3 no dates + guests=4: no request, 'Select dates' with the capacity hint and flagged field", p.state === "empty" && /Choose fewer guests above/.test(p.status) && p.over === true && !T.api.some((a) => a.startsWith("quote")), p);
await T.done();

// ===== 4. URL guest parameter handling (UX1 all-or-nothing rule unchanged) =====
T = await make();
for (const [name, path, expect] of [
  ["valid guests=1", "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=1", (p) => p.guests === "1 guest" && p.price === "5,760 MXN"],
  ["missing guests → default 2", "/property/603566?checkin=2026-12-20&checkout=2026-12-24", (p) => p.guests === "2 guests" && p.price === "5,760 MXN"],
  ["guests=abc → whole query ignored (UX1 rule): no dates, guests 2, no quote", "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=abc", (p) => p.state === "empty" && p.guests === "2 guests" && p.checkin === "Add date"],
  ["guests=0 → ignored the same way", "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=0", (p) => p.state === "empty" && p.guests === "2 guests"],
  ["guests=99 → ignored the same way", "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=99", (p) => p.state === "empty" && p.guests === "2 guests"],
  ["unavailable dates + guests=1 → refused, no price", "/property/603566?checkin=2026-12-24&checkout=2026-12-31&guests=1", (p) => p.state === "unavailable" && p.price === null && p.guests === "1 guest"]
]) {
  T.api.length = 0; await T.go(path); p = await T.panel();
  ok(`4 ${name}`, expect(p) && (p.state !== "empty" || !T.api.some((a) => a.startsWith("quote"))), { p: [p.state, p.guests, p.checkin, p.price], api: T.api });
}
await T.done();

// ===== 5. No dates; date ↔ guest ordering; date-editor isolation =====
T = await make();
await T.go("/property/603566"); const h5 = (await T.panel()).hist; T.api.length = 0;
await T.pick(1); p = await T.panel();
ok("5 no dates: 2 → 1 updates the field and URL (?guests=1) only — no calendar/quote request, still 'Select dates'", p.state === "empty" && p.guests === "1 guest" && p.url === "/property/603566?guests=1" && T.api.length === 0 && p.hist === h5, { p, api: T.api });
// guests first, then dates: Apply uses the committed guest count
await T.page.click("#mvPanelCheckin"); await T.page.waitForSelector("#mvPdCalMonths .mv-cal__month");
for (let i = 0; i < 2; i++) { await T.page.evaluate(() => document.getElementById("mvPdCalNext").click()); await sl(80); }
await T.page.waitForFunction(() => !/Loading/.test(document.getElementById("mvPdCalStatus").textContent));
await T.page.click('#mvPdCalMonths .mv-cal__day[data-date="2026-12-20"]', { force: true }); await T.page.click('#mvPdCalMonths .mv-cal__day[data-date="2026-12-24"]', { force: true });
await T.page.waitForFunction(() => !document.getElementById("mvPdCalApply").disabled);
const guestFocusable = await T.page.evaluate(() => { const s = document.getElementById("mvPanelGuestsSelect"); s.focus(); return document.activeElement === s; });
ok("5 while the date editor is open the guest selector cannot be reached (page behind is inert)", guestFocusable === false && (await T.panel()).guests === "1 guest");
T.api.length = 0; await T.page.click("#mvPdCalApply"); await T.settle(); p = await T.panel();
ok("5 guests then dates: Apply quotes with the committed guest count (guests=1); URL carries dates + guests=1", same(quotes(T.api), ["quote?id=603566&from=2026-12-20&to=2026-12-24&guests=1"]) && p.url === "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=1" && p.price === "5,760 MXN", { api: T.api, p });
// dates applied, then guests
T.api.length = 0; await T.pick(2); p = await T.panel();
ok("5 dates then guests: a fresh validated quote for the applied dates with guests=2", same(T.api, ["calendar?id=603566&from=2026-12-20&to=2026-12-24", "quote?id=603566&from=2026-12-20&to=2026-12-24&guests=2"]) && p.guests === "2 guests" && p.checkin === "Dec 20, 2026", { api: T.api, p });
// cancel a date edit: guests and price preserved
T.api.length = 0; await T.page.click("#mvPanelCheckout"); await T.page.waitForSelector("#mvPdCalMonths .mv-cal__month"); await T.page.waitForFunction(() => !/Loading/.test(document.getElementById("mvPdCalStatus").textContent));
await T.page.click('#mvPdCalMonths .mv-cal__day[data-date="2026-12-22"]', { force: true }); await sl(300); await T.page.keyboard.press("Escape"); await sl(200); p = await T.panel();
ok("5 cancelling a date edit keeps the committed guests (2), dates and price; no quote", p.guests === "2 guests" && p.checkout === "Dec 24, 2026" && p.price === "5,760 MXN" && quotes(T.api).length === 0, { p, api: T.api });
ok("5 no page errors", T.errors.length === 0, T.errors);
await T.done();

// ===== 6. Unavailable / unconfirmed after a guest change =====
T = await make();
await T.go("/property/603566?checkin=2026-12-24&checkout=2026-12-31&guests=2"); T.api.length = 0; await T.pick(1); p = await T.panel();
ok("6 Dec 24–31 reservation, 2 → 1: still 'Not available' (calendar refuses before any quote), no price", p.state === "unavailable" && p.price === null && /unavailable night \(Dec 24\)/.test(p.status) && quotes(T.api).length === 0, { p, api: T.api });
await T.done();
let quoteFail = false;
T = await make({ hooks: { quote: () => (quoteFail ? { status: 502 } : null) } });
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2"); quoteFail = true; await T.pick(1); p = await T.panel();
ok("6 quote 502 after a guest change: 'Price could not be confirmed' + Retry, no price", p.state === "unconfirmed" && p.price === null && (await T.page.$("#mvPanelRetry")) !== null, p);
quoteFail = false; await T.page.click("#mvPanelRetry"); await T.settle(); p = await T.panel();
ok("6 Retry re-quotes with the current guest count (1) → priced", p.price === "5,760 MXN" && p.guests === "1 guest" && quotes(T.api).at(-1).endsWith("guests=1"), { p, last: quotes(T.api).at(-1) });
await T.done();

// ===== 7. Delayed / out-of-order / rapid changes =====
// guests=1 answers late AND would look different (estimate unavailable → no savings); guests=2 answers fast.
T = await make({ hooks: { quote: (q) => (q.guests === "1" ? { delayMs: 1200, mutate: UNAVAILABLE_DIRECT } : null) } });
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2");
await T.pick(1, { settle: false }); await sl(150); await T.pick(2, { settle: false }); await T.settle(); await sl(1500); p = await T.panel();
ok("7 out-of-order: 2→1 (slow) then 1→2 (fast) — the late guests=1 answer never overwrites the latest selection", p.guests === "2 guests" && p.sel.value === "2" && p.badge === "Save 10%" && p.price === "5,760 MXN" && p.url.endsWith("guests=2") && !/not available for this stay/.test(p.disclaimer || ""), p);
await T.done();
T = await make({ hooks: { quote: () => ({ delayMs: 300 }) } });
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2"); const h7 = (await T.panel()).hist; T.api.length = 0;
for (const n of [1, 2, 1, 2, 1]) { await T.pick(n, { settle: false }); await sl(40); }
await T.settle(); await sl(800); p = await T.panel();
ok("7 five rapid changes: final panel = last choice (1 guest), priced once for guests=1 at the end; URL/history consistent", p.guests === "1 guest" && p.sel.value === "1" && p.price === "5,760 MXN" && p.url.endsWith("guests=1") && p.hist === h7 && quotes(T.api).at(-1).endsWith("guests=1") && quotes(T.api).length <= 5, { p, q: quotes(T.api) });
await T.done();
// navigate away during an in-flight quote
T = await make({ hooks: { quote: () => ({ delayMs: 1200 }) } });
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2", { settle: false }); await T.settle().catch(() => {}); await sl(1400); await T.settle();
await T.pick(1, { settle: false }); for (let i = 0; i < 40 && !T.api.some((a) => a.endsWith("guests=1") && a.startsWith("quote")); i++) await sl(50);
await T.page.click("#mvPropBack"); await T.page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden")); await sl(1500);
const away = await T.page.evaluate(() => ({ app: !document.getElementById("mv-app").classList.contains("mv-view-hidden"), url: location.pathname + location.search, guests: document.getElementById("mvGuests").value, price: document.getElementById("mvPanelPrice")?.textContent ?? null }));
ok("7 leaving to results during the guest-change quote: results shown with guests=1, the late quote does not price the hidden panel", away.app && away.url === "/?checkin=2026-12-20&checkout=2026-12-24&guests=1" && away.guests === "1" && away.price === null, away);
await T.done();
// property switch during an in-flight quote
T = await make({ hooks: { quote: (q) => (q.id === "603566" && q.guests === "1" ? { delayMs: 1200 } : null) } });
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-23&guests=2"); await T.pick(1, { settle: false }); await sl(200);
await T.page.evaluate(() => { history.pushState({}, "", "/property/603564"); window.dispatchEvent(new PopStateEvent("popstate", { state: {} })); }); await T.settle(); await sl(1500); p = await T.panel();
ok("7 switching property while 603566's quote is pending: 603564 shows its own price for the committed stay (1 guest, 3 nights 6,600 → 5,940)", p.price === "5,940 MXN" && p.was === "6,600 MXN" && p.guests === "1 guest" && (await T.page.evaluate(() => document.querySelector("#mvPropertyView h1").textContent)) === "Hacienda 5 De Mayo", p);
await T.done();

// ===== 8. Reload, Back/Forward, LEGACY modal (test hook) parity =====
T = await make({ legacyModal: true });
await T.go("/"); await T.page.evaluate(() => { for (const [id, v] of [["mvCheckin", "2026-12-20"], ["mvCheckout", "2026-12-24"]]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); } });
await T.page.evaluate(() => { history.pushState({ mvFrom: "search" }, "", "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2"); window.dispatchEvent(new PopStateEvent("popstate", { state: { mvFrom: "search" } })); }); await T.settle();
const h8 = (await T.panel()).hist; await T.pick(1); await T.pick(2); await T.pick(1); p = await T.panel();
ok("8 three guest changes add no history entries (replaceState)", p.hist === h8 && p.url.endsWith("guests=1"), { h: [h8, p.hist], u: p.url });
await T.page.reload(); await T.page.waitForSelector("#mvPanel"); await T.settle(); p = await T.panel();
ok("8 reload reproduces the committed guest count and dates and re-validates: 1 guest, 5,760", p.guests === "1 guest" && p.checkin === "Dec 20, 2026" && p.price === "5,760 MXN" && p.url === "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=1", p);
await T.page.goBack(); await T.page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden")); const b8 = await T.page.evaluate(() => location.pathname);
ok("8 Back goes to the previous page (search), not through guest changes", b8 === "/", b8);
await T.page.goForward(); await T.page.waitForSelector("#mvPanel"); await T.settle(); p = await T.panel();
ok("8 Forward returns to the property with guests=1", p.guests === "1 guest" && p.url.endsWith("guests=1"), p);
await T.page.click("#mvPropBack"); await T.page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden"));
await openLegacyModal(T.page, "603566"); /* UX7a: legacy modal via test hook (was a card-title click) */ await T.page.waitForSelector("#mvHostawayCalendarMonths .mv-cal__month"); await T.page.waitForFunction(() => !/checking availability/.test(document.getElementById("mvHostawaySelection").innerText));
await T.page.click("#mvHostawayQuoteBtn"); await T.page.waitForFunction(() => /direct total/.test(document.getElementById("mvHostawayQuote").innerText));
const mq = await T.page.evaluate(() => document.getElementById("mvHostawayQuote").innerText);
ok("8 search modal (N2) after property-page guest edits: same committed guests (1) and dates, same 5,760 estimate", /^5,760 MXN estimated direct total/.test(mq) && /4 nights · 1 guest/.test(mq), mq.slice(0, 160));
ok("8 no duplicate ids with modal + panel built; no page errors", (await T.panel())?.dupIds?.length === 0 && T.errors.length === 0, T.errors);
await T.done();

// ===== 9. Layout, touch target, keyboard, accessibility =====
for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) {
  T = await make({ vp }); await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2");
  const g = await T.page.evaluate(() => { const s = document.getElementById("mvPanelGuestsSelect"), f = s.parentElement, card = document.getElementById("mvPanel"); const rs = s.getBoundingClientRect(), rf = f.getBoundingClientRect(), rc = card.getBoundingClientRect(); return { sel: [Math.round(rs.width), Math.round(rs.height)], field: [Math.round(rf.width), Math.round(rf.height)], inside: rf.left >= rc.left && rf.right <= rc.right, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, cardH: Math.round(rc.height) }; });
  ok(`9 ${vp.width}px: selector covers the whole Guests field inside its 1px top border (touch target ${g.sel[1]}px high), inside the card, no page overflow`, g.sel[0] === g.field[0] && g.field[1] - g.sel[1] <= 1 && g.sel[1] >= 40 && g.inside && !g.overflow, g);
  if (vp.width < 1000) ok(`9 ${vp.width}px: compact card height unchanged by UX5 (< 480px)`, g.cardH < 480, g.cardH);
  if (SHOTS && vp.width < 1000) await T.page.screenshot({ path: `${SHOTS}/ux5-m${vp.width}.png` });
  await T.done();
}
T = await make(); await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2");
const tabs = []; for (let i = 0; i < 4; i++) { await T.page.keyboard.press("Tab"); tabs.push(await T.page.evaluate(() => document.activeElement.id)); }
ok("9 keyboard: Tab reaches Show all photos → Check-in → Checkout → Guests selector", same(tabs, ["mvPropGalleryAll", "mvPanelCheckin", "mvPanelCheckout", "mvPanelGuestsSelect"]), tabs);
const ring = await T.page.evaluate(() => getComputedStyle(document.getElementById("mvPanelGuestsSelect").parentElement).boxShadow);
ok("9 visible focus state on the Guests field while the selector has focus", ring && ring !== "none", ring);
T.api.length = 0; await T.page.keyboard.press("ArrowUp"); await T.settle(); p = await T.panel();
ok("9 keyboard change (ArrowUp on the focused select) reprices with guests=1 and keeps focus on the selector", p.guests === "1 guest" && p.sel.focused && quotes(T.api).at(-1)?.endsWith("guests=1"), { p: [p.guests, p.sel.focused], q: quotes(T.api) });
const a11y = await T.page.evaluate(() => ({ hidden: document.getElementById("mvPanelGuests").getAttribute("aria-hidden"), tag: document.getElementById("mvPanelGuestsSelect").tagName }));
ok("9 the select is the only accessible guest control (visible text is aria-hidden); native SELECT", a11y.hidden === "true" && a11y.tag === "SELECT", a11y);
ok("9 network: GET only; listings/calendar/quote only; no write, hold, reservation or payment paths; nothing else contacted", T.methods.every((m) => m === "GET") && T.api.every((a) => /^(listings|calendar\?|quote\?)/.test(a)) && !T.api.some((a) => /hold|reserv|checkout|pay|stripe|smoobu/i.test(a)) && T.other.length === 0, { o: T.other, m: [...new Set(T.methods)] });
ok("9 no page errors", T.errors.length === 0, T.errors);
await T.done();

await browser.close(); server.close();
const names = Object.keys(results), pass = names.filter((n) => results[n] === "PASS").length;
console.log(JSON.stringify(results, null, 1)); console.log(`\n${pass}/${names.length} passed`); process.exit(failed ? 1 : 0);
