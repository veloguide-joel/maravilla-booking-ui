// UX7b1: four guest-interaction corrections, tested on the UNMODIFIED committed page (no legacy cookie).
//   C1 accessible favourite heart · C2 results URL / state consistency · C3 persistent capacity message ·
//   C4 independent URL parameter validation.
// Deterministic fixtures (fixed clock 2026-10-19; 603566 Dec 24–31 reservation; both pilots sleep 2).
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync } from "node:fs";
import { PAGE_PATH } from "../lib/page-source.mjs";
import { HOOK_NAME } from "../lib/modal-entry.mjs";
import { TODAY, PROXY, listings, calendarFor, quoteFor, overlaps, nightsOf, PNG_1x1 } from "../fixtures/pilots.mjs";

const PAGE = readFileSync(PAGE_PATH, "utf8");
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost:5500");
  if (u.pathname === "/consumer/booking-test.html" || u.pathname === "/" || /^\/property\/[^/]+\/?$/.test(u.pathname)) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE); return; }
  res.writeHead(404); res.end("not found");
});
await new Promise((r) => server.listen(5500, "localhost", r));
const results = {}; let failed = 0;
const ok = (name, cond, detail) => { results[name] = cond ? "PASS" : "FAIL"; if (!cond) { failed++; console.log("FAIL", name, JSON.stringify(detail).slice(0, 900)); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sl = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const BASE = "http://localhost:5500";
const HINT = "This property sleeps up to 2 guests. Choose fewer guests above.";
const GUEST_LINK = "The guest count in this link couldn't be used. Choose the number of guests above.";
const DATES_LINK = "The dates in this link couldn't be used. Choose new dates above.";

async function make({ vp = { width: 1280, height: 900 }, hooks = {} } = {}) {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: "reduce" });
  const FIXED = new Date(TODAY + "T12:00:00").getTime();
  await ctx.addInitScript((FIXED) => { const D = Date; class M extends D { constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); } static now() { return FIXED; } } window.Date = M; }, FIXED);
  const T = { ctx, api: [], methods: [], other: [], errors: [], hooks };
  await ctx.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === PROXY) {
      const p = Object.fromEntries(u.searchParams); T.api.push(u.pathname.replace("/api/booking/", "") + u.search); T.methods.push(route.request().method());
      const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", headers: { "access-control-allow-origin": BASE }, body: JSON.stringify(b) });
      const H = T.hooks;
      if (u.pathname === "/api/booking/listings") return json(listings);
      if (u.pathname === "/api/booking/calendar") { const h = H.calendar && H.calendar(p); if (h && h.delayMs) await sl(h.delayMs); if (h && h.status) return json({ ok: false }, h.status); const c = calendarFor(p.id, p.from, p.to); return json(c.body, c.status); }
      if (u.pathname === "/api/booking/quote") {
        const h = H.quote && H.quote(p); if (h && h.delayMs) await sl(h.delayMs); if (h && h.status) return json({ ok: false }, h.status);
        const id = Number(p.id), n = nightsOf(p.from, p.to), g = Number(p.guests); const base = { ok: true, listingId: id, from: p.from, to: p.to, nights: n, guests: g, currency: "MXN", checkedAt: "2026-10-19T18:05:00Z" };
        const q = quoteFor(id, n); const quoted = { ...base, available: true, decision: "quoted", total: q.total, nightlyAverage: q.total / n, breakdown: q.breakdown, direct: q.direct, note: "Quote only." };
        if (h && h.forceQuoted) return json(quoted); // a hypothetical server answer that ignores capacity (defensive test)
        if (g > 2) return json({ ...base, available: false, decision: "unavailable", reasons: [{ code: "CAPACITY_EXCEEDED", message: "This property sleeps up to 2 guests." }] });
        if (overlaps(id, p.from, p.to)) return json({ ...base, available: false, decision: "unavailable", reasons: [{ code: "NIGHT_UNAVAILABLE", message: "One or more selected nights are not available." }] });
        return json(quoted);
      }
      return json({ ok: false }, 404);
    }
    if (u.hostname === "example.com") return route.fulfill({ status: 200, contentType: "image/png", body: PNG_1x1 });
    if (u.hostname === "localhost") return route.continue();
    T.other.push(u.href); return route.abort();
  });
  const page = await ctx.newPage(); T.page = page;
  page.on("pageerror", (e) => T.errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|Failed to load calendar|Quote request failed/.test(m.text())) T.errors.push(m.text()); });
  T.settle = () => page.waitForFunction(() => { const c = document.getElementById("mvPanel"); return !c || (c.dataset.state && c.dataset.state !== "loading"); }, null, { timeout: 15000 });
  T.go = async (path, { settle = true } = {}) => { await page.goto(BASE + path); await page.waitForFunction(() => document.querySelector(".mv-card") || (document.querySelector("#mvPropertyView h1") && !/Loading/.test(document.querySelector("#mvPropertyView h1").textContent)), null, { timeout: 15000 }); if (settle) await T.settle(); };
  T.search = async (a, b, guests = "2") => {
    await page.evaluate(([a, b, g]) => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); }; set("mvGuests", g); set("mvCheckin", a); set("mvCheckout", b); }, [a, b, guests]);
    await page.click("#mvSearchBtn");
    await page.waitForFunction(() => !document.getElementById("mvSearchBtn").disabled && ![...document.querySelectorAll(".mv-card__meta span:last-child")].some((s) => /Checking/.test(s.textContent)), null, { timeout: 10000 });
  };
  T.toProperty = async (id) => { await page.click(`.mv-card[data-apartment-id="${id}"] .mv-card__link`); await page.waitForSelector("#mvPanel"); await T.settle(); };
  T.toSearch = () => page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden"));
  T.editDates = async (field, iso) => { await page.click(field === "checkin" ? "#mvPanelCheckin" : "#mvPanelCheckout"); await page.waitForSelector("#mvPdCalMonths .mv-cal__month"); await page.click(`#mvPdCalMonths .mv-cal__day[data-date="${iso}"]`); await page.waitForFunction(() => !document.getElementById("mvPdCalApply").disabled, null, { timeout: 8000 }); await page.click("#mvPdCalApply"); await T.settle(); };
  T.st = () => page.evaluate((HOOK) => {
    const c = document.getElementById("mvPanel"); const t = (s) => c?.querySelector(s)?.textContent ?? null;
    const dupIds = (() => { const seen = new Map(); document.querySelectorAll("[id]").forEach((el) => seen.set(el.id, (seen.get(el.id) || 0) + 1)); return [...seen].filter(([, n]) => n > 1).map(([id]) => id); })();
    const sel = document.getElementById("mvPanelGuestsSelect");
    return { url: location.pathname + location.search, hist: history.length, prop: !document.getElementById("mvPropertyView").classList.contains("mv-view-hidden"),
      inputs: [document.getElementById("mvCheckin").value, document.getElementById("mvCheckout").value, document.getElementById("mvGuests").value], pill: document.getElementById("mvDatesBtn").textContent.trim(),
      status: document.getElementById("availabilityStatus").textContent, hook: typeof window[HOOK],
      cards: [...document.querySelectorAll(".mv-card")].map((card) => ({ id: card.dataset.apartmentId, sub: card.querySelector(".mv-card__meta span:last-child")?.innerText.replace(/\s+/g, " "), href: card.querySelector(".mv-card__link")?.getAttribute("href"), heart: card.querySelector(".mv-heart")?.getAttribute("aria-label"), on: card.querySelector(".mv-heart")?.dataset.on })),
      saved: document.getElementById("mvShowSaved").textContent, savedActive: document.getElementById("mvShowSaved").classList.contains("is-active"),
      panel: c ? { state: c.dataset.state, head: c.querySelector(".mv-panel__head")?.textContent ?? null, price: t("#mvPanelPrice"), checkin: t("#mvPanelCheckin"), checkout: t("#mvPanelCheckout"), guests: t("#mvPanelGuests"),
        status: document.getElementById("mvPanelStatus")?.innerText.replace(/\s+/g, " ").trim() ?? "", text: c.innerText, sel: sel ? { value: sel.value, options: [...sel.options].map((o) => [o.value, o.disabled]) } : null } : null,
      focus: document.activeElement?.id || document.activeElement?.className || null, scrollY: Math.round(window.scrollY), dupIds };
  }, HOOK_NAME);
  T.done = () => ctx.close();
  return T;
}
const quotes = (api) => api.filter((a) => a.startsWith("quote"));
const calQuote = (api) => api.filter((a) => a.startsWith("quote") || a.startsWith("calendar"));
const heart = (id) => `.mv-card[data-apartment-id="${id}"] .mv-heart`;

