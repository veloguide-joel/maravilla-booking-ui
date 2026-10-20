// UX7b2 (property Save): Save/Saved toggle on the property page, synchronised with the result-card hearts (unmodified page).
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
const save = () => T.page.evaluate(() => { const b = document.getElementById("mvPropSave"); if (!b) return null; const h1 = document.getElementById("mvPropTitle").getBoundingClientRect(), r = b.getBoundingClientRect(), g = document.getElementById("mvPropGallery")?.getBoundingClientRect();
  return { tag: b.tagName, type: b.getAttribute("type"), pressed: b.getAttribute("aria-pressed"), label: b.getAttribute("aria-label"), text: b.innerText.replace(/\s+/g, " ").trim(), saved: b.classList.contains("is-saved"),
    store: JSON.parse(localStorage.getItem("mv_saved") || "[]"), url: location.pathname + location.search, hist: history.length, focus: document.activeElement === b, fv: b.matches(":focus-visible"), outline: getComputedStyle(b).outlineStyle,
    rect: [r.left, r.top, r.right, r.bottom].map(Math.round), h1: [h1.left, h1.top, h1.right, h1.bottom].map(Math.round), gTop: g ? Math.round(g.top) : null, vw: document.documentElement.clientWidth,
    overlapTitle: !(r.right <= h1.left || r.left >= h1.right || r.bottom <= h1.top || r.top >= h1.bottom), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    top: (() => { const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e === b || b.contains(e); })() }; });
const cardHeart = (id) => T.page.evaluate((id) => { const h = document.querySelector(`.mv-card[data-apartment-id="${id}"] .mv-heart`); return { on: h.dataset.on, label: h.getAttribute("aria-label"), text: h.textContent.trim() }; }, id);

// ===== 1. Placement, semantics, toggle, no navigation =====
T = await make();
await T.go("/"); await T.search("2026-12-20", "2026-12-24"); await T.toProperty("603566"); let b = await save();
ok("1 a real <button type=button> 'Save' on the property page, aria-pressed=false, name 'Save East Side Studio'", b && b.tag === "BUTTON" && b.type === "button" && b.pressed === "false" && b.label === "Save East Side Studio" && b.text === "♡ Save", b);
ok("1 top right opposite the title (same row, right-aligned), not overlapping the title, above the gallery", b.rect[1] < b.h1[3] && b.rect[0] >= b.h1[2] - 1 && !b.overlapTitle && b.rect[3] <= b.gTop && b.rect[2] <= b.vw, b);
const h0 = b.hist; T.api.length = 0;
await T.page.click("#mvPropSave"); b = await save();
ok("1 click saves: aria-pressed=true, '♥ Saved', name 'Remove … from saved', stored under the same key as the card ('hostaway-603566')", b.pressed === "true" && b.text === "♥ Saved" && b.saved && b.label === "Remove East Side Studio from saved" && same(b.store, ["hostaway-603566"]), b);
ok("1 no navigation, no history entry, no request", b.url === "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2" && b.hist === h0 && T.api.length === 0, { b, api: T.api });
s = await T.st(); ok("1 booking panel untouched (5,760 still shown)", s.panel.price === "5,760 MXN", s.panel);
await T.page.click("#mvPropBack"); await T.toSearch(); s = await T.st();
ok("1 back on results: the card heart shows saved (♥, 'Remove …'), Saved (1), valid prices kept, no re-check prompt", s.cards[1].on === "1" && s.cards[1].heart === "Remove East Side Studio from saved" && s.saved === "Saved (1)" && /5,760 MXN/.test(s.cards[1].sub) && !/Check availability/.test(s.status), s);
// card heart → property page reflects it
await T.page.click('.mv-card[data-apartment-id="603564"] .mv-heart'); await T.toProperty("603564"); b = await save();
ok("1 saving from a card is reflected when the property page opens (pressed, 'Saved')", b.pressed === "true" && b.text === "♥ Saved", b);
await T.page.click("#mvPropSave"); b = await save();
ok("1 un-saving on the property page: 'Save', pressed=false, store updated", b.pressed === "false" && b.text === "♡ Save" && same(b.store, ["hostaway-603566"]), b);
await T.page.goBack(); await T.toSearch(); s = await T.st();
ok("1 browser Back: card heart for 603564 is un-saved; Saved (1)", s.cards[0].on === "0" && s.cards[0].heart === "Save Hacienda 5 De Mayo" && s.saved === "Saved (1)", s);
await T.page.goForward(); await T.page.waitForSelector("#mvPropSave"); b = await save();
ok("1 browser Forward: property page shows the current state (not saved)", b.pressed === "false", b);
await T.page.reload(); await T.page.waitForSelector("#mvPropSave"); await T.settle(); b = await save();
ok("1 refresh: state persists (603564 not saved)", b.pressed === "false" && same(b.store, ["hostaway-603566"]), b);
await T.go("/property/603566"); b = await save();
ok("1 direct link to a saved property (no dates): shows 'Saved'", b.pressed === "true" && b.text === "♥ Saved", b);
ok("1 no page errors", T.errors.length === 0, T.errors);
await T.done();

