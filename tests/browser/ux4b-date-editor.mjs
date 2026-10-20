// UX4b: property-page date editor (second calendar host) — draft vs committed dates, Apply → UX3 pipeline,
// replaceState URLs, stale/closed-editor protection, mobile, keyboard. Deterministic fixtures (fixed clock
// 2026-10-19, real 603566 Dec 24–31 reservation, 603564 Jan 7–Mar 2 2027 block); nothing is fetched.
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
const browser = await chromium.launch();
const SHOTS = process.env.UX4B_SHOTS || null;
const sl = (ms) => new Promise((r) => setTimeout(r, ms));

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
      const p = Object.fromEntries(u.searchParams); T.api.push(u.pathname.replace("/api/booking/", "") + u.search); T.methods.push(route.request().method());
      const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", headers: { "access-control-allow-origin": "http://localhost:5500" }, body: JSON.stringify(b) });
      const H = T.hooks;
      if (u.pathname === "/api/booking/listings") return json(listings);
      if (u.pathname === "/api/booking/calendar") { const h = H.calendar && H.calendar(p); if (h && h.delayMs) await sl(h.delayMs); if (h && h.status) return json({ ok: false }, h.status); const c = calendarFor(p.id, p.from, p.to); if (h && h.mutate) h.mutate(c.body); return json(c.body, c.status); }
      if (u.pathname === "/api/booking/quote") {
        const h = H.quote && H.quote(p); if (h && h.delayMs) await sl(h.delayMs); if (h && h.status) return json({ ok: false }, h.status);
        const id = Number(p.id), n = nightsOf(p.from, p.to), g = Number(p.guests); const base = { ok: true, listingId: id, from: p.from, to: p.to, nights: n, guests: g, currency: "MXN", checkedAt: "2026-10-19T18:05:00Z" };
        if (g > 2) return json({ ...base, available: false, decision: "unavailable", reasons: [{ code: "CAPACITY_EXCEEDED", message: "This property sleeps up to 2 guests." }] });
        if (overlaps(id, p.from, p.to)) return json({ ...base, available: false, decision: "unavailable", reasons: [{ code: "NIGHT_UNAVAILABLE", message: "One or more selected nights are not available." }] });
        const q = quoteFor(id, n); return json({ ...base, available: true, decision: "quoted", total: q.total, nightlyAverage: q.total / n, breakdown: q.breakdown, direct: q.direct, note: "Quote only." });
      }
      return json({ ok: false }, 404);
    }
    if (u.hostname === "example.com") return route.fulfill({ status: 200, contentType: "image/png", body: PNG_1x1 });
    if (u.hostname === "localhost") return route.continue();
    T.other.push(u.href); return route.abort();
  });
  T.go = async (path) => { await page.goto("http://localhost:5500" + path); await page.waitForFunction(() => document.querySelector(".mv-card") || (document.querySelector("#mvPropertyView h1") && !/Loading/.test(document.querySelector("#mvPropertyView h1").textContent)), null, { timeout: 15000 }); await T.settlePanel(); };
  T.settlePanel = () => page.waitForFunction(() => { const c = document.getElementById("mvPanel"); return !c || (c.dataset.state && c.dataset.state !== "loading"); }, null, { timeout: 15000 });
  T.settleEditor = async () => { await page.waitForFunction(() => { const st = document.getElementById("mvPdCalStatus"), se = document.getElementById("mvPdCalSelection"); if (!st) return true; return !/Loading live calendar/.test(st.textContent) && !/checking availability/.test(se?.textContent || ""); }, null, { timeout: 15000 }).catch(() => {}); await sl(60); };
  T.open = async (field = "checkin") => { await page.click(field === "checkin" ? "#mvPanelCheckin" : "#mvPanelCheckout"); await page.waitForSelector("#mvPdCalMonths .mv-cal__month"); await T.settleEditor(); };
  T.day = (iso) => `#mvPdCalMonths .mv-cal__day[data-date="${iso}"]`;
  T.clickDay = async (iso) => { await page.click(T.day(iso), { force: true, timeout: 8000 }); await T.settleEditor(); };
  T.goToMonth = async (title) => { for (let i = 0; i < 30; i++) { const titles = await page.evaluate(() => [...document.querySelectorAll("#mvPdCalMonths .mv-cal__title")].map((x) => x.textContent)); if (titles[0] === title) { await T.settleEditor(); return; } const want = new Date(title), have = new Date(titles[0]); await page.evaluate((d) => document.getElementById(d).click(), want > have ? "mvPdCalNext" : "mvPdCalPrev"); await sl(40); } throw new Error("month not reached " + title); };
  T.apply = async () => { await page.click("#mvPdCalApply"); await T.settlePanel(); };
  T.ed = () => page.evaluate(() => {
    const d = document.getElementById("mvPdCal"), q = (s) => document.querySelector(s);
    const norm = (t) => (t || "").replace(/\s+/g, " ").trim();
    const days = [...document.querySelectorAll("#mvPdCalMonths .mv-cal__day")];
    const dupIds = (() => { const seen = new Map(); document.querySelectorAll("[id]").forEach((el) => seen.set(el.id, (seen.get(el.id) || 0) + 1)); return [...seen].filter(([, n]) => n > 1).map(([id]) => id); })();
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom) }; };
    return {
      open: !d.hidden && d.getAttribute("aria-hidden") === "false", title: norm(q("#mvPdCalTitle")?.textContent), summary: norm(q("#mvPdCalSummary")?.textContent),
      status: norm(q("#mvPdCalStatus")?.innerText), statusRetry: !!q("#mvPdCalStatus button"),
      titles: [...document.querySelectorAll("#mvPdCalMonths .mv-cal__title")].map((x) => x.textContent), prev: q("#mvPdCalPrev")?.disabled ?? null, next: q("#mvPdCalNext")?.disabled ?? null,
      start: q("#mvPdCalMonths .is-start")?.dataset.date ?? null, end: q("#mvPdCalMonths .is-end")?.dataset.date ?? null, inrange: document.querySelectorAll("#mvPdCalMonths .is-inrange").length,
      blocked: days.filter((c) => c.classList.contains("is-blocked")).map((c) => c.dataset.date), unknown: days.filter((c) => c.classList.contains("is-unknown")).length, far: days.filter((c) => c.dataset.state === "far").length, farTags: [...new Set(days.filter((c) => c.dataset.state === "far").map((c) => c.tagName))],
      selection: norm(q("#mvPdCalSelection")?.innerText), selBtns: [...document.querySelectorAll("#mvPdCalSelection button")].map((b) => [b.textContent.trim(), b.getAttribute("aria-pressed")]),
      clear: q("#mvPdCalClear")?.disabled, apply: q("#mvPdCalApply")?.disabled, applyText: norm(q("#mvPdCalApply")?.textContent),
      focus: document.activeElement?.id || document.activeElement?.tagName, locked: document.documentElement.classList.contains("mv-pdcal-open"), inert: document.getElementById("mvPropertyView").inert,
      dupIds, dayLabel: (iso) => null,
      labels: Object.fromEntries(["2026-12-20", "2026-12-22", "2026-12-24", "2026-12-26"].map((iso) => [iso, q(`#mvPdCalMonths .mv-cal__day[data-date="${iso}"]`)?.getAttribute("aria-label") ?? null])),
      panelRect: r(q("#mvPdCalPanel")), footerRect: r(q(".mv-pdcal__footer")), applyRect: r(q("#mvPdCalApply")), vw: innerWidth, vh: innerHeight, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      stacked: (() => { const m = [...document.querySelectorAll("#mvPdCalMonths .mv-cal__month")]; return m.length === 2 ? m[1].getBoundingClientRect().top >= m[0].getBoundingClientRect().bottom - 1 : null; })(),
      modalMonths: !!document.getElementById("mvHostawayCalendarMonths"), modalSelected: String(window.mvSelectedApartmentId ?? ""),
      anchored: document.getElementById("mvPdCal").classList.contains("mv-pdcal--anchored"), cardRect: r(document.getElementById("mvPanel")), fieldsRect: r(document.querySelector("#mvPanel .mv-panel__fields"))
    };
  });
  T.panel = () => page.evaluate(() => {
    const c = document.getElementById("mvPanel"); if (!c) return null; const t = (s) => c.querySelector(s)?.textContent ?? null;
    return { state: c.dataset.state, price: t("#mvPanelPrice"), was: t(".mv-panel__was"), badge: t(".mv-panel__badge"), checkin: t("#mvPanelCheckin"), checkout: t("#mvPanelCheckout"), guests: t("#mvPanelGuests"), status: document.getElementById("mvPanelStatus")?.innerText.trim() ?? "", rows: [...c.querySelectorAll("#mvPanelRows .mv-panel__row")].map((r) => [r.querySelector("dt").textContent, r.querySelector("dd").textContent]), url: location.pathname + location.search, hist: history.length, focus: document.activeElement?.id, guestsBtn: !!c.querySelector(".mv-panel__field--guests button"), controls: [...c.querySelectorAll("button,a")].map((b) => b.textContent.trim()), inputs: [document.getElementById("mvCheckin").value, document.getElementById("mvCheckout").value, document.getElementById("mvGuests").value], datesBtn: document.getElementById("mvDatesBtn").textContent };
  });
  T.done = () => ctx.close();
  return T;
}
const quoteCalls = (api) => api.filter((a) => a.startsWith("quote"));
const calCalls = (api) => api.filter((a) => a.startsWith("calendar"));