// ===================== C1. Favourite heart =====================
let T = await make();
await T.go("/"); let s = await T.st();
const hm = await T.page.evaluate(() => [...document.querySelectorAll(".mv-card")].map((c) => { const h = c.querySelector(".mv-heart"); return { tag: h.tagName, type: h.getAttribute("type"), inLink: !!h.closest("a"), hasLinkInside: !!h.querySelector("a,button"), tab: h.tabIndex, label: h.getAttribute("aria-label") }; }));
ok("C1 heart is a real <button type=button>, outside both links, nothing nested, in the tab order", hm.every((h) => h.tag === "BUTTON" && h.type === "button" && !h.inLink && !h.hasLinkInside && h.tab === 0), hm);
ok("C1 accessible name says what it does: 'Save {property}'", hm[0].label === "Save Hacienda 5 De Mayo" && hm[1].label === "Save East Side Studio", hm);
const h0 = s.hist;
await T.page.focus(".mv-card__link"); await T.page.keyboard.press("Shift+Tab"); s = await T.st();
ok("C1 Tab order: the heart is reached independently, just before its card's title link", s.focus.includes("mv-heart"), s.focus);
const ring = await T.page.evaluate(() => { const h = document.activeElement; const cs = getComputedStyle(h); return { style: cs.outlineStyle, width: cs.outlineWidth, fv: h.matches(":focus-visible") }; });
ok("C1 visible focus indicator on keyboard focus (2px solid outline, :focus-visible)", ring.fv && ring.style === "solid" && ring.width === "2px", ring);
await T.page.keyboard.press("Enter"); await sl(80); s = await T.st();
ok("C1 Enter saves: ♥, Saved (1), name becomes 'Remove … from saved'; no navigation, no history entry; focus stays on the heart", s.cards[0].on === "1" && s.cards[0].heart === "Remove Hacienda 5 De Mayo from saved" && s.saved === "Saved (1)" && !s.prop && s.url === "/" && s.hist === h0 && s.focus.includes("mv-heart"), s);
await T.page.keyboard.press("Space"); await sl(80); s = await T.st();
ok("C1 Space removes it again (Saved (0), 'Save …'); still no navigation", s.cards[0].on === "0" && s.cards[0].heart === "Save Hacienda 5 De Mayo" && s.saved === "Saved (0)" && !s.prop && s.hist === h0, s);
await T.page.click(heart("603566")); await sl(80); s = await T.st();
ok("C1 mouse click saves 603566; no navigation", s.cards[1].on === "1" && s.saved === "Saved (1)" && !s.prop && s.url === "/" && s.hist === h0, s);
await T.page.reload(); await T.page.waitForSelector(".mv-card"); s = await T.st();
ok("C1 favourites persist across reload (storage unchanged)", s.saved === "Saved (1)" && s.cards[1].on === "1" && s.cards[1].heart === "Remove East Side Studio from saved", s);
await T.page.click("#mvShowSaved"); await sl(60); await T.page.focus(heart("603566")); await T.page.keyboard.press("Enter"); await sl(100); s = await T.st();
ok("C1 un-saving by keyboard inside the Saved filter: card leaves the list, focus moves to the Saved button (not lost)", s.savedActive && s.cards.length === 0 && s.saved === "Saved (0)" && s.focus === "mvShowSaved", s);
await T.page.click("#mvShowAll"); await T.search("2026-12-20", "2026-12-24"); await T.page.click(heart("603564")); await sl(80); s = await T.st();
ok("C1 heart on a priced card: toggles only; prices and URL unchanged", s.cards[0].on === "1" && /7,920 MXN/.test(s.cards[0].sub) && !s.prop, s);
ok("C1 no page errors", T.errors.length === 0, T.errors);
await T.done();
for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  T = await make({ vp }); await T.go("/");
  const g = await T.page.evaluate(() => { const h = document.querySelector('.mv-card[data-apartment-id="603566"] .mv-heart'); h.scrollIntoView({ block: "center" }); const r = h.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { w: Math.round(r.width), h: Math.round(r.height), hit: top === h || h.contains(top), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }; });
  const before = (await T.st()).hist;
  await T.page.click(heart("603566")); await sl(80); s = await T.st();
  ok(`C1 ${vp.width}px: heart ≥44px target, on top, toggles without navigating; no overflow`, g.w >= 44 && g.h >= 44 && g.hit && !g.overflow && s.cards[1].on === "1" && !s.prop && s.hist === before, { g, s: [s.cards[1].on, s.prop] });
  await T.done();
}

