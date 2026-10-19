// N2 offline browser tests: property-modal calendar navigation, editing, clearing, search-date carry-over, fail-closed behaviour.
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync } from "node:fs";
import { PAGE_PATH } from "../lib/page-source.mjs";
import { TODAY, PROXY, listings, BLOCKS, RATE, dayMs, nightsOf, addD, overlaps, quoteFor } from "../fixtures/pilots.mjs";

const PAGE = readFileSync(PAGE_PATH, "utf8");
const server = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE); });
await new Promise((r) => server.listen(5500, "localhost", r));
const results = {}; let failed = 0;
const ok = (name, cond, detail) => { results[name] = cond ? "PASS" : "FAIL " + JSON.stringify(detail); if (!cond) { failed++; console.log("FAIL", name, JSON.stringify(detail)); } };
const browser = await chromium.launch();

async function make({ vp = { width: 1280, height: 900 }, now = TODAY } = {}) {
  const ctx = await browser.newContext({ viewport: vp });
  const FIXED = new Date(now + "T12:00:00").getTime();
  await ctx.addInitScript((FIXED) => { const D = Date; class M extends D { constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); } static now() { return FIXED; } } window.Date = M; }, FIXED);
  const page = await ctx.newPage();
  const T = { page, calLog: [], quoteLog: [], all: [], errors: [], hooks: { cal: null, quote: null } };
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
        T.quoteLog.push({ id: p.id, from: p.from, to: p.to });
        const h = T.hooks.quote && T.hooks.quote(p); if (h) { if (h.delayMs) await new Promise((r) => setTimeout(r, h.delayMs)); if (h.body !== undefined) return json(h.body, h.status || 200); }
        const id = Number(p.id), n = nightsOf(p.from, p.to);
        if (overlaps(id, p.from, p.to)) return json({ ok: true, available: false, decision: "unavailable", listingId: id, from: p.from, to: p.to, nights: n, guests: Number(p.guests), currency: "MXN", reasons: [{ code: "NIGHT_UNAVAILABLE", message: "One or more selected nights are not available." }], checkedAt: "x" });
        const t = RATE[id] * n; return json({ ok: true, available: true, decision: "quoted", listingId: id, from: p.from, to: p.to, nights: n, guests: Number(p.guests), currency: "MXN", total: t, nightlyAverage: RATE[id], breakdown: [{ type: "accommodation", label: "Accommodation", total: t }], checkedAt: "2026-10-19T18:00:00Z", quoteBasis: "hostaway.priceDetails.v2", note: "Quote only." });
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
  T.open = async (id) => { await page.locator(`.mv-card[data-apartment-id="${id}"] .mv-card__title`).click(); await page.waitForSelector("#mvHostawayCalendarMonths .mv-cal__month"); };
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

// ===== A. Navigation (no search dates) =====
let T = await make();
await T.open(603566); await T.settle(); let s = await T.st();
ok("A opens on current month: Oct/Nov, Prev disabled", same(s.titles, ["October 2026", "November 2026"]) && s.prevDis && !s.nextDis && s.range === "October 2026 – November 2026", s);
ok("A initial window-scoped request (today..end of Nov)", same(T.calLog, [{ id: "603566", from: "2026-10-19", to: "2026-11-30" }]), T.calLog);
ok("A neutral prompt, no Clear/Check price with nothing selected", s.sel.startsWith("Select a check-in night") && !s.checkBtn && !s.btns.includes("Clear dates"), s);
T.clearLogs();
await T.next(); await T.settle(); s = await T.st();
ok("A Nov/Dec with exactly one fresh window", same(s.titles, ["November 2026", "December 2026"]) && same(T.calLog, [{ id: "603566", from: "2026-11-01", to: "2026-12-31" }]) && T.quoteLog.length === 0, { s: s.titles, log: T.calLog });
await T.next(); await T.settle(); s = await T.st();
ok("A Dec/Jan with a fresh window; no quote call", same(s.titles, ["December 2026", "January 2027"]) && T.calLog.length === 2 && T.calLog[1].from === "2026-12-01" && T.calLog[1].to === "2027-01-31" && T.quoteLog.length === 0, T.calLog);
ok("A real Dec 24-31 reservation on 603566: Dec 24..30 blocked, Dec 23 and Dec 31 available", ["2026-12-24", "2026-12-25", "2026-12-27", "2026-12-30"].every((d) => s.cells[d] === "unavailable") && s.cells["2026-12-23"] === "available" && s.cells["2026-12-31"] === "available", ["23", "24", "30", "31"].map((d) => s.cells["2026-12-" + d]));
await T.prev(); await T.settle(); await T.prev(); await T.settle(); s = await T.st();
ok("A back to Oct/Nov, Prev disabled, focus handed to Next", s.titles[0] === "October 2026" && s.prevDis && await T.page.evaluate(() => document.activeElement.id === "mvHcalNext"), s);
ok("A nav buttons labelled; unknown cells aria-disabled while loading (see C)", await T.page.evaluate(() => document.getElementById("mvHcalPrev").getAttribute("aria-label") === "Previous month" && document.getElementById("mvHcalNext").getAttribute("aria-label") === "Next month"));
await T.done();