// ===== 1. Direct URL without dates → pick a stay → Apply =====
let T = await make();
await T.go("/property/603566"); let p0 = await T.panel();
ok("1 603566 no dates: panel empty, fields are 'Add date' buttons, guests display-only, no search link", p0.state === "empty" && p0.checkin === "Add date" && p0.checkout === "Add date" && !p0.guestsBtn && same(p0.controls, ["Add date", "Add date"]), p0);
T.api.length = 0;
await T.open("checkin"); let e = await T.ed();
ok("1 click Check-in opens the editor: dialog, focus on Close, title with the property name, current month first, no selection, page inert + scroll locked", e.open && e.focus === "mvPdCalClose" && /East Side Studio/.test(e.title) && same(e.titles, ["October 2026", "November 2026"]) && e.start === null && e.end === null && e.locked && e.inert, e);
ok("1 desktop: the editor is anchored to the booking panel (right edges aligned, top at the date fields), not a centred overlay", e.anchored && Math.abs(e.panelRect.r - e.cardRect.r) <= 1 && Math.abs(e.panelRect.y - Math.min(Math.max(16, e.fieldsRect.y - 8), Math.max(16, e.vh - e.panelRect.h - 16))) <= 1 && e.panelRect.w <= 720 && e.panelRect.b <= e.vh, { p: e.panelRect, c: e.cardRect, f: e.fieldsRect, a: e.anchored });
ok("1 open with no dates: Clear and Apply disabled; summary asks for a check-in night", e.clear === true && e.apply === true && /Choose a check-in night/.test(e.summary), e);
ok("1 opening fetched one fresh view window only (no stay window, no quote)", same(T.api, ["calendar?id=603566&from=2026-10-19&to=2026-11-30"]), T.api);
await T.goToMonth("December 2026"); e = await T.ed();
ok("1 navigate to Dec/Jan: one fresh window per viewed pair of months, reservation nights Dec 24–30 blocked, Dec 31 open, no quote", same(e.titles, ["December 2026", "January 2027"]) && same(e.blocked, ["2026-12-24", "2026-12-25", "2026-12-26", "2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30"]) && quoteCalls(T.api).length === 0 && same(calCalls(T.api), ["calendar?id=603566&from=2026-10-19&to=2026-11-30", "calendar?id=603566&from=2026-11-01&to=2026-12-31", "calendar?id=603566&from=2026-12-01&to=2027-01-31"]), { t: e.titles, b: e.blocked, api: T.api });
await T.clickDay("2026-12-20"); e = await T.ed();
ok("1 Dec 20 → check-in drafted; Apply still disabled (incomplete); Clear enabled", e.start === "2026-12-20" && e.end === null && e.apply === true && e.clear === false && /Check-in Dec 20/.test(e.summary), e);
await T.clickDay("2026-12-24"); e = await T.ed(); let pMid = await T.panel();
ok("1 Dec 24 → complete draft verified by a fresh stay window; Apply enabled; summary 4 nights; distinct check-in / in-range / check-out", e.start === "2026-12-20" && e.end === "2026-12-24" && e.inrange === 3 && e.apply === false && e.summary === "Dec 20 → Dec 24 · 4 nights" && /occupied nights clear/.test(e.selection) && T.api.includes("calendar?id=603566&from=2026-12-20&to=2026-12-24"), e);
ok("1 while drafting: committed panel unchanged (still empty), URL unchanged, zero quote requests", pMid.state === "empty" && pMid.checkin === "Add date" && pMid.url === "/property/603566" && quoteCalls(T.api).length === 0, { p: pMid, api: T.api });
ok("1 desktop: after the draft grows, the dialog still fits the viewport with Apply visible", e.panelRect.b <= e.vh && e.applyRect.b <= e.vh && e.applyRect.y >= 0, { p: e.panelRect, a: e.applyRect, vh: e.vh });
ok("1 accessible day labels carry check-in / in selected stay / check-out", /2026-12-20: available, check-in$/.test(e.labels["2026-12-20"]) && /in selected stay$/.test(e.labels["2026-12-22"]) && /2026-12-24: unavailable, check-out$/.test(e.labels["2026-12-24"]) && /unavailable$/.test(e.labels["2026-12-26"]), e.labels);
if (SHOTS) await T.page.screenshot({ path: `${SHOTS}/ux4b-desk-editor.png` });
const hist0 = pMid.hist;
await T.apply(); let p1 = await T.panel(); e = await T.ed();
ok("1 Apply: editor closed, scroll/inert restored, focus on the Check-in field", !e.open && !e.locked && !e.inert && p1.focus === "mvPanelCheckin", { e: [e.open, e.locked, e.inert], f: p1.focus });
ok("1 Apply: panel fields Dec 20, 2026 / Dec 24, 2026; UX3 pipeline ran (one stay check + one quote); 6,400 → 5,760 with Save 10%", p1.checkin === "Dec 20, 2026" && p1.checkout === "Dec 24, 2026" && p1.state === "direct" && p1.price === "5,760 MXN" && p1.was === "6,400 MXN" && same(quoteCalls(T.api), ["quote?id=603566&from=2026-12-20&to=2026-12-24&guests=2"]), { p: p1, api: T.api });
ok("1 Apply: URL replaced in place (/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2), history length unchanged; shared inputs + search pill mirror the committed dates", p1.url === "/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2" && p1.hist === hist0 && same(p1.inputs, ["2026-12-20", "2026-12-24", "2"]) && /Dec 20/.test(p1.datesBtn), p1);
ok("1 no page errors", T.errors.length === 0, T.errors);
await T.done();