// ===================== C2. Results URL and state =====================
T = await make();
await T.go("/"); await T.search("2026-12-20", "2026-12-24");
await T.toProperty("603566"); T.api.length = 0;
await T.editDates("checkout", "2026-12-23"); await T.editDates("checkin", "2026-12-21"); s = await T.st();
ok("C2 property page: Dec 21 → Dec 23 committed (2,880) and the property URL follows", s.panel.price === "2,880 MXN" && s.url === "/property/603566?checkin=2026-12-21&checkout=2026-12-23&guests=2", s);
const histOnProp = s.hist; T.api.length = 0;
await T.page.click("#mvPropBack"); await T.toSearch(); await sl(100); s = await T.st();
ok("C2 back on results: URL, pill and inputs all state the committed Dec 21–23 / 2 guests", s.url === "/?checkin=2026-12-21&checkout=2026-12-23&guests=2" && s.pill === "Dec 21 - Dec 23" && same(s.inputs, ["2026-12-21", "2026-12-23", "2"]), s);
ok("C2 outdated Dec 20–24 prices are not shown; the guest is asked to check availability again", s.cards.every((c) => !/MXN/.test(c.sub)) && s.status === "Dates changed. Check availability to update results.", s);
ok("C2 returning made no search request and no extra history entry (Back to results = history.back)", T.api.length === 0 && s.hist === histOnProp, { api: T.api, h: [histOnProp, s.hist] });
await T.page.reload(); await T.page.waitForSelector(".mv-card"); await sl(150); s = await T.st();
ok("C2 refresh of the results URL keeps Dec 21–23 / 2 guests in the form (pill + inputs); URL unchanged", s.url === "/?checkin=2026-12-21&checkout=2026-12-23&guests=2" && s.pill === "Dec 21 - Dec 23" && same(s.inputs, ["2026-12-21", "2026-12-23", "2"]), s);
ok("C2 refresh does not run a search or show prices (only the listings feed is fetched)", same(T.api.filter((a) => !a.startsWith("listings")), []) && s.cards.every((c) => !/MXN/.test(c.sub)), T.api);
await T.page.goForward(); await T.page.waitForSelector("#mvPanel"); await T.settle(); s = await T.st();
ok("C2 Forward after refresh: the property page with Dec 21–23, re-validated (2,880)", s.prop && s.url === "/property/603566?checkin=2026-12-21&checkout=2026-12-23&guests=2" && s.panel.price === "2,880 MXN", s);
await T.page.goBack(); await T.toSearch(); s = await T.st();
ok("C2 Back again: results with the same committed values", s.url === "/?checkin=2026-12-21&checkout=2026-12-23&guests=2" && same(s.inputs, ["2026-12-21", "2026-12-23", "2"]), s);
T.api.length = 0; await T.page.click("#mvSearchBtn"); await T.page.waitForFunction(() => !document.getElementById("mvSearchBtn").disabled && /MXN/.test(document.querySelector(".mv-card__meta span:last-child").innerText)); s = await T.st();
ok("C2 Check availability then prices the committed Dec 21–23 (exactly 2 quotes) and the notice is replaced", same(quotes(T.api), ["quote?id=603564&from=2026-12-21&to=2026-12-23&guests=2", "quote?id=603566&from=2026-12-21&to=2026-12-23&guests=2"]) && /2,880 MXN/.test(s.cards[1].sub) && s.status !== "Dates changed. Check availability to update results.", { api: T.api, s });
ok("C2 no page errors (dates flow)", T.errors.length === 0, T.errors);
await T.done();