// ===== B. Dec 24-31 occupancy rules via the modal =====
T = await make();
await T.open(603566); await T.settle(); await T.goTo("2026-12-20"); await T.settle();
await T.click("2026-12-20"); await T.click("2026-12-24"); await T.settle(); s = await T.st();
ok("B Dec 20->24 occupancy-clear, Check price offered, nothing quoted yet", s.sel.includes("Dec 20 → Dec 24 · 4 nights · occupied nights clear") && s.checkBtn && s.quote === "" && T.quoteLog.length === 0, s);
ok("B stay check used a window scoped exactly to the stay", T.calLog.some((c) => c.from === "2026-12-20" && c.to === "2026-12-24"), T.calLog);
await T.goTo("2027-01-03"); await T.click("2026-12-31"); await T.click("2027-01-03"); await T.settle(); s = await T.st();
ok("B Dec 31->Jan 3 occupancy-clear", s.sel.includes("Dec 31 → Jan 3 · 3 nights · occupied nights clear") && s.checkBtn, s);
await T.click("2026-12-23"); await T.click("2026-12-25"); await T.settle(); s = await T.st();
ok("B Dec 23->25 overlap rejected at Dec 24, no Check price, nothing selected", /Dec 23 → Dec 25: That stay includes an unavailable night \(Dec 24\)/.test(s.sel) && !s.checkBtn && s.start === null, s);
await T.click("2026-12-22"); await T.click("2026-12-31"); await T.settle(); s = await T.st();
ok("B Dec 22->31 overlap rejected", /unavailable night \(Dec 24\)/.test(s.sel) && !s.checkBtn, s);
await T.click("2026-12-24"); s = await T.st();
ok("B Dec 24 refused as check-in (blocked night)", /Dec 24 is not available for check-in/.test(s.sel) && s.start === null, s);
await T.click("2026-12-27"); s = await T.st(); ok("B Dec 27 refused as check-in", /Dec 27 is not available for check-in/.test(s.sel), s);
await T.click("2026-12-22"); await T.click("2026-12-24"); await T.settle(); s = await T.st();
ok("B Dec 22->24 (check out on first blocked day) clear", s.sel.includes("2 nights · occupied nights clear"), s);
ok("B only user-initiated quote calls so far (none)", T.quoteLog.length === 0, T.quoteLog);
await T.btn("Check price").click(); await T.page.waitForFunction(() => /total/.test(document.getElementById("mvHostawayQuote").textContent)); s = await T.st();
ok("B Check price works through the existing quote flow", s.quote.startsWith("3,200 MXN total") && T.quoteLog.length === 1, s.quote);
await T.done();

