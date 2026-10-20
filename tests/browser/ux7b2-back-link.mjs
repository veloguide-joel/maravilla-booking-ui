// UX7b2: the property page's "Back to results" link always carries the committed search (unmodified page).
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


let T, s;
const backHref = () => T.page.evaluate(() => document.getElementById("mvPropBack")?.getAttribute("href") ?? null);
const newTabFrom = async (fn) => { const [pg] = await Promise.all([T.ctx.waitForEvent("page", { timeout: 6000 }), fn()]); await pg.waitForLoadState(); await pg.waitForSelector(".mv-card", { timeout: 15000 }); await sl(150);
  const st = await pg.evaluate(() => ({ url: location.pathname + location.search, inputs: [document.getElementById("mvCheckin").value, document.getElementById("mvCheckout").value, document.getElementById("mvGuests").value], pill: document.getElementById("mvDatesBtn").textContent.trim(), app: !document.getElementById("mv-app").classList.contains("mv-view-hidden"), priced: [...document.querySelectorAll(".mv-card__meta span:last-child")].some((s) => /MXN/.test(s.textContent)), status: document.getElementById("availabilityStatus").textContent })); await pg.close(); return st; };

// ===== 1. Dates and guests committed on the property page =====
T = await make();
await T.go("/"); await T.search("2026-12-20", "2026-12-24"); await T.toProperty("603566");
ok("1 on arrival: Back to results = the committed search", (await backHref()) === "/?checkin=2026-12-20&checkout=2026-12-24&guests=2", await backHref());
const h1 = (await T.st()).hist; T.api.length = 0;
await T.editDates("checkout", "2026-12-23"); await T.editDates("checkin", "2026-12-21"); s = await T.st();
ok("1 after applying Dec 21 → Dec 23: link updated; property priced 2,880 (Book Direct, standard 3,200); no history entry", (await backHref()) === "/?checkin=2026-12-21&checkout=2026-12-23&guests=2" && s.panel.price === "2,880 MXN" && /3,200 MXN/.test(s.panel.text) && s.hist === h1, { h: await backHref(), p: s.panel.price, hist: [h1, s.hist] });
await T.page.selectOption("#mvPanelGuestsSelect", "1"); await T.settle();
ok("1 after changing guests to 1: link updated", (await backHref()) === "/?checkin=2026-12-21&checkout=2026-12-23&guests=1", await backHref());
// drafts never change the link
await T.page.click("#mvPanelCheckout"); await T.page.waitForSelector("#mvPdCalMonths .mv-cal__month"); await T.page.click('#mvPdCalMonths .mv-cal__day[data-date="2026-12-22"]'); await sl(300);
ok("1 a draft date in the open editor does not change the link", (await backHref()) === "/?checkin=2026-12-21&checkout=2026-12-23&guests=1", await backHref());
await T.page.keyboard.press("Escape"); await sl(150);
ok("1 Escape (cancel) leaves the link unchanged", (await backHref()) === "/?checkin=2026-12-21&checkout=2026-12-23&guests=1", await backHref());
await T.page.click("#mvPanelCheckin"); await T.page.waitForSelector("#mvPdCalMonths .mv-cal__month"); await T.page.click('#mvPdCalMonths .mv-cal__day[data-date="2026-12-27"]'); await sl(300); await T.page.click("#mvPdCalClose"); await sl(150);
ok("1 Close (cancel) after another draft leaves the link unchanged", (await backHref()) === "/?checkin=2026-12-21&checkout=2026-12-23&guests=1", await backHref());
ok("1 drafting/cancelling made no quote request", quotes(T.api).filter((a) => a.includes("guests=1")).length === 1, T.api);
// new tab / middle click from the link: the results page opens with the committed values, no assumed prices
let nt = await newTabFrom(() => T.page.click("#mvPropBack", { modifiers: ["Control"] }));
ok("1 Ctrl+click opens results with Dec 21–23 / 1 guest in URL, pill and form; nothing priced or claimed as checked", nt.url === "/?checkin=2026-12-21&checkout=2026-12-23&guests=1" && same(nt.inputs, ["2026-12-21", "2026-12-23", "1"]) && nt.pill === "Dec 21 - Dec 23" && nt.app && !nt.priced && nt.status === "", nt);
nt = await newTabFrom(() => T.page.click("#mvPropBack", { button: "middle" }));
ok("1 middle-click opens the same committed results", nt.url === "/?checkin=2026-12-21&checkout=2026-12-23&guests=1" && same(nt.inputs, ["2026-12-21", "2026-12-23", "1"]), nt);
s = await T.st(); ok("1 the property tab itself did not navigate", s.prop && s.url === "/property/603566?checkin=2026-12-21&checkout=2026-12-23&guests=1", s.url);
// Clear dates + Apply
await T.page.click("#mvPanelCheckin"); await T.page.waitForSelector("#mvPdCalMonths .mv-cal__month"); await T.page.click("#mvPdCalClear"); await T.page.click("#mvPdCalApply"); await T.settle();
ok("1 Clear dates + Apply: link drops the dates (guests kept)", (await backHref()) === "/?guests=1", await backHref());
// plain click: same document, no new entry, form and URL consistent
const h2 = (await T.st()).hist; T.api.length = 0;
await T.page.click("#mvPropBack"); await T.toSearch(); await sl(100); s = await T.st();
ok("1 plain click: back in the same document (history.back), URL = form = link (no dates, 1 guest), no request", s.url === "/?guests=1" && same(s.inputs, ["", "", "1"]) && s.hist === h2 && T.api.length === 0, { s, api: T.api });
await T.page.goForward(); await T.page.waitForSelector("#mvPanel"); await T.settle();
ok("1 browser Forward: property again; its link still states the committed search", (await backHref()) === "/?guests=1", await backHref());
await T.page.goBack(); await T.toSearch(); s = await T.st();
ok("1 browser Back: results with the same values", s.url === "/?guests=1" && s.inputs[2] === "1", s);
ok("1 no page errors", T.errors.length === 0, T.errors);
await T.done();

