// UX7a: search cards -> dedicated property pages (the guest journey).
// Runs on the UNMODIFIED committed page: no context here sets the legacy-modal cookie, and the suite asserts that the
// served bytes equal the committed file and that no test hook exists in the page.
// Deterministic fixtures (fixed clock 2026-10-19; real 603566 Dec 24–31 reservation; 603564 Jan 7–Mar 2 2027 block).
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync } from "node:fs";
import { PAGE_PATH } from "../lib/page-source.mjs";
import { HOOK_NAME } from "../lib/modal-entry.mjs";
import { TODAY, PROXY, listings, calendarFor, quoteFor, overlaps, nightsOf, PNG_1x1 } from "../fixtures/pilots.mjs";

const PAGE = readFileSync(PAGE_PATH, "utf8");
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost:5500");
  if (u.pathname === "/consumer/booking-test.html" || u.pathname === "/" || /^\/property\/[^/]+\/?$/.test(u.pathname)) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE); return; } // committed bytes only
  res.writeHead(404); res.end("not found");
});
await new Promise((r) => server.listen(5500, "localhost", r));
const results = {}; let failed = 0;
const ok = (name, cond, detail) => { results[name] = cond ? "PASS" : "FAIL"; if (!cond) { failed++; console.log("FAIL", name, JSON.stringify(detail).slice(0, 900)); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sl = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const BASE = "http://localhost:5500";

async function make({ vp = { width: 1280, height: 900 }, hooks = {} } = {}) {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: "reduce" });
  const FIXED = new Date(TODAY + "T12:00:00").getTime();
  await ctx.addInitScript((FIXED) => { const D = Date; class M extends D { constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); } static now() { return FIXED; } } window.Date = M; }, FIXED);
  const T = { ctx, api: [], methods: [], other: [], errors: [], hooks };
  // Context-level routing so new tabs opened from card links get the same fixture backend.
  await ctx.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === PROXY) {
      const p = Object.fromEntries(u.searchParams); T.api.push(u.pathname.replace("/api/booking/", "") + u.search); T.methods.push(route.request().method());
      const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", headers: { "access-control-allow-origin": BASE }, body: JSON.stringify(b) });
      const H = T.hooks;
      if (u.pathname === "/api/booking/listings") return json(listings);
      if (u.pathname === "/api/booking/calendar") { const c = calendarFor(p.id, p.from, p.to); return json(c.body, c.status); }
      if (u.pathname === "/api/booking/quote") {
        const h = H.quote && H.quote(p); if (h && h.delayMs) await sl(h.delayMs);
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
  const page = await ctx.newPage(); T.page = page;
  const watch = (pg) => { pg.on("pageerror", (e) => T.errors.push(e.message)); pg.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) T.errors.push(m.text()); }); };
  watch(page); ctx.on("page", watch);
  T.settle = (pg = page) => pg.waitForFunction(() => { const c = document.getElementById("mvPanel"); return !c || (c.dataset.state && c.dataset.state !== "loading"); }, null, { timeout: 15000 });
  T.go = async (path) => { await page.goto(BASE + path); await page.waitForFunction(() => document.querySelector(".mv-card") || (document.querySelector("#mvPropertyView h1") && !/Loading/.test(document.querySelector("#mvPropertyView h1").textContent)), null, { timeout: 15000 }); await T.settle(); };
  T.search = async (a, b, guests = "2") => {
    await page.evaluate(([a, b, g]) => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); }; set("mvGuests", g); set("mvCheckin", a); set("mvCheckout", b); document.getElementById("mvSearchBtn").disabled = false; document.getElementById("mvSearchBtn").click(); }, [a, b, guests]);
    await page.waitForFunction(() => !document.getElementById("mvSearchBtn").disabled && ![...document.querySelectorAll(".mv-card__meta span:last-child")].some((s) => /Checking/.test(s.textContent)), null, { timeout: 10000 });
  };
  T.toProperty = async (sel) => { await page.click(sel); await page.waitForFunction(() => !document.getElementById("mvPropertyView").classList.contains("mv-view-hidden") && document.getElementById("mvPanel")); await T.settle(); };
  T.toSearch = () => page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden"));
  T.st = (pg = page) => pg.evaluate((HOOK) => {
    const vis = (el) => !!el && !el.classList.contains("mv-view-hidden");
    const dupIds = (() => { const seen = new Map(); document.querySelectorAll("[id]").forEach((el) => seen.set(el.id, (seen.get(el.id) || 0) + 1)); return [...seen].filter(([, n]) => n > 1).map(([id]) => id); })();
    const c = document.getElementById("mvPanel"); const t = (s) => c?.querySelector(s)?.textContent ?? null;
    return { url: location.pathname + location.search, prop: vis(document.getElementById("mvPropertyView")), app: vis(document.getElementById("mv-app")),
      h1: document.querySelector("#mvPropertyView h1")?.textContent ?? null, focus: document.activeElement?.id || document.activeElement?.className || null,
      modalOpen: document.getElementById("mvModal")?.getAttribute("aria-hidden") === "false", hook: typeof window[HOOK],
      panel: c ? { state: c.dataset.state, price: t("#mvPanelPrice"), was: t(".mv-panel__was"), checkin: t("#mvPanelCheckin"), checkout: t("#mvPanelCheckout"), guests: t("#mvPanelGuests"), status: document.getElementById("mvPanelStatus")?.innerText.replace(/\s+/g, " ").trim() ?? "" } : null,
      inputs: [document.getElementById("mvCheckin").value, document.getElementById("mvCheckout").value, document.getElementById("mvGuests").value],
      cards: [...document.querySelectorAll(".mv-card")].map((card) => ({ id: card.dataset.apartmentId, shown: card.style.display !== "none", href: card.querySelector(".mv-card__link")?.getAttribute("href"), media: card.querySelector(".mv-card__media")?.getAttribute("href"), sub: card.querySelector(".mv-card__meta span:last-child")?.innerText.replace(/\s+/g, " ") })),
      saved: document.getElementById("mvShowSaved").textContent, savedActive: document.getElementById("mvShowSaved").classList.contains("is-active"),
      scrollY: Math.round(window.scrollY), hist: history.length, dupIds };
  }, HOOK_NAME);
  T.done = () => ctx.close();
  return T;
}
const quotes = (api) => api.filter((a) => a.startsWith("quote"));
const cals = (api) => api.filter((a) => a.startsWith("calendar"));
const card = (id) => `.mv-card[data-apartment-id="${id}"]`;