// ===== 2. Open from Checkout with committed dates; edit the draft; Cancel paths =====
T = await make(); await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2"); const pc = await T.panel(); T.api.length = 0;
await T.open("checkout"); e = await T.ed();
ok("2 open from Checkout: committed range highlighted (Dec 20 start, 3 nights, Dec 24 end), view at the check-in month, check-out edit mode preselected, Apply enabled", e.start === "2026-12-20" && e.end === "2026-12-24" && e.inrange === 3 && same(e.titles, ["December 2026", "January 2027"]) && same(e.selBtns, [["Change check-in", "false"], ["Change check-out", "true"]]) && e.apply === false, e);
ok("2 opening with a committed stay: view window + stay window, no quote", calCalls(T.api).length === 2 && quoteCalls(T.api).length === 0, T.api);
await T.clickDay("2026-12-23"); e = await T.ed(); let pd = await T.panel();
ok("2 Dec 23 in check-out mode → draft Dec 20–23 verified; committed panel still Dec 24 + 5,760; URL unchanged; no quote", e.start === "2026-12-20" && e.end === "2026-12-23" && e.apply === false && pd.checkout === "Dec 24, 2026" && pd.price === "5,760 MXN" && pd.url === pc.url && quoteCalls(T.api).length === 0, { e: [e.start, e.end], p: [pd.checkout, pd.price, pd.url] });
await T.page.keyboard.press("Escape"); e = await T.ed(); pd = await T.panel();
ok("2 Escape: editor closed, draft discarded, committed dates/price/URL intact, focus back on the Checkout field, scroll restored", !e.open && pd.checkin === "Dec 20, 2026" && pd.checkout === "Dec 24, 2026" && pd.price === "5,760 MXN" && pd.url === pc.url && pd.focus === "mvPanelCheckout" && !e.locked && !e.inert, { pd, e: [e.open, e.locked] });
await T.open("checkout"); e = await T.ed();
ok("2 reopen: draft re-seeded from the committed dates (Dec 20–24), not the discarded Dec 23", e.start === "2026-12-20" && e.end === "2026-12-24", e);
await T.clickDay("2026-12-22"); await T.page.click("#mvPdCalClose"); e = await T.ed(); pd = await T.panel();
ok("2 Close button discards the draft too; focus restored", !e.open && pd.checkout === "Dec 24, 2026" && pd.focus === "mvPanelCheckout", { p: pd.checkout, f: pd.focus });
await T.open("checkin"); await T.clickDay("2026-12-21"); await T.page.mouse.click(5, 5); e = await T.ed(); pd = await T.panel();
ok("2 backdrop click cancels; focus back on Check-in", !e.open && pd.checkin === "Dec 20, 2026" && pd.focus === "mvPanelCheckin", { p: pd.checkin, f: pd.focus });
ok("2 cancel paths never requested a quote", quoteCalls(T.api).length === 0, T.api);
// edit check-in only, then Apply
await T.open("checkin"); e = await T.ed();
ok("2 open from Check-in: check-in edit mode preselected", same(e.selBtns, [["Change check-in", "true"], ["Change check-out", "false"]]), e.selBtns);
await T.clickDay("2026-12-21"); e = await T.ed();
ok("2 Dec 21 in check-in mode → Dec 21–24 (check-out kept)", e.start === "2026-12-21" && e.end === "2026-12-24" && e.apply === false, e);
const h1 = pd.hist; await T.apply(); pd = await T.panel();
ok("2 Apply check-in-only edit: Dec 21, 2026 / Dec 24, 2026; 4,800 → 4,320 (3 nights); URL replaced; history unchanged; focus on Check-in", pd.checkin === "Dec 21, 2026" && pd.checkout === "Dec 24, 2026" && pd.price === "4,320 MXN" && pd.was === "4,800 MXN" && pd.url === "/property/603566?checkin=2026-12-21&checkout=2026-12-24&guests=2" && pd.hist === h1 && pd.focus === "mvPanelCheckin", pd);
// complete replacement across the year boundary (Dec 31 = reservation departure day = valid check-in)
await T.open("checkout"); await T.clickDay("2026-12-31"); e = await T.ed();
ok("2 check-out mode, Dec 31 → Dec 21–31 crosses the reservation: refused naming Dec 24, draft dropped, Apply disabled", /Dec 21 → Dec 31: That stay includes an unavailable night \(Dec 24\)/.test(e.selection) && e.start === null && e.apply === true, { sel: e.selection, s: e.start, en: e.end });
ok("2 an empty draft caused by a refusal is NOT a clear request: Apply stays 'Apply dates' and disabled", e.applyText === "Apply dates" && e.apply === true, { t: e.applyText, a: e.apply });
e = await T.ed(); ok("2 after the refusal the draft is already empty, so Clear is disabled (nothing to clear)", e.clear === true, e.clear);
await T.clickDay("2026-12-31"); await T.clickDay("2027-01-03"); e = await T.ed();
ok("2 then Dec 31 → Jan 3 2027 (year boundary, arrival on the block's departure day): verified, Apply enabled", e.start === "2026-12-31" && e.end === "2027-01-03" && e.apply === false && e.summary === "Dec 31 → Jan 3 · 3 nights", e);
await T.apply(); pd = await T.panel();
ok("2 Apply replacement: Dec 31, 2026 / Jan 3, 2027; 4,800 → 4,320; URL replaced", pd.checkin === "Dec 31, 2026" && pd.checkout === "Jan 3, 2027" && pd.price === "4,320 MXN" && pd.url === "/property/603566?checkin=2026-12-31&checkout=2027-01-03&guests=2", pd);
// Clear + Apply
await T.open("checkin"); await T.page.click("#mvPdCalClear"); e = await T.ed();
ok("2 Clear: draft empty, Apply reads 'Apply (clear dates)' and is enabled (committed dates exist), Clear disabled", e.start === null && e.end === null && e.applyText === "Apply (clear dates)" && e.apply === false && e.clear === true, e);
await T.clickDay("2027-01-05"); e = await T.ed();
ok("2 a new date choice after Clear supersedes the clear request (Apply back to 'Apply dates', disabled while incomplete)", e.start === "2027-01-05" && e.applyText === "Apply dates" && e.apply === true, { s: e.start, t: e.applyText, a: e.apply });
await T.page.click("#mvPdCalClear"); e = await T.ed();
ok("2 Clear again re-arms 'Apply (clear dates)'", e.applyText === "Apply (clear dates)" && e.apply === false, e.applyText);
T.api.length = 0; await T.apply(); pd = await T.panel();
ok("2 Apply (clear): panel back to 'Select dates to see price', fields 'Add date', URL keeps the property + guests only, no calendar/quote request", pd.state === "empty" && pd.checkin === "Add date" && pd.url === "/property/603566?guests=2" && T.api.length === 0 && same(pd.inputs, ["", "", "2"]), { pd, api: T.api });
await T.open("checkin"); e = await T.ed();
ok("2 after clearing: reopening shows no selection and Apply disabled (nothing to commit)", e.start === null && e.apply === true && e.clear === true, e);
await T.page.keyboard.press("Escape");
ok("2 no page errors", T.errors.length === 0, T.errors);
await T.done();