// guests changed on the property page
T = await make();
await T.go("/"); await T.search("2026-12-20", "2026-12-24"); await T.toProperty("603566");
await T.page.selectOption("#mvPanelGuestsSelect", "1"); await T.settle(); T.api.length = 0;
await T.page.goBack(); await T.toSearch(); await sl(100); s = await T.st();
ok("C2 guests changed to 1 then browser Back: URL guests=1, form 1 guest, no stale prices, 'Guests changed' prompt, no request", s.url === "/?checkin=2026-12-20&checkout=2026-12-24&guests=1" && s.inputs[2] === "1" && s.cards.every((c) => !/MXN/.test(c.sub)) && s.status === "Guests changed. Check availability to update results." && T.api.length === 0, { s, api: T.api });
ok("C2 card links follow (guests=1)", s.cards.every((c) => c.href.endsWith("guests=1")), s.cards);
await T.done();

// nothing changed → prices preserved
T = await make();
await T.go("/"); await T.search("2026-12-20", "2026-12-24"); await T.toProperty("603566"); T.api.length = 0;
await T.page.click("#mvPropBack"); await T.toSearch(); s = await T.st();
ok("C2 unchanged parameters: valid prices stay, no prompt, URL states the search, no request", /7,920 MXN/.test(s.cards[0].sub) && /5,760 MXN/.test(s.cards[1].sub) && s.status !== "" && !/Check availability/.test(s.status) && s.url === "/?checkin=2026-12-20&checkout=2026-12-24&guests=2" && T.api.length === 0, { s, api: T.api });
// changed and changed back → conservative: prices were withdrawn, guest asked to re-check
await T.toProperty("603566"); await T.page.selectOption("#mvPanelGuestsSelect", "1"); await T.settle(); await T.page.selectOption("#mvPanelGuestsSelect", "2"); await T.settle();
await T.page.click("#mvPropBack"); await T.toSearch(); s = await T.st();
ok("C2 changed then restored on the property page: withdrawn prices are not resurrected; neutral re-check prompt", s.cards.every((c) => !/MXN/.test(c.sub)) && s.status === "Check availability to update results." && s.url === "/?checkin=2026-12-20&checkout=2026-12-24&guests=2", s);
await T.done();