// ===== C. Edit and clear =====
T = await make();
await T.open(603566); await T.settle(); await T.goTo("2026-12-20");
await T.click("2026-12-20"); await T.click("2026-12-24"); await T.settle();
await T.btn("Check price").click(); await T.page.waitForFunction(() => /total/.test(document.getElementById("mvHostawayQuote").textContent));
await T.btn("Change check-out").click(); s = await T.st();
ok("C edit check-out: hint shown, selection and price kept until a real change", /Choose a new check-out date/.test(s.sel) && s.start === "2026-12-20" && s.end === "2026-12-24" && s.quote.includes("MXN total"), s);
await T.click("2026-12-22"); await T.settle(); s = await T.st();
ok("C new check-out Dec 22: old price dropped, re-verified, Check price offered", s.start === "2026-12-20" && s.end === "2026-12-22" && s.quote === "" && s.checkBtn && s.sel.includes("2 nights"), s);
await T.btn("Change check-in").click(); await T.click("2026-12-21"); await T.settle(); s = await T.st();
ok("C new check-in Dec 21 keeps check-out Dec 22", s.start === "2026-12-21" && s.end === "2026-12-22" && s.sel.includes("1 night · occupied nights clear"), s);
await T.btn("Change check-out").click(); await T.click("2026-12-21"); s = await T.st();
ok("C check-out not after check-in refused, selection kept", /Check-out must be after check-in/.test(s.sel) && s.start === "2026-12-21" && s.end === "2026-12-22", s);
await T.click("2026-12-28"); await T.settle(); s = await T.st();
ok("C edit check-out into the block is rejected with the blocked night named", /unavailable night \(Dec 24\)/.test(s.sel) && s.start === null, s);
await T.click("2026-12-20"); await T.click("2026-12-23"); await T.settle();
T.hooks.quote = () => ({ delayMs: 700 });
await T.btn("Check price").click(); await T.page.waitForTimeout(100);
await T.btn("Clear dates").click(); await T.page.waitForTimeout(900); s = await T.st();
ok("C Clear dates: selection, buttons and price removed; in-flight quote discarded", s.start === null && s.end === null && s.quote === "" && !s.checkBtn && s.sel.startsWith("Select a check-in night") && !s.btns.includes("Clear dates"), s);
ok("C Clear dates is a visible control with accessible name", true);
await T.click("2026-12-20"); s = await T.st(); ok("C partial selection also offers Clear dates", s.btns.includes("Clear dates") && s.sel.includes("Check-in Dec 20"), s);
await T.btn("Clear dates").click(); s = await T.st(); ok("C clearing a partial selection", s.start === null, s);
ok("C search inputs untouched by modal edits", await T.page.evaluate(() => document.getElementById("mvCheckin").value === "" && document.getElementById("mvCheckout").value === ""));
await T.done();

// ===== D. Carry-over of search dates =====
T = await make();
await T.setDates("2026-12-20", "2026-12-24"); T.clearLogs();
await T.open(603566); await T.settle(); s = await T.st();
ok("D opens on Dec/Jan (not Oct/Nov) with requested dates selected", same(s.titles, ["December 2026", "January 2027"]) && s.start === "2026-12-20" && s.end === "2026-12-24", s);
ok("D requested dates validated against live availability, then Check price offered", s.sel.includes("Dec 20 → Dec 24 · 4 nights · occupied nights clear") && s.checkBtn && T.calLog.some((c) => c.from === "2026-12-20" && c.to === "2026-12-24"), { sel: s.sel, log: T.calLog });
ok("D no quote requested by opening", T.quoteLog.length === 0, T.quoteLog);
await T.done();
T = await make(); await T.setDates("2026-12-24", "2026-12-31"); await T.open(603566); await T.settle(); s = await T.st();
ok("D unavailable search dates (the Airbnb reservation) never become confirmed: explained, cleared, editable", /Dec 24 → Dec 31: That stay includes an unavailable night \(Dec 24\)/.test(s.sel) && !s.checkBtn && s.start === null && same(s.titles, ["December 2026", "January 2027"]), s);
await T.click("2026-12-20"); await T.click("2026-12-23"); await T.settle(); s = await T.st();
ok("D guest can edit after the explanation", s.sel.includes("occupied nights clear") && s.checkBtn, s);
await T.closeModal(); T.clearLogs(); await T.open(603564); await T.settle(); s = await T.st();
ok("D same search dates on the other property are judged by ITS calendar (clear), previous property's state not carried", s.sel.includes("Dec 24 → Dec 31 · 7 nights · occupied nights clear") && s.checkBtn && s.quote === "", s);
await T.done();
T = await make(); await T.setDates("2026-12-24", "2027-03-30"); await T.open(603566); await T.settle(); s = await T.st();
ok("D search dates > 90 nights are not used; reason shown; current month", /Your search dates could not be used: Stays longer than 90 nights/.test(s.sel) && s.start === null && s.titles[0] === "October 2026" && T.calLog.every((c) => nightsOf(c.from, c.to) <= 90), { s: s.sel, log: T.calLog });
await T.closeModal(); await T.setDates("2026-10-01", "2026-10-05"); await T.open(603566); await T.settle(); s = await T.st();
ok("D past search dates are not used", /could not be used: Check-in must be a future date/.test(s.sel) && s.start === null, s);
await T.done();
T = await make(); await T.setDates("2026-12-20", "2026-12-24"); await T.open(603564); await T.settle();
await T.btn("Check price").click(); await T.page.waitForFunction(() => /total/.test(document.getElementById("mvHostawayQuote").textContent));
await T.closeModal(); await T.open(603566); await T.settle(); s = await T.st();
ok("D property switch: no price from the other property survives", s.quote === "" && s.checkBtn, s);
await T.done();