// ===== 3. Blocked / unconfirmed / limits =====
T = await make(); await T.go("/property/603566"); await T.open("checkin"); await T.goToMonth("December 2026");
await T.clickDay("2026-12-24"); e = await T.ed();
ok("3 blocked day as check-in → message, no selection, Apply disabled", /Dec 24 is not available for check-in/.test(e.selection) && e.start === null && e.apply === true, e.selection);
await T.clickDay("2026-12-23"); await T.clickDay("2026-12-25"); e = await T.ed();
ok("3 Dec 23 → Dec 25 crosses the reservation: refused with the night named, selection dropped, Apply disabled", /Dec 23 → Dec 25: That stay includes an unavailable night \(Dec 24\)/.test(e.selection) && e.start === null && e.apply === true, e.selection);
await T.clickDay("2026-12-20"); await T.clickDay("2026-12-24"); e = await T.ed();
ok("3 Dec 20 → Dec 24 (check-out on the reservation's arrival day) verified → Apply enabled", e.apply === false && e.end === "2026-12-24", e);
await T.clickDay("2026-12-24"); e = await T.ed();
ok("3 restarting on a blocked day (Dec 24) is refused: message, selection dropped, Apply disabled", /Dec 24 is not available for check-in/.test(e.selection) && e.start === null && e.apply === true, { s: e.selection, st: e.start });
await T.clickDay("2026-12-31"); e = await T.ed();
ok("3 Dec 31 (the reservation's departure day) then starts a new draft", e.start === "2026-12-31" && e.end === null, { st: e.start, en: e.end });
// month boundary
await T.goToMonth("November 2026"); await T.clickDay("2026-11-29"); await T.clickDay("2026-12-02"); e = await T.ed();
ok("3 month boundary Nov 29 → Dec 2 verified (3 nights)", e.start === "2026-11-29" && e.end === "2026-12-02" && e.summary === "Nov 29 → Dec 2 · 3 nights" && e.apply === false, e);
// 90 / 91 nights
await T.goToMonth("January 2027"); await T.clickDay("2027-01-05"); await T.goToMonth("March 2027"); await T.clickDay("2027-04-05"); e = await T.ed();
ok("3 Jan 5 → Apr 5 2027 (90 nights, maximum) verified (check-in cell is off-screen in the Mar/Apr view, so checked via the summary)", e.summary === "Jan 5 → Apr 5 · 90 nights" && e.end === "2027-04-05" && /occupied nights clear/.test(e.selection) && e.apply === false, e);
await T.goToMonth("January 2027"); await T.clickDay("2027-01-05"); await T.goToMonth("March 2027"); await T.clickDay("2027-04-06"); e = await T.ed(); // Jan 5 restarts the verified range
ok("3 Jan 5 → Apr 6 2027 (91 nights) refused: 'Stays longer than 90 nights', Apply disabled", /longer than 90 nights/.test(e.selection) && e.apply === true && e.start === null, e.selection);
// horizon
for (let i = 0; i < 14; i++) { if (await T.page.evaluate(() => document.getElementById("mvPdCalNext").disabled)) break; await T.page.evaluate(() => document.getElementById("mvPdCalNext").click()); await sl(30); }
await T.settleEditor(); e = await T.ed();
ok("3 Next stops at the 365-day horizon: Next disabled, days beyond the horizon are inert (not buttons)", e.next === true && e.far > 0 && same(e.farTags, ["DIV"]), { n: e.next, far: e.far, tags: e.farTags, t: e.titles });
for (let i = 0; i < 16; i++) { if (await T.page.evaluate(() => document.getElementById("mvPdCalPrev").disabled)) break; await T.page.evaluate(() => document.getElementById("mvPdCalPrev").click()); await sl(30); }
await T.settleEditor(); e = await T.ed();
ok("3 Prev stops at the current month", e.prev === true && e.titles[0] === "October 2026", e.titles);
ok("3 navigation and editing made calendar calls only (no quote)", quoteCalls(T.api).length === 0 && calCalls(T.api).length > 5, { q: quoteCalls(T.api).length, c: calCalls(T.api).length });
await T.page.keyboard.press("Escape"); await T.done();
// unconfirmed: view window 502, then stay window 502
let calStatus = 502;
T = await make({ hooks: { calendar: () => (calStatus ? { status: calStatus } : null) } }); await T.go("/property/603566"); await T.open("checkin"); e = await T.ed();
ok("3 calendar 502 on open: fail closed — status error + Retry, every day 'not confirmed', Apply disabled", /could not be confirmed/.test(e.status) && e.statusRetry && e.unknown > 0 && e.blocked.length === 0 && e.apply === true, { s: e.status, u: e.unknown });
await T.clickDay("2026-10-25"); e = await T.ed();
ok("3 clicking a not-confirmed day → the engine's 'not confirmed yet' message, nothing selected", /Oct 25 is not confirmed yet/.test(e.selection) && e.start === null && e.apply === true, e.selection);
calStatus = 0; await T.page.click("#mvPdCalStatus button"); await T.settleEditor(); e = await T.ed();
ok("3 Retry → live calendar", /Live calendar/.test(e.status) && e.unknown === 0, e.status);
await T.goToMonth("December 2026"); await T.clickDay("2026-12-20"); calStatus = 503; await T.clickDay("2026-12-24"); e = await T.ed();
ok("3 stay-window 503: 'could not be confirmed' + Retry in the selection line; Apply disabled (never assumes availability)", /could not be confirmed/.test(e.selection) && e.selBtns.some(([t]) => t === "Retry") && e.apply === true, { s: e.selection, b: e.selBtns });
calStatus = 0; await T.page.evaluate(() => [...document.querySelectorAll("#mvPdCalSelection button")].find((b) => b.textContent.trim() === "Retry").click()); await T.settleEditor(); e = await T.ed();
ok("3 Retry on the stay check → verified, Apply enabled", e.apply === false && /occupied nights clear/.test(e.selection), e.selection);
await T.page.keyboard.press("Escape"); await T.done();
T = await make({ hooks: { calendar: (p) => (p.from === "2026-12-20" ? { mutate: (b) => { b.coverage.complete = false; } } : null) } }); await T.go("/property/603566"); await T.open("checkin"); await T.goToMonth("December 2026"); await T.clickDay("2026-12-20"); await T.clickDay("2026-12-24"); e = await T.ed();
ok("3 incomplete stay-window coverage → unconfirmed night, selection dropped, Apply disabled", /could not be confirmed/.test(e.selection) && e.apply === true && e.start === null, e.selection);
await T.page.keyboard.press("Escape"); await T.done();