// results URL follows search-page changes (replaceState only); plain "/" makes no claim
T = await make();
await T.go("/"); const hp = (await T.st()).hist;
await T.page.evaluate(() => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); }; set("mvCheckin", "2026-12-20"); set("mvCheckout", "2026-12-24"); }); s = await T.st();
ok("C2 fresh '/' + picking dates leaves the URL as '/' (no history entry)", s.url === "/" && s.hist === hp, s);
await T.search("2026-12-20", "2026-12-24"); await T.toProperty("603564"); await T.page.goBack(); await T.toSearch();
await T.page.selectOption("#mvGuests", "1"); await sl(80); s = await T.st();
ok("C2 a results URL that states a search follows search-page changes via replaceState (guests=1, no new entry)", s.url === "/?checkin=2026-12-20&checkout=2026-12-24&guests=1" && s.hist === hp + 1, s);
await T.page.evaluate(() => document.getElementById("mvDatesClear").click()); await sl(80); s = await T.st();
ok("C2 Clear dates on such a URL: dates leave the URL too", s.url === "/?guests=1" && s.inputs[0] === "", s);
await T.done();

// favourites, Saved filter and scroll survive a changed-parameter return (390px)
T = await make({ vp: { width: 390, height: 600 } });
await T.go("/"); await T.search("2026-12-20", "2026-12-24"); await T.page.click(heart("603566")); await T.page.click("#mvShowSaved"); await sl(60);
await T.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await sl(80); const y0 = (await T.st()).scrollY;
await T.toProperty("603566"); await T.page.selectOption("#mvPanelGuestsSelect", "1"); await T.settle();
await T.page.click("#mvPropBack"); await T.toSearch(); await sl(150); s = await T.st();
ok("C2 390px: Saved filter + favourite kept, scroll restored, stale prices withdrawn after a guest change", s.savedActive && s.saved === "Saved (1)" && s.cards.length === 1 && Math.abs(s.scrollY - y0) <= 2 && s.cards.every((c) => !/MXN/.test(c.sub)) && y0 > 0, { s, y0 });
await T.done();