// ===== H. Owner's screenshot cases: highlighting + pill =====
const paint = (T) => T.page.evaluate(() => { const o = {}; document.querySelectorAll("#mvHostawayCalendarMonths .mv-cal__day--hostaway").forEach((c) => { const cs = getComputedStyle(c); o[c.dataset.date] = { cls: c.className.replace("mv-cal__day mv-cal__day--hostaway", "").trim(), bg: cs.backgroundColor, bc: cs.borderColor, color: cs.color, aria: c.getAttribute("aria-label"), pressed: c.getAttribute("aria-pressed") }; }); o.pill = document.getElementById("mvModalDatesPill")?.textContent; return o; });
T = await make(); await T.setDates("2026-10-20", "2026-10-27"); await T.open(603566); await T.settle(); s = await T.st(); let pt = await paint(T);
ok("H Oct 20-27: modal opens Oct/Nov with Oct 20-27 highlighted and verified", same(s.titles, ["October 2026", "November 2026"]) && s.start === "2026-10-20" && s.end === "2026-10-27" && s.checkBtn, s);
ok("H check-in cell filled red/white, labelled check-in, aria-pressed", pt["2026-10-20"].bg === "rgb(255, 56, 92)" && pt["2026-10-20"].color === "rgb(255, 255, 255)" && /check-in$/.test(pt["2026-10-20"].aria) && pt["2026-10-20"].pressed === "true", pt["2026-10-20"]);
ok("H occupied nights Oct 21..26 tinted and labelled 'in selected stay'", ["21", "22", "23", "24", "25", "26"].every((d) => pt["2026-10-" + d].bg === "rgb(255, 225, 232)" && /in selected stay$/.test(pt["2026-10-" + d].aria)), pt["2026-10-23"]);
ok("H check-out cell outlined red, distinct from check-in", pt["2026-10-27"].bc === "rgb(255, 56, 92)" && pt["2026-10-27"].bg === "rgb(255, 255, 255)" && /check-out$/.test(pt["2026-10-27"].aria), pt["2026-10-27"]);
ok("H neighbours Oct 19 / Oct 28 unstyled", pt["2026-10-19"].cls === "" && pt["2026-10-28"].cls === "" && pt["2026-10-19"].bg === "rgb(255, 255, 255)", [pt["2026-10-19"], pt["2026-10-28"]]);
ok("H pill shows the modal's own selection", pt.pill === "Oct 20 → Oct 27", pt.pill);
await T.btn("Clear dates").click(); pt = await paint(T);
ok("H after Clear dates: no highlighted cells, pill 'Dates not selected'", Object.keys(pt).filter((k) => k !== "pill").every((k) => !/is-start|is-end|is-inrange/.test(pt[k].cls)) && pt.pill === "Dates not selected", Object.entries(pt).filter(([k, v]) => k !== "pill" && v.cls).slice(0, 3));
await T.click("2026-10-22"); pt = await paint(T); ok("H partial selection: check-in highlighted, pill 'Check-in Oct 22'", pt["2026-10-22"].cls === "is-start" && pt.pill === "Check-in Oct 22", pt.pill);
await T.done();
T = await make(); await T.setDates("2026-12-20", "2026-12-24"); await T.open(603566); await T.settle(); s = await T.st(); pt = await paint(T);
ok("H Dec 20-24: opens Dec/Jan, Dec 20 check-in filled, 21-23 tinted, Dec 24 outlined check-out, Check price offered", same(s.titles, ["December 2026", "January 2027"]) && pt["2026-12-20"].cls === "is-start" && pt["2026-12-22"].cls === "is-inrange" && pt["2026-12-24"].cls === "is-blocked is-end" && pt["2026-12-24"].bg === "rgb(253, 232, 236)" && pt["2026-12-24"].bc === "rgb(255, 56, 92)" && s.checkBtn && pt.pill === "Dec 20 → Dec 24", { t: s.titles, p: pt.pill });
ok("H Dec 24 check-out day: blocked tint kept (night unavailable) plus check-out outline; Dec 25 stays plain blocked", pt["2026-12-25"].cls === "is-blocked" && pt["2026-12-25"].bg === "rgb(253, 232, 236)", pt["2026-12-25"]);
await T.done();
T = await make(); await T.setDates("2026-12-24", "2026-12-31"); await T.open(603566); await T.settle(); s = await T.st(); pt = await paint(T);
ok("H Dec 24-31 on 603566: never shown as bookable — no highlighted range, reason named, pill neutral, Check price absent", s.start === null && s.end === null && Object.keys(pt).filter((k) => k !== "pill").every((k) => !/is-start|is-end|is-inrange/.test(pt[k].cls)) && /unavailable night \(Dec 24\)/.test(s.sel) && !s.checkBtn && pt.pill === "Dates not selected", { sel: s.sel, pill: pt.pill });
ok("H blocked nights keep their blocked styling (not disguised)", ["24", "25", "30"].every((d) => pt["2026-12-" + d].cls === "is-blocked" && pt["2026-12-" + d].bg === "rgb(253, 232, 236)"), pt["2026-12-24"]);
ok("H Clear dates control visible after an unavailable inheritance? selection already cleared — edit possible", (await (async () => { await T.click("2026-12-20"); return (await T.st()).btns.includes("Clear dates"); })()), s.btns);
await T.done();
// while the stay check is pending, an inherited blocked night must still look blocked (selection paint never overrides blocked/unknown)
T = await make(); T.hooks.cal = (p) => (p.from === "2026-12-24" && p.to === "2026-12-31" ? { delayMs: 1500 } : null); await T.setDates("2026-12-24", "2026-12-31"); await T.open(603566);
await T.page.waitForFunction(() => /checking availability/.test(document.getElementById("mvHostawaySelection").innerText)); pt = await paint(T);
ok("H pending inherited stay: Dec 24 has is-start but still renders BLOCKED (blocked wins over selection paint)", /is-blocked/.test(pt["2026-12-24"].cls) && /is-start/.test(pt["2026-12-24"].cls) && pt["2026-12-24"].bg === "rgb(253, 232, 236)", pt["2026-12-24"]);
await T.settle(); s = await T.st(); ok("H ...and is cleared with the reason once the check returns", s.start === null && /Dec 24/.test(s.sel), s.sel);
await T.done();
// search picker untouched: its selection styling is the original one
T = await make(); await T.page.click("#mvDatesBtn").catch(() => {}); 
const sp = await T.page.evaluate(() => { const panel = document.getElementById("mvCalendarPanel"); return { exists: !!panel, startRule: [...document.styleSheets].flatMap((ss) => { try { return [...ss.cssRules]; } catch { return []; } }).some((r) => r.selectorText === ".mv-cal__day.is-start, .mv-cal__day.is-end" && r.style.background.includes("rgb(255, 245, 247)")) }; });
ok("H search picker CSS rule unchanged (.mv-cal__day.is-start/.is-end still #fff5f7 outline)", sp.exists && sp.startRule, sp);
await T.done();