// ===== 4. Weekly / monthly after Apply; both pilots; capacity still server-side =====
T = await make(); await T.go("/property/603566"); await T.open("checkin"); await T.goToMonth("January 2027"); await T.clickDay("2027-01-05"); await T.clickDay("2027-01-12"); await T.apply(); pd = await T.panel();
ok("4 603566 weekly Jan 5 → 12: 10,080 → 9,072 with Accommodation / Weekly discount rows", pd.price === "9,072 MXN" && pd.was === "10,080 MXN" && same(pd.rows.slice(0, 2), [["Accommodation", "11,200 MXN"], ["Weekly discount", "−1,120 MXN"]]), pd);
await T.open("checkout"); await T.page.click("#mvPdCalClear"); await T.goToMonth("January 2027"); await T.clickDay("2027-01-05"); await T.clickDay("2027-02-04"); await T.apply(); pd = await T.panel();
ok("4 603566 monthly Jan 5 → Feb 4: 38,400 → 34,560", pd.price === "34,560 MXN" && pd.was === "38,400 MXN" && pd.url === "/property/603566?checkin=2027-01-05&checkout=2027-02-04&guests=2", pd);
await T.go("/property/603564"); await T.open("checkin"); await T.goToMonth("November 2026"); await T.clickDay("2026-11-01"); await T.clickDay("2026-12-01"); await T.apply(); pd = await T.panel();
ok("4 603564 monthly Nov 1 → Dec 1: 52,800 → 47,520", pd.price === "47,520 MXN" && pd.was === "52,800 MXN", pd);
await T.open("checkin"); await T.goToMonth("January 2027"); e = await T.ed();
ok("4 603564 editor shows its own block (Jan 7 → Mar 1 2027)", e.blocked[0] === "2027-01-07" && e.blocked.length > 20, e.blocked.slice(0, 3));
await T.clickDay("2027-01-04"); await T.clickDay("2027-01-07"); e = await T.ed();
ok("4 603564 Jan 4 → Jan 7 (check-out on the block's first night) verified", e.apply === false && e.end === "2027-01-07", e);
await T.clickDay("2027-01-06"); await T.clickDay("2027-01-08"); e = await T.ed();
ok("4 603564 Jan 6 → Jan 8 refused (Jan 7)", /\(Jan 7\)/.test(e.selection) && e.apply === true, e.selection);
await T.page.keyboard.press("Escape");
await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=3"); pd = await T.panel();
ok("4 guests 3 (display-only): panel refused by the server (capacity); editor still opens and shows Dec 20–24 as the draft", pd.state === "unavailable" && /sleeps up to 2/.test(pd.status) && await (async () => { await T.open("checkin"); const x = await T.ed(); await T.page.keyboard.press("Escape"); return x.start === "2026-12-20" && x.end === "2026-12-24"; })(), pd);
ok("4 no page errors", T.errors.length === 0, T.errors);
await T.done();