// ===== 2. Saved filter follows property-page changes =====
T = await make();
await T.go("/"); await T.search("2026-12-20", "2026-12-24");
await T.page.click('.mv-card[data-apartment-id="603566"] .mv-heart'); await T.page.click('.mv-card[data-apartment-id="603564"] .mv-heart'); await T.page.click("#mvShowSaved"); await sl(60);
await T.toProperty("603566"); await T.page.click("#mvPropSave");
await T.page.click("#mvPropBack"); await T.toSearch(); await sl(100); s = await T.st();
ok("2 un-saving on the property page removes it from the active Saved list (Saved (1), only 603564), with a re-check prompt instead of stale prices", s.savedActive && s.saved === "Saved (1)" && same(s.cards.map((c) => c.id), ["603564"]) && s.cards.every((c) => !/MXN/.test(c.sub)) && s.status === "Check availability to update results.", s);
await T.page.click("#mvShowAll"); await sl(60); await T.toProperty("603566"); await T.page.click("#mvPropSave");
await T.page.click("#mvPropBack"); await T.toSearch(); await T.page.click("#mvShowSaved"); await sl(60); s = await T.st();
ok("2 saving again on the property page: the Saved filter lists both", s.saved === "Saved (2)" && same(s.cards.map((c) => c.id).sort(), ["603564", "603566"]), s);
await T.done();

// ===== 3. Keyboard =====
T = await make();
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2");
await T.page.focus("#mvPropBack"); await T.page.keyboard.press("Tab"); b = await save();
ok("3 Tab from 'Back to results' reaches Save next; visible focus ring", b.focus && b.fv && b.outline === "solid", b);
const hk = b.hist;
await T.page.keyboard.press("Enter"); b = await save();
ok("3 Enter saves; focus stays; no navigation", b.pressed === "true" && b.focus && b.hist === hk && b.url.startsWith("/property/603566"), b);
await T.page.keyboard.press("Space"); b = await save();
ok("3 Space un-saves; focus stays", b.pressed === "false" && b.focus && same(b.store, []), b);
await T.done();

// ===== 4. Mobile =====
for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
  for (const id of ["603564", "603566"]) {
    T = await make({ vp }); await T.go(`/property/${id}?checkin=2026-12-20&checkout=2026-12-24&guests=2`); b = await save();
    ok(`4 ${vp.width}px ${id}: Save fits (≥44px tall, inside the viewport), does not overlap the title, sits above the gallery, on top; no overflow`, b.rect[3] - b.rect[1] >= 44 && b.rect[0] >= 0 && b.rect[2] <= b.vw && !b.overlapTitle && b.rect[3] <= b.gTop && b.top && !b.overflow, b);
    const hm = b.hist; await T.page.click("#mvPropSave"); b = await save();
    ok(`4 ${vp.width}px ${id}: tap saves without navigating; price intact`, b.pressed === "true" && b.hist === hm && b.url.startsWith(`/property/${id}`) && /MXN/.test((await T.st()).panel.price || ""), b);
    ok(`4 ${vp.width}px ${id}: GET-only network, no page errors`, T.methods.every((m) => m === "GET") && T.api.every((a) => /^(listings|calendar|quote)(\?|$)/.test(a)) && T.other.length === 0 && T.errors.length === 0, { e: T.errors });
    await T.done();
  }
}

await browser.close(); server.close();
const total = Object.keys(results).length, pass = Object.values(results).filter((v) => v === "PASS").length;
console.log(`\n${pass}/${total} passed`);
process.exit(failed ? 1 : 0);