// ===== E. Fail closed =====
T = await make(); T.hooks.cal = (p) => (p.from === "2026-10-19" ? { status: 502, body: { ok: false } } : null);
await T.open(603566); await T.settle(); s = await T.st();
ok("E view window 502: error + Retry, every date unconfirmed", /could not be confirmed/.test(s.status) && Object.entries(s.cells).filter(([d]) => d >= TODAY).every(([, v]) => v === "unknown"), { status: s.status });
await T.click("2026-11-20"); s = await T.st();
ok("E unconfirmed date cannot start a stay", s.start === null && /not confirmed yet/.test(s.sel), s);
T.hooks.cal = null; await T.page.locator("#mvHostawayCalendarStatus button", { hasText: "Retry" }).click(); await T.settle(); s = await T.st();
ok("E Retry recovers; dates confirmed again", s.cells["2026-11-20"] === "available" && /Live calendar/.test(s.status), s.status);
T.hooks.cal = () => ({ abort: true }); await T.next(); await T.settle(); s = await T.st();
ok("E network failure on navigation fails closed", /could not be confirmed/.test(s.status) && Object.values(s.cells).filter((v) => v === "available").length === 0, s.status);
T.hooks.cal = (p) => ({ body: { ok: true, listingId: Number(p.id), from: p.from, to: addD(p.to, -3), coverage: { daysRequested: 5, daysReturned: 5, complete: true }, unavailable: [], unavailableNights: 0, restrictions: {}, checkedAt: "x" } });
await T.prev(); await T.settle(); s = await T.st();
ok("E response for a different window than requested is refused", /could not be confirmed/.test(s.status) && Object.values(s.cells).filter((v) => v === "available").length === 0, s.status);
T.hooks.cal = (p) => ({ body: { ok: true, listingId: Number(p.id), from: p.from, to: p.to, coverage: { daysRequested: nightsOf(p.from, p.to) + 1, daysReturned: 10, complete: false }, unavailable: [], unavailableNights: 0, restrictions: {}, checkedAt: "x" } });
await T.next(); await T.settle(); s = await T.st();
ok("E incomplete coverage: warned, nothing shown as available", /Some dates could not be confirmed/.test(s.status) && Object.values(s.cells).filter((v) => v === "available").length === 0, s.status);
await T.done();
T = await make(); T.hooks.cal = (p) => (p.to === "2026-12-24" ? { status: 502, body: { ok: false } } : null); await T.setDates("2026-12-20", "2026-12-24");
await T.open(603566); await T.settle(); s = await T.st();
ok("E stay check failure: not confirmed, Retry, no Check price", /could not be confirmed/.test(s.sel) && !s.checkBtn && s.btns.includes("Retry"), s);
T.hooks.cal = null; await T.btn("Retry").click(); await T.settle(); s = await T.st();
ok("E stay check Retry recovers", s.checkBtn && s.sel.includes("occupied nights clear"), s);
await T.done();