// ===== 0. Production-equivalent source; no hook =====
let T = await make();
await T.go("/"); let s = await T.st();
const served = await (await T.page.request.get(BASE + "/")).text();
ok("0 served page is byte-identical to the committed file; no legacy hook, cookie or test switch in it", served === PAGE && !PAGE.includes(HOOK_NAME) && !/__mvTest|mv_test_legacy_modal/.test(served));
ok("0 no test hook in the running page", s.hook === "undefined", s.hook);

// ===== 1. Card markup and accessibility =====
const mk = await T.page.evaluate(() => [...document.querySelectorAll(".mv-card")].map((c) => {
  const links = [...c.querySelectorAll("a")]; const tabbable = [...c.querySelectorAll("a[href], button, input, select, textarea, [tabindex]")].filter((e) => e.tabIndex >= 0);
  const t = c.querySelector(".mv-card__link"), m = c.querySelector(".mv-card__media");
  return { id: c.dataset.apartmentId, links: links.length, tabbable: tabbable.map((e) => e.className), titleText: t?.textContent, titleHref: t?.getAttribute("href"), mediaHref: m?.getAttribute("href"), mediaHidden: m?.getAttribute("aria-hidden"), mediaTab: m?.getAttribute("tabindex"),
    nested: !!c.querySelector("a a, a button, button a, a [tabindex]:not([tabindex='-1']), a input, a select"), heartInLink: !!c.querySelector("a .mv-heart"), imgInMedia: !!m?.querySelector("img, .mv-card__noimg") };
}));
ok("1 two cards, each: photo and title are real links to /property/{id} with the current search (no dates yet → guests only)", same(mk.map((c) => [c.id, c.titleHref, c.mediaHref]), [["603564", "/property/603564?guests=2", "/property/603564?guests=2"], ["603566", "/property/603566?guests=2", "/property/603566?guests=2"]]), mk);
ok("1 title link text is the property name (accessible link label)", mk[0].titleText === "Hacienda 5 De Mayo" && mk[1].titleText === "East Side Studio", mk.map((c) => c.titleText));
ok("1 exactly one keyboard target per card (the title link); the photo link is aria-hidden and tabindex -1", mk.every((c) => same(c.tabbable, ["mv-card__link"]) && c.mediaHidden === "true" && c.mediaTab === "-1" && c.imgInMedia), mk);
ok("1 no nested interactive markup; the heart is outside both links", mk.every((c) => !c.nested && !c.heartInLink && c.links === 2), mk);