// ===== 5. Stale / closed-editor / property-switch races =====
T = await make({ hooks: { calendar: (p) => (p.from === "2026-12-20" && p.to === "2026-12-24" ? { delayMs: 1200 } : null) } });
await T.go("/property/603566"); await T.open("checkin"); await T.goToMonth("December 2026"); await T.clickDay("2026-12-20"); await T.page.click(T.day("2026-12-24"), { force: true }); await sl(150); e = await T.ed();
ok("5 stay check pending: 'checking availability…', Apply disabled", /checking availability/.test(e.selection) && e.apply === true, e.selection);
await T.page.keyboard.press("Escape"); await sl(1500); e = await T.ed(); pd = await T.panel();
ok("5 editor closed during the in-flight stay check: the late answer changes nothing (editor stays closed, no DOM, panel untouched)", !e.open && e.titles.length === 0 && pd.state === "empty" && pd.checkin === "Add date", { e: [e.open, e.titles], p: [pd.state, pd.checkin] });
await T.open("checkin"); e = await T.ed();
ok("5 reopen after the race: fresh empty draft at the current month", e.start === null && e.titles[0] === "October 2026", e);
await T.page.keyboard.press("Escape"); await T.done();
// late view-window answer after switching property while the editor is open
T = await make({ hooks: { calendar: (p) => (p.id === "603566" ? { delayMs: 1200 } : null) } });
await T.go("/property/603566"); await T.page.click("#mvPanelCheckin"); await T.page.waitForSelector("#mvPdCalMonths .mv-cal__month"); await sl(100);
await T.page.evaluate(() => { history.pushState({}, "", "/property/603564"); window.dispatchEvent(new PopStateEvent("popstate", { state: {} })); }); await T.settlePanel(); e = await T.ed();
ok("5 switching property while the editor is open closes it and releases the page", !e.open && !e.locked && !e.inert && (await T.page.evaluate(() => document.querySelector("#mvPropertyView h1").textContent)) === "Hacienda 5 De Mayo", e);
await sl(1500); e = await T.ed();
ok("5 the late 603566 window answer after the switch produced no editor DOM", !e.open && e.titles.length === 0, e.titles);
await T.open("checkin"); await T.goToMonth("January 2027"); e = await T.ed();
ok("5 editor on 603564 shows 603564's own availability (Jan 7 block), not 603566's", e.blocked[0] === "2027-01-07" && /Hacienda/.test(e.title), { b: e.blocked.slice(0, 2), t: e.title });
await T.page.keyboard.press("Escape"); await T.done();
// draft changed before a delayed stay answer: the first answer must not verify the second draft
T = await make({ hooks: { calendar: (p) => (p.from === "2026-12-20" && p.to === "2026-12-24" ? { delayMs: 1200 } : null) } });
await T.go("/property/603566"); await T.open("checkin"); await T.goToMonth("December 2026"); await T.clickDay("2026-12-20"); await T.page.click(T.day("2026-12-24"), { force: true }); await sl(100);
await T.clickDay("2026-12-21"); await T.clickDay("2026-12-23"); await sl(1400); e = await T.ed();
ok("5 late answer for Dec 20–24 ignored; Dec 21–23 verified by its own window", e.start === "2026-12-21" && e.end === "2026-12-23" && /occupied nights clear/.test(e.selection) && e.apply === false, e);
await T.page.keyboard.press("Escape"); await T.done();
// Apply, then leave to results before the delayed quote answers
T = await make({ hooks: { quote: () => ({ delayMs: 1200 }) } });
await T.go("/property/603566"); await T.open("checkin"); await T.goToMonth("December 2026"); await T.clickDay("2026-12-20"); await T.clickDay("2026-12-24"); await T.page.click("#mvPdCalApply"); await sl(200);
await T.page.click("#mvPropBack"); await T.page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden")); await sl(1500);
const hidden = await T.page.evaluate(() => ({ app: !document.getElementById("mv-app").classList.contains("mv-view-hidden"), price: document.getElementById("mvPanelPrice")?.textContent ?? null, url: location.pathname + location.search }));
ok("5 Apply then Back to results before the quote answers: results shown with the committed dates in the URL; the late quote does not price the hidden panel", hidden.app && hidden.price === null && hidden.url === "/?checkin=2026-12-20&checkout=2026-12-24&guests=2", hidden);
await T.done();