// ===== 2. Direct links =====
T = await make();
await T.go("/property/603566");
ok("2 direct property link without dates: link = /?guests=2 (unchanged behaviour)", (await backHref()) === "/?guests=2", await backHref());
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=1"); s = await T.st();
ok("2 direct link with valid values: link carries them; validated price 5,760 (standard 6,400)", (await backHref()) === "/?checkin=2026-12-20&checkout=2026-12-24&guests=1" && s.panel.price === "5,760 MXN" && /6,400 MXN/.test(s.panel.text), { h: await backHref(), p: s.panel.price });
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=abc");
ok("2 unusable guest value: link keeps the dates but carries no guest value at all", (await backHref()) === "/?checkin=2026-12-20&checkout=2026-12-24", await backHref());
nt = await newTabFrom(() => T.page.click("#mvPropBack", { modifiers: ["Control"] }));
ok("2 …and the results page opened from it shows the dates with its own default guests (URL normalised, nothing priced)", nt.url === "/?checkin=2026-12-20&checkout=2026-12-24&guests=2" && same(nt.inputs, ["2026-12-20", "2026-12-24", "2"]) && !nt.priced, nt);
await T.page.selectOption("#mvPanelGuestsSelect", "1"); await T.settle();
ok("2 once the guest picks 1 in the panel, the link carries guests=1", (await backHref()) === "/?checkin=2026-12-20&checkout=2026-12-24&guests=1", await backHref());
await T.go("/property/603566?checkin=2026-12-24&checkout=2026-12-20&guests=1");
ok("2 invalid dates + valid guests: link carries guests only", (await backHref()) === "/?guests=1", await backHref());
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=3"); s = await T.st();
ok("2 in-range but over-capacity guests=3: the committed value is carried (results filter it), panel still refuses with the correction", (await backHref()) === "/?checkin=2026-12-20&checkout=2026-12-24&guests=3" && s.panel.price === null && /sleeps up to 2/.test(s.panel.status), { h: await backHref(), p: s.panel });
await T.done();

// ===== 3. Keyboard and mobile =====
for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
  T = await make({ vp });
  await T.go("/"); await T.search("2026-12-20", "2026-12-24"); await T.toProperty("603564");
  await T.page.selectOption("#mvPanelGuestsSelect", "1"); await T.settle();
  const lay = await T.page.evaluate(() => { const a = document.getElementById("mvPropBack"); const r = a.getBoundingClientRect(); return { inside: r.left >= 0 && r.right <= document.documentElement.clientWidth + 0.5 && r.height > 0, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }; });
  await T.page.focus("#mvPropTitle"); await T.page.keyboard.press("Shift+Tab");
  const f = await T.page.evaluate(() => ({ id: document.activeElement.id, href: document.activeElement.getAttribute("href"), fv: document.activeElement.matches(":focus-visible") }));
  ok(`3 ${vp.width}px: link visible, keyboard-focusable with the committed href`, lay.inside && !lay.overflow && f.id === "mvPropBack" && f.href === "/?checkin=2026-12-20&checkout=2026-12-24&guests=1", { lay, f });
  await T.page.keyboard.press("Enter"); await T.toSearch(); s = await T.st();
  ok(`3 ${vp.width}px: Enter returns to results; URL and form match the link`, s.url === "/?checkin=2026-12-20&checkout=2026-12-24&guests=1" && same(s.inputs, ["2026-12-20", "2026-12-24", "1"]), s);
  ok(`3 ${vp.width}px: network GET-only to listings/calendar/quote; no page errors`, T.methods.every((m) => m === "GET") && T.api.every((a) => /^(listings|calendar|quote)(\?|$)/.test(a)) && T.other.length === 0 && T.errors.length === 0, { api: T.api.filter((a) => !/^(listings|calendar|quote)/.test(a)), e: T.errors });
  await T.done();
}
T = await make(); await T.go("/");
ok("N served page = committed bytes; no legacy hook", (await (await T.page.request.get(BASE + "/")).text()) === PAGE && (await T.st()).hook === "undefined");
await T.done();

await browser.close(); server.close();
const total = Object.keys(results).length, pass = Object.values(results).filter((v) => v === "PASS").length;
console.log(`\n${pass}/${total} passed`);
process.exit(failed ? 1 : 0);