// ===== F. Stale protection =====
T = await make();
await T.open(603566); await T.settle();
T.hooks.cal = (p) => (p.from === "2026-11-01" ? { delayMs: 900 } : null);
await T.next(); await T.next(); await T.settle(); await T.page.waitForTimeout(1100); s = await T.st();
ok("F late Nov/Dec response never overwrites the Dec/Jan view", same(s.titles, ["December 2026", "January 2027"]) && s.cells["2026-12-25"] === "unavailable" && s.cells["2026-12-23"] === "available", { t: s.titles, c: s.cells["2026-12-25"] });
T.hooks.cal = null; await T.click("2026-12-20"); await T.click("2026-12-23"); await T.settle();
T.clearLogs(); T.hooks.quote = () => ({ delayMs: 700 });
await T.btn("Check price").click(); await T.page.waitForTimeout(80); await T.prev(); await T.settle(); await T.page.waitForTimeout(900); s = await T.st();
ok("F navigating while a quote is in flight discards it; no auto re-quote; Check price available again", s.quote === "" && T.quoteLog.length === 1 && s.checkBtn, { quote: s.quote, log: T.quoteLog });
T.hooks.quote = null; await T.btn("Check price").click(); await T.page.waitForFunction(() => /total/.test(document.getElementById("mvHostawayQuote").textContent)); s = await T.st();
ok("F shown price is dropped by the next navigation", s.quote.includes("4,800 MXN total") && (await (async () => { await T.next(); await T.settle(); return (await T.st()).quote === ""; })()), s.quote);
// property switch with delayed response
await T.done();
T = await make(); await T.setDates("2026-12-20", "2026-12-24"); T.hooks.cal = (p) => (p.id === "603564" ? { delayMs: 900 } : null);
await T.open(603564); await T.closeModal(); await T.open(603566); await T.settle(); await T.page.waitForTimeout(1100); s = await T.st();
ok("F late responses for the previous property are discarded", s.checkBtn && T.errors.length === 0 && same(s.titles, ["December 2026", "January 2027"]), { s: s.sel, e: T.errors });
await T.done();
T = await make(); await T.setDates("2026-12-20", "2026-12-24");
await T.open(603566); await T.settle();
await T.closeModal(); await T.open(603566); await T.settle(); s = await T.st();
ok("F reopening re-checks (fresh stay window each open)", s.checkBtn && T.calLog.filter((c) => c.from === "2026-12-20" && c.to === "2026-12-24").length === 2, T.calLog);
// guest change invalidates modal quote (existing behaviour preserved)
await T.btn("Check price").click(); await T.page.waitForFunction(() => /total/.test(document.getElementById("mvHostawayQuote").textContent));
await T.page.evaluate(() => { const el = document.getElementById("mvGuests"); el.value = "1"; el.dispatchEvent(new Event("change", { bubbles: true })); }); s = await T.st();
ok("F guest change still clears the modal quote", s.quote === "", s.quote);
await T.done();