// ===== 2. Title click, no search dates =====
T.api.length = 0;
await T.toProperty(`${card("603564")} .mv-card__link`); s = await T.st();
ok("2 title click opens /property/603564 (guests carried, no dates) in the same document", s.url === "/property/603564?guests=2" && s.prop && !s.app && s.h1 === "Hacienda 5 De Mayo", s);
ok("2 focus moves to the property title; the legacy modal is never opened", s.focus === "mvPropTitle" && !s.modalOpen, s);
ok("2 property page asks for dates itself (no price without dates; no quote request)", s.panel && s.panel.price === null && quotes(T.api).length === 0, { panel: s.panel, api: T.api });
// direct date selection on the property page (UX4b) after arriving without dates
await T.page.click("#mvPanelCheckin"); await T.page.waitForSelector("#mvPdCalMonths .mv-cal__month");
for (let i = 0; i < 2; i++) await T.page.click("#mvPdCalNext");
const dayP = (iso) => `#mvPdCalMonths .mv-cal__day[data-date="${iso}"]`;
await T.page.waitForSelector(dayP("2026-12-20")); await T.page.click(dayP("2026-12-20")); await T.page.click(dayP("2026-12-24"));
await T.page.waitForFunction(() => !document.getElementById("mvPdCalApply").disabled, null, { timeout: 8000 }); await T.page.click("#mvPdCalApply"); await T.settle(); s = await T.st();
ok("2 dates chosen on the property page price 603564 Dec 20–24 (8,800 → 7,920) and update the URL in place", s.panel.price === "7,920 MXN" && s.panel.was === "8,800 MXN" && s.url === "/property/603564?checkin=2026-12-20&checkout=2026-12-24&guests=2", s);
await T.done();

// ===== 3. Search → photo click → property page validates independently =====
T = await make();
await T.go("/"); await T.search("2026-12-20", "2026-12-24"); s = await T.st();
ok("3 search Dec 20–24 prices both cards (7,920 / 5,760) and both card links carry the dates and guests", /7,920 MXN/.test(s.cards[0].sub) && /5,760 MXN/.test(s.cards[1].sub) && s.cards.every((c) => c.href === `/property/${c.id}?checkin=2026-12-20&checkout=2026-12-24&guests=2` && c.media === c.href), s.cards);
// the property page must not reuse the card figure: make the next quote come back without a direct estimate
T.hooks.quote = () => ({ mutate: (b) => { b.direct = { estimate: true, status: "estimate_unavailable", reason: "TEST", currency: "MXN" }; } });
T.api.length = 0; const h3 = s.hist;
await T.toProperty(`${card("603566")} .mv-card__media`); s = await T.st();
ok("3 photo click opens /property/603566 with Dec 20–24 and 2 guests; one history entry added", s.url === "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2" && s.h1 === "East Side Studio" && s.hist === h3 + 1, s);
ok("3 property page re-validates on its own (calendar + quote for 603566 Dec 20–24 after the click)", cals(T.api).some((a) => /id=603566/.test(a)) && same(quotes(T.api), ["quote?id=603566&from=2026-12-20&to=2026-12-24&guests=2"]), T.api);
ok("3 the search card's 5,760 is not treated as authoritative: the page shows its own fresh answer (6,400 standard, no estimate)", s.panel.price === "6,400 MXN" && s.panel.state === "quoted", s.panel);
T.hooks.quote = null;
await T.page.click("#mvPropBack"); await T.toSearch(); s = await T.st();
ok("3 Back to results: search view, URL and dates/guests intact, card prices still shown, no duplicate ids", s.app && s.url === "/?checkin=2026-12-20&checkout=2026-12-24&guests=2" && same(s.inputs, ["2026-12-20", "2026-12-24", "2"]) && /5,760 MXN/.test(s.cards[1].sub) && s.dupIds.length === 0, s);
await T.page.goForward(); await T.page.waitForSelector("#mvPanel"); await T.settle(); s = await T.st();
ok("3 browser Forward returns to the property page and re-validates (5,760 estimate)", s.prop && s.url === "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2" && s.panel.price === "5,760 MXN", s);
await T.page.goBack(); await T.toSearch(); s = await T.st();
ok("3 browser Back returns to the results view", s.app && s.url.startsWith("/?checkin=2026-12-20"), s);
await T.page.reload(); await T.page.waitForSelector(".mv-card"); s = await T.st();
ok("3 reload of the results URL still shows the search page with both cards", s.app && s.cards.length === 2, s);
await T.done();