// ===== 6. Reload, Back/Forward, modal parity, duplicate ids =====
T = await make(); await T.go("/"); await T.page.evaluate(() => { for (const [id, v] of [["mvCheckin", "2026-12-20"], ["mvCheckout", "2026-12-24"]]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); } });
await T.page.click('.mv-card[data-apartment-id="603566"] .mv-card__title'); await T.page.waitForSelector("#mvHostawayCalendarMonths .mv-cal__month"); await T.page.waitForFunction(() => !/checking availability/.test(document.getElementById("mvHostawaySelection").innerText));
await T.page.click("#mvHostawayQuoteBtn"); await T.page.waitForFunction(() => /direct total/.test(document.getElementById("mvHostawayQuote").innerText));
const modalBefore = await T.page.evaluate(() => ({ q: document.getElementById("mvHostawayQuote").innerText.split("\n")[0], sel: document.getElementById("mvHostawaySelection").innerText.split("\n")[0], id: String(window.mvSelectedApartmentId) }));
await T.page.keyboard.press("Escape");
await T.page.evaluate(() => { history.pushState({ mvFrom: "search" }, "", "/property/603566"); window.dispatchEvent(new PopStateEvent("popstate", { state: { mvFrom: "search" } })); }); await T.settlePanel();
const histA = await T.page.evaluate(() => history.length);
await T.open("checkout"); e = await T.ed();
ok("6 editor open while the modal's calendar DOM still exists: no duplicate ids; both calendars present; modal's selected id untouched", e.dupIds.length === 0 && e.modalMonths && e.modalSelected === modalBefore.id, { d: e.dupIds, m: e.modalMonths, id: [e.modalSelected, modalBefore.id] });
await T.clickDay("2026-12-23"); await T.apply(); pd = await T.panel();
await T.open("checkin"); await T.clickDay("2026-12-21"); await T.apply(); pd = await T.panel();
ok("6 two applies: Dec 21 → Dec 23 priced (2 nights 3,200 → 2,880); history length unchanged by both (replaceState)", pd.checkin === "Dec 21, 2026" && pd.checkout === "Dec 23, 2026" && pd.price === "2,880 MXN" && pd.hist === histA, pd);
await T.page.reload(); await T.page.waitForSelector("#mvPanel"); await T.settlePanel(); pd = await T.panel();
ok("6 reload reproduces the last applied dates and re-validates (fresh calendar + quote): Dec 21–23, 2,880", pd.checkin === "Dec 21, 2026" && pd.price === "2,880 MXN" && pd.url === "/property/603566?checkin=2026-12-21&checkout=2026-12-23&guests=2", pd);
await T.page.goBack(); await T.page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden")); const back = await T.page.evaluate(() => ({ app: !document.getElementById("mv-app").classList.contains("mv-view-hidden"), url: location.pathname + location.search, ci: document.getElementById("mvCheckin").value }));
ok("6 browser Back returns to the previous page (the search page at /), not to an intermediate date state", back.app && back.url === "/", back);
await T.page.goForward(); await T.page.waitForSelector("#mvPanel"); await T.settlePanel(); pd = await T.panel();
ok("6 Forward returns to the property with the last applied dates", pd.checkin === "Dec 21, 2026" && pd.checkout === "Dec 23, 2026", pd);
await T.open("checkin"); await T.page.goBack(); await T.page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden")); e = await T.ed();
ok("6 Back with the editor open closes it and releases scroll/inert", !e.open && !e.locked && !e.inert, e);
// original modal still works, independent of the editor's past drafts
await T.page.click('.mv-card[data-apartment-id="603566"] .mv-card__title'); await T.page.waitForSelector("#mvHostawayCalendarMonths .mv-cal__month"); await T.page.waitForFunction(() => !/checking availability/.test(document.getElementById("mvHostawaySelection").innerText));
await T.page.click("#mvHostawayQuoteBtn"); await T.page.waitForFunction(() => /direct total|could not/.test(document.getElementById("mvHostawayQuote").innerText));
const modalAfter = await T.page.evaluate(() => ({ q: document.getElementById("mvHostawayQuote").innerText.split("\n")[0], sel: document.getElementById("mvHostawaySelection").innerText.split("\n")[0], pill: document.getElementById("mvModalDatesPill").textContent }));
ok("6 search modal after editor use: seeded from the committed search dates (Dec 21 → Dec 23) and quotes 2,880 — N2 behaviour intact", /Dec 21 → Dec 23/.test(modalAfter.sel) && /^2,880 MXN estimated direct total/.test(modalAfter.q) && modalBefore.q.startsWith("5,760"), { before: modalBefore, after: modalAfter });
ok("6 no page errors", T.errors.length === 0, T.errors);
await T.done();