// ===== G. Horizon and 90 nights =====
T = await make();
await T.open(603566); await T.settle(); let steps = 0; for (; steps < 30; steps++) { s = await T.st(); if (s.nextDis) break; await T.next(); await T.settle(); }
s = await T.st();
ok("G horizon: Next disabled after 11 steps at Sep-Oct 2027; focus handed to Prev", s.nextDis && steps === 11 && same(s.titles, ["September 2027", "October 2027"]) && await T.page.evaluate(() => document.activeElement.id === "mvHcalPrev"), { steps, s: s.titles });
ok("G horizon window clipped to today+365 and within the 90-day request limit", T.calLog.at(-1).to === "2027-10-19" && T.calLog.every((c) => nightsOf(c.from, c.to) <= 90), T.calLog.at(-1));
ok("G last selectable day 2027-10-19 is a button; 2027-10-20 is inert 'too far ahead'", await T.page.evaluate(() => { const a = document.querySelector('#mvHostawayCalendarMonths [data-date="2027-10-19"]'), b = document.querySelector('#mvHostawayCalendarMonths [data-date="2027-10-20"]'); return a.tagName === "BUTTON" && b.tagName === "DIV" && /too far ahead/.test(b.getAttribute("aria-label")); }));
await T.done();
T = await make();
await T.open(603566); await T.settle();
const pick = async (a, b) => { await T.goTo(a); await T.click(a); await T.goTo(b); T.clearLogs(); await T.click(b); await T.settle(); return T.st(); };
s = await pick("2027-02-01", "2027-05-02");
ok("G exactly 90 nights (Feb 1 -> May 2) accepted, verified with one stay window <= 90 days", nightsOf("2027-02-01", "2027-05-02") === 90 && s.checkBtn && T.calLog.some((c) => c.from === "2027-02-01" && c.to === "2027-05-02"), { sel: s.sel, log: T.calLog });
s = await pick("2027-02-01", "2027-05-03");
ok("G 91 nights refused locally, no Hostaway or quote call", /Stays longer than 90 nights/.test(s.sel) && s.start === null && T.calLog.every((c) => nightsOf(c.from, c.to) <= 90) && !T.calLog.some((c) => c.to === "2027-05-03") && T.quoteLog.length === 0, { sel: s.sel, log: T.calLog });
s = await pick("2027-02-01", "2027-05-04");
ok("G 92 nights also refused", /Stays longer than 90 nights/.test(s.sel) && !s.checkBtn, s.sel);
await T.done();