// ===== 4. Card body click, heart independence, favorites + saved filter =====
T = await make();
await T.go("/"); await T.search("2026-12-20", "2026-12-24"); s = await T.st();
const h4 = s.hist;
await T.page.click(`${card("603566")} .mv-heart`); await sl(80); s = await T.st();
ok("4 heart click toggles the favourite and never navigates", s.app && !s.prop && s.saved === "Saved (1)" && s.hist === h4, s);
await T.page.click(`${card("603566")} .mv-heart`); await sl(80); s = await T.st();
ok("4 second heart click un-saves; still on results", s.saved === "Saved (0)" && !s.prop && s.hist === h4, s);
await T.page.click(`${card("603566")} .mv-heart`); await sl(80);
await T.page.click("#mvShowSaved"); await sl(80); s = await T.st();
ok("4 Saved filter shows only the favourite", s.savedActive && s.cards.length === 1 && s.cards[0].id === "603566", s);
await T.toProperty(`${card("603566")} .mv-card__meta`); s = await T.st();
ok("4 card body (non-link area) click opens the same property page", s.prop && s.url === "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2", s);
await T.page.click("#mvPropBack"); await T.toSearch(); s = await T.st();
ok("4 back on results: Saved filter, favourite and search dates preserved", s.savedActive && s.saved === "Saved (1)" && s.cards.length === 1 && same(s.inputs, ["2026-12-20", "2026-12-24", "2"]), s);
await T.page.click(`${card("603566")} .mv-card__tag`).catch(() => {});
await T.page.waitForFunction(() => !document.getElementById("mvPropertyView").classList.contains("mv-view-hidden")); s = await T.st();
ok("4 tagline area also navigates (any non-interactive body area)", s.prop, s);
await T.done();

// ===== 5. New tab / window: native link behaviour =====
T = await make();
await T.go("/"); await T.search("2026-12-20", "2026-12-24");
const want = "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2";
const newTab = async (fn) => { const [pg] = await Promise.all([T.ctx.waitForEvent("page", { timeout: 5000 }), fn()]); await pg.waitForLoadState(); await pg.waitForSelector("#mvPanel", { timeout: 15000 }); await T.settle(pg); const st = await T.st(pg); await pg.close(); return st; };
let nt = await newTab(() => T.page.click(`${card("603566")} .mv-card__link`, { modifiers: ["Control"] }));
s = await T.st();
ok("5 Ctrl+click on the title opens the property in a new tab (direct URL, own validation: 5,760); the results tab stays put", nt.url === want && nt.panel.price === "5,760 MXN" && s.app && !s.prop, { nt, s: s.url });
nt = await newTab(() => T.page.click(`${card("603566")} .mv-card__media`, { button: "middle" }));
ok("5 middle-click on the photo opens a new tab at the same URL", nt.url === want && nt.prop, nt);
nt = await newTab(() => T.page.click(`${card("603564")} .mv-card__link`, { modifiers: ["Shift"] }));
ok("5 Shift+click opens a new window for 603564 with the dates", nt.url === "/property/603564?checkin=2026-12-20&checkout=2026-12-24&guests=2" && nt.panel.price === "7,920 MXN", nt);
ok("5 new tabs carry no legacy hook and never open the modal", nt.hook === "undefined" && !nt.modalOpen, nt);
const pagesBefore = T.ctx.pages().length;
await T.page.click(`${card("603566")} .mv-card__meta`, { modifiers: ["Control"] }); await sl(300); s = await T.st();
ok("5 trade-off: a modified click on the non-link card body does nothing (only real links open tabs)", T.ctx.pages().length === pagesBefore && s.app && !s.prop, { pages: T.ctx.pages().length, s: s.url });
const hrefNow = await T.page.getAttribute(`${card("603566")} .mv-card__link`, "href");
ok("5 'Open in new tab' / copy link uses the current href", hrefNow === want, hrefNow);
await T.done();