// ===== 7. Mobile 390 / 320 =====
for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
  T = await make({ vp }); await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2"); await T.open("checkout"); e = await T.ed();
  ok(`7 ${vp.width}px: editor fits the viewport, months stacked, scroll locked, no page overflow`, e.open && e.panelRect.w <= vp.width && e.panelRect.r <= vp.width && e.stacked === true && e.locked && !e.overflow, { r: e.panelRect, st: e.stacked, o: e.overflow });
  ok(`7 ${vp.width}px: Clear and Apply visible inside the viewport (sticky footer)`, e.applyRect && e.applyRect.b <= vp.height && e.applyRect.y >= 0 && e.footerRect.r <= vp.width, { a: e.applyRect, f: e.footerRect, vh: vp.height });
  if (SHOTS) await T.page.screenshot({ path: `${SHOTS}/ux4b-m${vp.width}-editor.png` });
  await T.clickDay("2026-12-22"); e = await T.ed();
  ok(`7 ${vp.width}px: editing works (Dec 20 → 22)`, e.start === "2026-12-20" && e.end === "2026-12-22" && e.apply === false, e);
  await T.apply(); pd = await T.panel(); e = await T.ed();
  ok(`7 ${vp.width}px: Apply completes on the property page (no return to search): Dec 22 checkout, 3,200 → 2,880, scroll restored`, pd.checkout === "Dec 22, 2026" && pd.price === "2,880 MXN" && !e.locked && pd.url.startsWith("/property/603566"), { pd, l: e.locked });
  await T.done();
}

// ===== 8. Keyboard =====
T = await make(); await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2");
await T.page.focus("#mvPanelCheckin"); await T.page.keyboard.press("Enter"); await T.page.waitForSelector("#mvPdCalMonths .mv-cal__month"); await T.settleEditor(); e = await T.ed();
ok("8 Enter on the Check-in field opens the editor with focus on Close", e.open && e.focus === "mvPdCalClose", e.focus);
await T.page.keyboard.press("PageDown"); await T.settleEditor(); e = await T.ed();
ok("8 PageDown navigates to the next months (Jan/Feb)", same(e.titles, ["January 2027", "February 2027"]), e.titles);
await T.page.keyboard.press("PageUp"); await T.settleEditor(); e = await T.ed();
ok("8 PageUp back to Dec/Jan", e.titles[0] === "December 2026", e.titles);
const seq = []; for (let i = 0; i < 4; i++) { await T.page.keyboard.press("Tab"); seq.push(await T.page.evaluate(() => document.activeElement.id || document.activeElement.className)); }
ok("8 Tab moves through the dialog's controls (Prev, Next, day buttons…) and never leaves it", seq[0] === "mvPdCalPrev" && seq[1] === "mvPdCalNext" && await T.page.evaluate(() => document.getElementById("mvPdCalPanel").contains(document.activeElement)), seq);
await T.page.focus("#mvPdCalApply"); await T.page.keyboard.press("Tab"); const wrapped = await T.page.evaluate(() => document.activeElement.id);
ok("8 Tab from the last control wraps to Close (focus trap)", wrapped === "mvPdCalClose", wrapped);
await T.page.keyboard.press("Shift+Tab"); ok("8 Shift+Tab from Close wraps to the last control", (await T.page.evaluate(() => document.activeElement.id)) === "mvPdCalApply");
await T.page.focus(T.day("2026-12-21")); await T.page.keyboard.press("Enter"); await T.settleEditor(); e = await T.ed();
ok("8 Enter on a day button selects it (check-in mode → Dec 21 → 24)", e.start === "2026-12-21" && e.end === "2026-12-24", e);
await T.page.focus("#mvPdCalApply"); await T.page.keyboard.press("Enter"); await T.settlePanel(); pd = await T.panel();
ok("8 Enter on Apply commits and returns focus to the Check-in field", pd.checkin === "Dec 21, 2026" && pd.focus === "mvPanelCheckin", { c: pd.checkin, f: pd.focus });
ok("8 keyboard flow: no quote during navigation/editing; exactly one quote after Apply", same(quoteCalls(T.api), ["quote?id=603566&from=2026-12-20&to=2026-12-24&guests=2", "quote?id=603566&from=2026-12-21&to=2026-12-24&guests=2"]), quoteCalls(T.api));
ok("8 network: GET only; proxy listings/calendar/quote only; no write/hold/payment paths; nothing else contacted", T.methods.every((m) => m === "GET") && T.api.every((a) => /^(listings|calendar\?|quote\?)/.test(a)) && !T.api.some((a) => /hold|reserv|checkout|pay|stripe|smoobu/i.test(a)) && T.other.length === 0, { other: T.other, m: [...new Set(T.methods)] });
ok("8 no page errors", T.errors.length === 0, T.errors);
await T.done();

await browser.close(); server.close();
const names = Object.keys(results), pass = names.filter((n) => results[n] === "PASS").length;
console.log(JSON.stringify(results, null, 1)); console.log(`\n${pass}/${names.length} passed`); process.exit(failed ? 1 : 0);