// ===================== C3. Persistent capacity message (603566 sleeps 2, link asks for 3) =====================
const capCases = [
  ["missing dates", "/property/603566?guests=3", {}, (p) => p.state === "empty"],
  ["calendar failure (502)", "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=3", { calendar: () => ({ status: 502 }) }, (p) => p.state === "unconfirmed" && /Retry/.test(p.status)],
  ["unavailable nights (Dec 24–31)", "/property/603566?checkin=2026-12-24&checkout=2026-12-31&guests=3", {}, (p) => p.state === "unavailable"],
  ["server capacity refusal", "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=3", {}, (p) => p.state === "unavailable" && p.status.startsWith("This property sleeps up to 2 guests.")],
  ["quote failure (502)", "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=3", { quote: () => ({ status: 502 }) }, (p) => p.state === "unconfirmed"],
  ["server answers 'quoted' despite capacity (defensive)", "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=3", { quote: () => ({ forceQuoted: true }) }, (p) => p.state === "capacity" && p.head === "Choose fewer guests to see a price"]
];
for (const [name, path, hooks, cond] of capCases) {
  T = await make({ hooks }); await T.go(path); s = await T.st();
  ok(`C3 ${name}: correction message visible, no price or MXN amount, field flagged`, cond(s.panel) && s.panel.status.endsWith(HINT) && s.panel.price === null && !/MXN/.test(s.panel.text) && s.panel.guests === "3 guests", s.panel);
  await T.done();
}
T = await make({ hooks: { calendar: () => ({ delayMs: 1200 }) } });
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=3", { settle: false }); await sl(400); s = await T.st();
ok("C3 while checking (delayed calendar): message already visible, no price", s.panel.state === "loading" && s.panel.status.endsWith(HINT) && s.panel.price === null, s.panel);
await T.settle(); T.hooks.calendar = null;
await T.editDates("checkout", "2026-12-23"); s = await T.st();
ok("C3 after editing dates (repricing): message still visible, still no price; URL keeps guests=3", s.panel.status.endsWith(HINT) && s.panel.price === null && s.url.endsWith("checkout=2026-12-23&guests=3"), s);
await T.page.selectOption("#mvPanelGuestsSelect", "2"); await T.settle(); s = await T.st();
ok("C3 choosing 2 guests removes the message and prices the stay (Dec 20–23: 4,320)", !s.panel.status.includes("sleeps up to") && s.panel.price === "4,320 MXN" && s.url.endsWith("guests=2"), s.panel);
ok("C3 no page errors", T.errors.length === 0, T.errors);
await T.done();