// ===== 6. Property-page editing after arriving from a card; return shows the committed search =====
T = await make();
await T.go("/"); await T.search("2026-12-20", "2026-12-24");
await T.toProperty(`${card("603566")} .mv-card__link`);
await T.page.click("#mvPanelCheckout"); await T.page.waitForSelector("#mvPdCalMonths .mv-cal__month");
await T.page.click(dayP("2026-12-23")); await T.page.waitForFunction(() => !document.getElementById("mvPdCalApply").disabled, null, { timeout: 8000 }); await T.page.click("#mvPdCalApply"); await T.settle();
await T.page.click("#mvPanelCheckin"); await T.page.waitForSelector("#mvPdCalMonths .mv-cal__month");
await T.page.click(dayP("2026-12-21")); await T.page.waitForFunction(() => !document.getElementById("mvPdCalApply").disabled, null, { timeout: 8000 }); await T.page.click("#mvPdCalApply"); await T.settle(); s = await T.st();
ok("6 date editing on the arrived page: Dec 21 → Dec 23 priced 2,880 (UX4b)", s.panel.checkin === "Dec 21, 2026" && s.panel.checkout === "Dec 23, 2026" && s.panel.price === "2,880 MXN" && s.url === "/property/603566?checkin=2026-12-21&checkout=2026-12-23&guests=2", s);
T.api.length = 0; await T.page.selectOption("#mvPanelGuestsSelect", "1"); await T.settle(); s = await T.st();
ok("6 guest editing reprices with one validated quote (UX5): 1 guest, 2,880", s.panel.guests === "1 guest" && s.panel.price === "2,880 MXN" && same(quotes(T.api), ["quote?id=603566&from=2026-12-21&to=2026-12-23&guests=1"]) && s.url.endsWith("guests=1"), { s, api: T.api });
await T.page.click("#mvPropBack"); await T.toSearch(); s = await T.st();
ok("6 back on results: shared dates/guests follow the property page; the old Dec 20–24 prices are withdrawn (not shown as current)", same(s.inputs, ["2026-12-21", "2026-12-23", "1"]) && s.cards.every((c) => !/MXN/.test(c.sub)), s);
ok("6 card links now carry the committed Dec 21–23, 1 guest", s.cards.every((c) => c.href === `/property/${c.id}?checkin=2026-12-21&checkout=2026-12-23&guests=1`), s.cards);
await T.done();

// ===== 7. Reservation boundary, direct URLs and reload =====
T = await make();
await T.go("/"); await T.search("2026-12-24", "2026-12-31"); s = await T.st();
ok("7 search Dec 24–31: 603566 hidden as unavailable (reservation); 603564 priced", s.cards.find((c) => c.id === "603566").shown === false && s.cards.find((c) => c.id === "603564").shown && /MXN/.test(s.cards.find((c) => c.id === "603564").sub), s.cards);
await T.go("/property/603566?checkin=2026-12-24&checkout=2026-12-31&guests=2"); s = await T.st();
ok("7 direct URL into the reservation: the property page refuses Dec 24–31 itself (no price)", s.prop && s.panel.price === null && /not available|unavailable/i.test(s.panel.status), s.panel);
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2"); await T.page.reload(); await T.page.waitForSelector("#mvPanel"); await T.settle(); s = await T.st();
ok("7 direct URL + reload: Dec 20–24 re-validated at 5,760", s.panel.price === "5,760 MXN" && s.url === "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2", s);
await T.page.click("#mvPropBack"); await T.toSearch(); s = await T.st();
ok("7 Back to results from a direct load goes to the search page with the same dates", s.app && s.url === "/?checkin=2026-12-20&checkout=2026-12-24&guests=2" && same(s.inputs, ["2026-12-20", "2026-12-24", "2"]), s);
await T.done();