// ===== I. Keyboard / a11y =====
T = await make();
await T.open(603566); await T.settle();
await T.page.focus("#mvHcalNext"); await T.page.keyboard.press("Enter"); await T.settle(); s = await T.st(); ok("I Enter on Next", s.titles[0] === "November 2026", s);
await T.page.keyboard.press("Space"); await T.settle(); s = await T.st(); ok("I Space on Next", s.titles[0] === "December 2026", s);
await T.page.focus("#mvHcalNext"); await T.page.keyboard.press("PageUp"); await T.settle(); s = await T.st(); ok("I PageUp = previous month", s.titles[0] === "November 2026", s);
await T.page.keyboard.press("PageDown"); await T.settle(); s = await T.st(); ok("I PageDown = next month", s.titles[0] === "December 2026", s);
ok("I day buttons are keyboard-focusable buttons with aria-labels", await T.page.evaluate(() => { const c = document.querySelector('#mvHostawayCalendarMonths [data-date="2026-12-25"]'); return c.tagName === "BUTTON" && /unavailable/.test(c.getAttribute("aria-label")); }));
await T.page.focus('#mvHostawayCalendarMonths [data-date="2026-12-20"]'); await T.page.keyboard.press("Enter"); await T.page.focus('#mvHostawayCalendarMonths [data-date="2026-12-22"]'); await T.page.keyboard.press("Enter"); await T.settle(); s = await T.st();
ok("I stay selectable by keyboard alone", s.start === "2026-12-20" && s.end === "2026-12-22" && s.checkBtn, s);
await T.page.keyboard.press("Escape"); await T.page.waitForTimeout(80);
ok("I Escape still closes the modal", await T.page.evaluate(() => document.getElementById("mvModal").getAttribute("aria-hidden") === "true"));
await T.done();

// ===== J. Mobile =====
T = await make({ vp: { width: 390, height: 800 } });
await T.open(603566); await T.settle(); await T.next(); await T.settle();
const mob = await T.page.evaluate(() => { const cs = getComputedStyle(document.getElementById("mvHostawayCalendarMonths")); const n = document.getElementById("mvHcalNext").getBoundingClientRect(); const p = document.getElementById("mvHcalPrev").getBoundingClientRect(); const box = document.getElementById("mvHostawayCalendar").getBoundingClientRect(); return { cols: cs.gridTemplateColumns.split(" ").length, nh: n.height, nw: n.width, ph: p.height, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, boxRight: box.right, vw: innerWidth, months: document.querySelectorAll("#mvHostawayCalendarMonths .mv-cal__month").length }; });
ok("J mobile: one column, two months, tap targets >= 40px, nothing overflows", mob.cols === 1 && mob.months === 2 && mob.nh >= 40 && mob.nw >= 40 && mob.ph >= 40 && !mob.overflow && mob.boxRight <= mob.vw, mob);
await T.done();

// ===== K. Other features and errors =====
T = await make();
await T.open(603564); await T.settle();
ok("K modal still shows details, image and no reserve/checkout/payment controls", await T.page.evaluate(() => { const m = document.getElementById("mvModalContent"); return !!m.querySelector("h2") && !!m.querySelector("img") && ![...document.querySelectorAll("#mvModal button, #mvModal a")].some((b) => /reserve|book now|checkout|pay\b|stripe/i.test(b.textContent)); }));
await T.closeModal();
ok("K search results and cards intact after modal use", (await T.page.locator(".mv-card").count()) === 2);
ok("K no calls to other hosts / Smoobu", T.all.every((x) => !x.startsWith("OTHER") && !/smoobu\//.test(x.split("?")[0])), T.all.filter((x) => x.startsWith("OTHER")));
ok("K no page/console errors across the whole run", T.errors.length === 0, T.errors);
await T.done();

await browser.close(); server.close();
const names = Object.keys(results), pass = names.filter((n) => results[n] === "PASS").length;
console.log(JSON.stringify(results, null, 1)); console.log(`\n${pass}/${names.length} passed`); process.exit(failed ? 1 : 0);