// ===================== C4. Independent URL parameter validation =====================
T = await make();
for (const [name, path, want] of [
  ["fully valid URL unchanged (guests=1)", "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=1", (p, s) => p.price === "5,760 MXN" && p.guests === "1 guest" && s.url.endsWith("guests=1")],
  ["valid dates, no guests → default 2 (unchanged)", "/property/603566?checkin=2026-12-20&checkout=2026-12-24", (p) => p.price === "5,760 MXN" && p.guests === "2 guests"]
]) { T.api.length = 0; await T.go(path); s = await T.st(); ok(`C4 ${name}`, want(s.panel, s), s.panel); }
for (const g of ["abc", "0", "99", "-1", "2.5", "%3Cscript%3E", "1e1", ""]) {
  T.api.length = 0; await T.go(`/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=${g}`); s = await T.st();
  ok(`C4 guests=${decodeURIComponent(g) || "(empty)"}: valid dates kept, guests unconfirmed with a correction prompt, no calendar/quote, no price`, s.panel.state === "guests" && s.panel.head === "Choose the number of guests to see a price" && s.panel.status.includes(GUEST_LINK) && s.panel.checkin === "Dec 20, 2026" && s.panel.checkout === "Dec 24, 2026" && s.panel.guests === "Choose guests" && s.panel.sel.value === "" && s.panel.price === null && calQuote(T.api).length === 0 && !s.panel.text.includes("<script>"), { p: s.panel, api: T.api });
}
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=abc"); s = await T.st();
ok("C4 the URL keeps the unusable value until corrected (no silent rewrite to 2)", s.url === "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=abc", s.url);
await T.page.reload(); await T.page.waitForSelector("#mvPanel"); await T.settle(); s = await T.st();
ok("C4 reload asks again (still unconfirmed)", s.panel.state === "guests" && s.panel.guests === "Choose guests", s.panel);
T.api.length = 0; await T.page.selectOption("#mvPanelGuestsSelect", "2"); await T.settle(); s = await T.st();
ok("C4 correcting in the panel — even to the default 2 — confirms it: one stay check + quote for guests=2, priced, URL guests=2", s.panel.price === "5,760 MXN" && s.panel.guests === "2 guests" && same(quotes(T.api), ["quote?id=603566&from=2026-12-20&to=2026-12-24&guests=2"]) && s.url.endsWith("guests=2"), { p: s.panel, api: T.api });
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=3"); s = await T.st();
ok("C4 in-range but over-capacity guests=3 is not 'unusable': it is applied, flagged and refused (C3), never priced", s.panel.state === "unavailable" && s.panel.guests === "3 guests" && s.panel.status.endsWith(HINT) && s.panel.price === null, s.panel);
for (const [name, q] of [["reversed dates", "checkin=2026-12-24&checkout=2026-12-20"], ["91 nights", "checkin=2027-01-05&checkout=2027-04-06"], ["impossible date", "checkin=2026-02-30&checkout=2026-12-24"], ["past check-in", "checkin=2026-10-01&checkout=2026-10-05"]]) {
  T.api.length = 0; await T.go(`/property/603566?${q}&guests=1`); s = await T.st();
  ok(`C4 ${name} + guests=1: dates rejected (date-only / 90-night / horizon rules kept), guests=1 kept, dates prompt shown, no request`, s.panel.state === "empty" && s.panel.checkin === "Add date" && s.panel.guests === "1 guest" && s.panel.status.includes(DATES_LINK) && calQuote(T.api).length === 0 && s.inputs[2] === "1", { p: s.panel, api: T.api });
}
await T.go("/property/603566?checkin=2026-12-24&checkout=2026-12-20&guests=abc"); s = await T.st();
ok("C4 both invalid: guests prompt and dates prompt, nothing requested", s.panel.state === "guests" && s.panel.status.includes(GUEST_LINK) && s.panel.status.includes(DATES_LINK) && s.panel.checkin === "Add date", s.panel);
await T.done();
// card navigation carries the visible values (the unusable link value does not follow)
T = await make();
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=abc");
await T.page.click("#mvPropBack"); await T.toSearch(); s = await T.st();
ok("C4 back to results from such a link: the results URL states the visible guest count (2)", s.url === "/?checkin=2026-12-20&checkout=2026-12-24&guests=2" && s.inputs[2] === "2", s);
await T.toProperty("603564"); s = await T.st();
ok("C4 opening a property from a card uses the visible values: priced normally (7,920)", s.panel.price === "7,920 MXN" && s.panel.guests === "2 guests" && s.url.endsWith("guests=2"), s.panel);
await T.done();
// results URL with an unusable guest value: the form's visible count is used and stated
T = await make();
await T.go("/?checkin=2026-12-20&checkout=2026-12-24&guests=abc"); await sl(100); s = await T.st();
ok("C4 results URL ?guests=abc: dates kept, form shows 2 and the URL is normalised to guests=2 (no search run)", s.url === "/?checkin=2026-12-20&checkout=2026-12-24&guests=2" && same(s.inputs, ["2026-12-20", "2026-12-24", "2"]) && quotes(T.api).length === 0, { s, api: T.api });
await T.done();