// ===== 8. Stale cross-view responses =====
T = await make({ hooks: { quote: (p) => (p.id === "603564" ? { delayMs: 900 } : null) } });
await T.go("/");
await T.page.evaluate(() => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); }; set("mvCheckin", "2026-12-20"); set("mvCheckout", "2026-12-24"); document.getElementById("mvSearchBtn").click(); });
await sl(100);
await T.toProperty(`${card("603566")} .mv-card__link`); await sl(1500); s = await T.st();
ok("8 card clicked while the search is still quoting: the property panel shows only its own answer (5,760) after the late search reply", s.prop && s.panel.price === "5,760 MXN" && s.h1 === "East Side Studio", s);
await T.page.click("#mvPropBack"); await T.toSearch(); await T.page.waitForFunction(() => !document.getElementById("mvSearchBtn").disabled); s = await T.st();
ok("8 the search that finished in the background priced its own cards for its own dates", /7,920 MXN/.test(s.cards[0].sub) && /5,760 MXN/.test(s.cards[1].sub), s.cards);
// A → back → B quickly: only B's panel survives
T.hooks.quote = (p) => (p.id === "603564" ? { delayMs: 900 } : null);
await T.page.click(`${card("603564")} .mv-card__link`); await sl(80);
await T.page.goBack(); await T.toSearch();
await T.toProperty(`${card("603566")} .mv-card__link`); await sl(1200); s = await T.st();
ok("8 A then quickly B: only 603566 is shown and priced; the late 603564 answer is ignored", s.h1 === "East Side Studio" && s.panel.price === "5,760 MXN" && s.url.startsWith("/property/603566"), s);
ok("8 no duplicate ids in either view; modal never opened; no page errors", s.dupIds.length === 0 && !s.modalOpen && T.errors.length === 0, { d: s.dupIds, e: T.errors });
await T.done();

// ===== 9. Keyboard =====
T = await make();
await T.go("/"); await T.search("2026-12-20", "2026-12-24");
const order = await T.page.evaluate(() => [...document.querySelectorAll("#mvResults a[href], #mvResults button, #mvResults [tabindex]")].filter((e) => e.tabIndex >= 0).map((e) => e.className + ":" + e.textContent.trim().slice(0, 18)));
ok("9 results contain exactly two tab stops, one title link per card", order.length === 2 && order.every((o) => o.startsWith("mv-card__link")), order);
await T.page.focus(`${card("603564")} .mv-card__link`); await T.page.keyboard.press("Tab"); const f2 = await T.page.evaluate(() => document.activeElement.closest(".mv-card")?.dataset.apartmentId + ":" + document.activeElement.className);
ok("9 Tab moves from the first title link to the second (the photo link is skipped)", f2 === "603566:mv-card__link", f2);
await T.page.keyboard.press("Enter"); await T.page.waitForSelector("#mvPanel"); await T.settle(); s = await T.st();
ok("9 Enter on the title link opens the property page; focus on the property title", s.prop && s.url.startsWith("/property/603566?checkin=2026-12-20") && s.focus === "mvPropTitle" && s.panel.price === "5,760 MXN", s);
await T.page.keyboard.press("Shift+Tab"); const fb = await T.page.evaluate(() => document.activeElement.id);
ok("9 Back to results is reachable by keyboard just before the title", fb === "mvPropBack", fb);
await T.page.keyboard.press("Enter"); await T.toSearch(); s = await T.st();
ok("9 Enter on Back to results returns to the search view", s.app, s);
await T.done();

// ===== 10. Mobile 390 / 320: layout, tap targets, scroll restoration =====
for (const vp of [{ width: 390, height: 600 }, { width: 320, height: 568 }]) {
  T = await make({ vp });
  await T.go("/"); await T.search("2026-12-20", "2026-12-24");
  const lay = await T.page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, cards: [...document.querySelectorAll(".mv-card")].map((c) => { const r = c.getBoundingClientRect(), l = c.querySelector(".mv-card__link").getBoundingClientRect(); return { inside: l.left >= r.left - 0.5 && l.right <= r.right + 0.5 }; }) }));
  ok(`10 ${vp.width}px: no horizontal overflow; title links inside their cards`, !lay.overflow && lay.cards.every((c) => c.inside), lay);
  await T.page.evaluate(() => document.querySelector('.mv-card[data-apartment-id="603566"]').scrollIntoView({ block: "end" }));
  await sl(100); const y0 = await T.page.evaluate(() => Math.round(window.scrollY));
  const hit = await T.page.evaluate(() => { const l = document.querySelector('.mv-card[data-apartment-id="603566"] .mv-card__link'); const r = l.getBoundingClientRect(); const e = document.elementFromPoint(r.left + Math.min(20, r.width / 2), r.top + r.height / 2); return l.contains(e); });
  ok(`10 ${vp.width}px: the title link of the lower card is hit-testable after scrolling (page scrolled to ${y0})`, hit && y0 > 0, { hit, y0 });
  await T.toProperty(`${card("603566")} .mv-card__link`); s = await T.st();
  ok(`10 ${vp.width}px: property page opens at the top, priced 5,760`, s.scrollY === 0 && s.panel.price === "5,760 MXN", s);
  await T.page.click("#mvPropBack"); await T.toSearch(); await sl(150); s = await T.st();
  ok(`10 ${vp.width}px: Back to results restores the results scroll position (${y0})`, Math.abs(s.scrollY - y0) <= 2, { y: s.scrollY, y0 });
  await T.page.evaluate(() => document.querySelector('.mv-card[data-apartment-id="603566"]').scrollIntoView({ block: "end" })); await sl(80);
  await T.toProperty(`${card("603566")} .mv-card__media`); await T.page.goBack(); await T.toSearch(); await sl(150); s = await T.st();
  ok(`10 ${vp.width}px: browser Back also restores the scroll position`, Math.abs(s.scrollY - y0) <= 2, { y: s.scrollY, y0 });
  ok(`10 ${vp.width}px: no page errors`, T.errors.length === 0, T.errors);
  await T.done();
}

// ===== 11. UX6 search calendar → card → property (one journey) and network =====
T = await make();
await T.go("/");
await T.page.click("#mvDatesBtn"); await T.page.waitForSelector("#mvCalendarMonths .mv-calendar__day, #mvCalendarMonths button");
const dayS = (iso) => `#mvCalendarMonths [data-date="${iso}"]`;
for (let i = 0; i < 2; i++) await T.page.click("#mvCalNext");
await T.page.click(dayS("2026-12-20")); await T.page.click(dayS("2026-12-24"));
s = await T.st(); const stillOpen = await T.page.evaluate(() => document.getElementById("mvCalendarModal").getAttribute("aria-hidden") === "false");
ok("11 UX6 picker unchanged: stays open after check-out; inputs committed", stillOpen && same(s.inputs, ["2026-12-20", "2026-12-24", "2"]), { stillOpen, s: s.inputs });
await T.page.click("#mvCalSearch"); await T.page.waitForFunction(() => !document.getElementById("mvSearchBtn").disabled && ![...document.querySelectorAll(".mv-card__meta span:last-child")].some((x) => /Checking/.test(x.textContent))); s = await T.st();
ok("11 footer Check availability → priced cards with dated links", /5,760 MXN/.test(s.cards[1].sub) && s.cards[1].href === want, s.cards);
await T.toProperty(`${card("603566")} .mv-card__link`); s = await T.st();
ok("11 complete journey search → card → property: Dec 20–24, 2 guests, 5,760 Book Direct estimate (standard 6,400)", s.panel.price === "5,760 MXN" && s.panel.was === "6,400 MXN" && s.panel.checkin === "Dec 20, 2026" && s.panel.guests === "2 guests", s.panel);
ok("11 network: GET only, proxy listings/calendar/quote only; no hold/reservation/checkout/payment/Smoobu; no other hosts", T.methods.every((m) => m === "GET") && T.api.every((a) => /^(listings|calendar|quote)(\?|$)/.test(a)) && !T.api.some((a) => /hold|reserv|checkout|pay|stripe|smoobu/i.test(a)) && T.other.length === 0, { m: [...new Set(T.methods)], api: T.api.filter((a) => !/^(listings|calendar|quote)/.test(a)), other: T.other });
ok("11 no page errors", T.errors.length === 0, T.errors);
await T.done();

await browser.close(); server.close();
const total = Object.keys(results).length, pass = Object.values(results).filter((v) => v === "PASS").length;
console.log(`\n${pass}/${total} passed`);
process.exit(failed ? 1 : 0);