// ===================== Mobile panel messages, network, isolation =====================
for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  T = await make({ vp });
  await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=3");
  const a = await T.page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, hint: [...document.querySelectorAll("#mvPanelStatus .mv-panel__status--hint")].map((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right <= document.documentElement.clientWidth + 0.5; }) }));
  await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=abc");
  const b = await T.page.evaluate(() => { const sel = document.getElementById("mvPanelGuestsSelect"); const r = sel.getBoundingClientRect(); return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, sel: r.width > 0 && r.height >= 30 }; });
  ok(`M ${vp.width}px: capacity and guest-link messages fit, guest selector operable, no overflow`, !a.overflow && a.hint.length === 1 && a.hint.every(Boolean) && !b.overflow && b.sel, { a, b });
  ok(`M ${vp.width}px: no page errors`, T.errors.length === 0, T.errors);
  await T.done();
}
T = await make();
await T.go("/"); s = await T.st();
ok("N served page = committed bytes; no legacy hook in the page", (await (await T.page.request.get(BASE + "/")).text()) === PAGE && s.hook === "undefined");
await T.search("2026-12-20", "2026-12-24"); await T.page.click(heart("603564")); await T.toProperty("603566"); await T.page.selectOption("#mvPanelGuestsSelect", "1"); await T.settle(); await T.page.goBack(); await T.toSearch();
ok("N network: GET only, proxy listings/calendar/quote only; no hold/reservation/checkout/payment; no other hosts; no duplicate ids", T.methods.every((m) => m === "GET") && T.api.every((a) => /^(listings|calendar|quote)(\?|$)/.test(a)) && !T.api.some((a) => /hold|reserv|checkout|pay|stripe/i.test(a)) && T.other.length === 0 && (await T.st()).dupIds.length === 0, { m: [...new Set(T.methods)], other: T.other });
ok("N no page errors", T.errors.length === 0, T.errors);
await T.done();

await browser.close(); server.close();
const total = Object.keys(results).length, pass = Object.values(results).filter((v) => v === "PASS").length;
console.log(`\n${pass}/${total} passed`);
process.exit(failed ? 1 : 0);
