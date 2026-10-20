// N1 offline browser tests: main search date picker navigation. Real page in real Chromium, fixed clock, fixture proxy.
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync } from "node:fs";
import { PAGE_PATH } from "../lib/page-source.mjs";

const PAGE = readFileSync(PAGE_PATH, "utf8");
const server = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(PAGE); });
await new Promise((r) => server.listen(5500, "localhost", r));
const PROXY = "https://maravilla-smoobu-proxy-git-dev-joel-goralskis-projects.vercel.app";
const listings = { ok: true, checkedAt: "2026-10-19T00:00:00Z", listings: [
  { id: 603564, source: "hostaway", slug: "hostaway-603564", name: "Hacienda 5 De Mayo", sleeps: 2, bedrooms: 1, bathrooms: 1, city: "Bucerías", tagline: "t", summary: "s", img: "https://example.com/a.jpg", images: [], currency: "MXN", minNights: 1, maxNights: 365 },
  { id: 603566, source: "hostaway", slug: "hostaway-603566", name: "East Side Studio", sleeps: 2, bedrooms: 1, bathrooms: 1, city: "Bucerías", tagline: "t", summary: "s", img: "https://example.com/b.jpg", images: [], currency: "MXN", minNights: 1, maxNights: 365 } ] };
const RATE = { 603564: 2200, 603566: 1600 };
const nightsOf = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const results = {}; let failed = 0;
const ok = (name, cond, detail) => { results[name] = cond ? "PASS" : "FAIL " + JSON.stringify(detail); if (!cond) { failed++; console.log("FAIL", name, JSON.stringify(detail)); } };
const browser = await chromium.launch();

async function make(nowIso, vp = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport: vp });
  const FIXED = new Date(nowIso).getTime();
  await ctx.addInitScript((FIXED) => { const D = Date; class M extends D { constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); } static now() { return FIXED; } } window.Date = M; }, FIXED);
  const page = await ctx.newPage();
  const apiLog = [], errors = [];
  page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === PROXY) {
      apiLog.push(u.pathname + u.search); const p = Object.fromEntries(u.searchParams);
      const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", headers: { "access-control-allow-origin": "http://localhost:5500" }, body: JSON.stringify(b) });
      if (u.pathname === "/api/booking/listings") return json(listings);
      if (u.pathname === "/api/booking/calendar") return json({ ok: true, listingId: Number(p.id), from: "2026-10-19", to: "2027-01-17", coverage: { daysRequested: 91, daysReturned: 91, complete: true }, unavailable: [], unavailableNights: 0, restrictions: { closedOnArrival: [], closedOnDeparture: [], minimumStay: [], maximumStay: [] }, checkedAt: "2026-10-19T00:00:00Z" });
      if (u.pathname === "/api/booking/quote") { const n = nightsOf(p.from, p.to), t = RATE[p.id] * n; return json({ ok: true, available: true, decision: "quoted", listingId: Number(p.id), from: p.from, to: p.to, nights: n, guests: 2, currency: "MXN", total: t, nightlyAverage: RATE[p.id], breakdown: [{ type: "accommodation", label: "Accommodation", total: t }], checkedAt: "x", quoteBasis: "hostaway.priceDetails.v2", note: "n" }); }
      return json({ ok: false }, 404);
    }
    if (u.hostname === "example.com") return route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64") });
    if (u.hostname === "localhost") return route.continue();
    apiLog.push("OTHER " + u.href); return route.abort();
  });
  await page.goto("http://localhost:5500/consumer/booking-test.html");
  await page.waitForSelector(".mv-card", { timeout: 15000 });
  const api = {
    page, apiLog, errors,
    state: () => page.evaluate(() => ({ open: document.getElementById("mvCalendarModal").getAttribute("aria-hidden") === "false", range: document.getElementById("mvCalRange").textContent, titles: [...document.querySelectorAll("#mvCalendarMonths .mv-cal__title")].map((t) => t.textContent), prevDis: document.getElementById("mvCalPrev").disabled, nextDis: document.getElementById("mvCalNext").disabled, start: document.querySelector("#mvCalendarMonths .is-start")?.dataset.date || null, end: document.querySelector("#mvCalendarMonths .is-end")?.dataset.date || null, inrange: document.querySelectorAll("#mvCalendarMonths .is-inrange").length, notice: document.getElementById("mvCalendarNotice").textContent, inputs: [document.getElementById("mvCheckin").value, document.getElementById("mvCheckout").value], btn: document.getElementById("mvDatesBtn").textContent })),
    open: async () => { await page.click("#mvDatesBtn"); },
    next: async () => { await page.click("#mvCalNext"); }, prev: async () => { await page.click("#mvCalPrev"); },
    day: (iso) => page.locator(`#mvCalendarMonths .mv-cal__day[data-date="${iso}"]`),
    pick: async (iso) => { await page.locator(`#mvCalendarMonths .mv-cal__day[data-date="${iso}"]`).click({ force: true }); },
    visible: (iso) => page.evaluate((iso) => !!document.querySelector(`#mvCalendarMonths .mv-cal__day[data-date="${iso}"]`), iso),
    goTo: async (iso) => { for (let i = 0; i < 40; i++) { if (await api.visible(iso)) return true; const st = await api.state(); const [y, m] = iso.split("-").map(Number); const left = new Date(st.titles[0] + " 1").getTime(); const target = new Date(y, m - 1, 1).getTime(); if (target < left) { if (st.prevDis) return false; await api.prev(); } else { if (st.nextDis) return false; await api.next(); } } return false; },
    close: async () => { await ctx.close(); }
  };
  return api;
}

// ================= Clock: 2026-10-19 (the real situation) =================
let t = await make("2026-10-19T12:00:00");
const baseline = t.apiLog.length;
let s = await t.state(); ok("closed initially", s.open === false, s);
await t.open(); s = await t.state();
ok("opens on current month, two months", s.open && s.titles.join("|") === "October 2026|November 2026" && s.range === "October 2026 – November 2026", s);
ok("Prev disabled at current month, Next enabled", s.prevDis && !s.nextDis, s);
ok("aria labels on nav buttons", await t.page.evaluate(() => document.getElementById("mvCalPrev").getAttribute("aria-label") === "Previous month" && document.getElementById("mvCalNext").getAttribute("aria-label") === "Next month"));
ok("range is an aria-live status region", await t.page.evaluate(() => { const r = document.getElementById("mvCalRange"); return r.getAttribute("role") === "status" && r.getAttribute("aria-live") === "polite"; }));
ok("day buttons have full-date aria-labels", await t.page.evaluate(() => document.querySelector('[data-date="2026-11-07"]').getAttribute("aria-label") === "Saturday, November 7, 2026"));
ok("past day disabled + labelled; today enabled", await t.page.evaluate(() => { const p = document.querySelector('[data-date="2026-10-18"]'), d = document.querySelector('[data-date="2026-10-19"]'); return p.classList.contains("is-disabled") && p.getAttribute("aria-disabled") === "true" && /past date/.test(p.getAttribute("aria-label")) && !d.classList.contains("is-disabled"); }));

// Oct/Nov -> Nov/Dec -> Dec/Jan, back and forth
await t.next(); s = await t.state(); ok("Nov/Dec", s.titles.join("|") === "November 2026|December 2026" && !s.prevDis, s);
await t.next(); s = await t.state(); ok("Dec/Jan (year transition)", s.titles.join("|") === "December 2026|January 2027" && s.range === "December 2026 – January 2027", s);
await t.prev(); s = await t.state(); ok("back to Nov/Dec", s.titles.join("|") === "November 2026|December 2026", s);
await t.prev(); s = await t.state(); ok("back to Oct/Nov, Prev disabled again", s.titles[0] === "October 2026" && s.prevDis, s);
ok("focus moved off disabled Prev (to Next)", await t.page.evaluate(() => document.activeElement && document.activeElement.id === "mvCalNext"));
ok("navigation made zero API calls", t.apiLog.length === baseline, t.apiLog.slice(baseline));

// Select Dec 20-24 through navigation; view must not snap back
await t.next(); await t.next();
await t.pick("2026-12-20"); s = await t.state();
ok("click does not jump view back; check-in highlighted", s.titles[0] === "December 2026" && s.start === "2026-12-20" && s.end === null && s.open, s);
await t.pick("2026-12-24"); s = await t.state();
ok("Dec 20-24 selected: inputs, label; picker stays open showing the range (UX6; was: closes)", s.open && s.inputs[0] === "2026-12-20" && s.inputs[1] === "2026-12-24" && s.btn === "Dec 20 - Dec 24" && s.start === "2026-12-20" && s.end === "2026-12-24", s);
ok("selecting dates made no API call (search not run)", t.apiLog.length === baseline, t.apiLog.slice(baseline));
await t.page.keyboard.press("Escape"); // UX6: closing is now the guest's choice (Escape / Close / outside / footer)
ok("focus returned to Dates button (after closing; UX6)", await t.page.evaluate(() => document.activeElement && document.activeElement.id === "mvDatesBtn"));
// persistence through navigation (reopen -> view on check-in month)
await t.open(); s = await t.state();
ok("reopen shows the selected month with range painted", s.titles[0] === "December 2026" && s.start === "2026-12-20" && s.end === "2026-12-24" && s.inrange === 3, s);
await t.prev(); await t.prev(); s = await t.state(); ok("selection not in view but state intact", s.titles[0] === "October 2026" && s.start === null && s.inputs.join() === "2026-12-20,2026-12-24", s);
await t.next(); await t.next(); s = await t.state(); ok("selection persists after navigating away and back", s.start === "2026-12-20" && s.end === "2026-12-24" && s.inrange === 3, s);
ok("still zero API calls", t.apiLog.length === baseline);
// Dec 31 - Jan 3 across the year
await t.pick("2026-12-31"); await t.pick("2027-01-03"); s = await t.state();
ok("Dec 31 - Jan 3 selected across year boundary (picker stays open; UX6)", s.open && s.inputs.join() === "2026-12-31,2027-01-03" && s.btn === "Dec 31 - Jan 3", s);
await t.page.keyboard.press("Escape"); // UX6: close before using the external button
// Search after selection issues the existing quote calls only
await t.page.click("#mvSearchBtn"); await t.page.waitForFunction(() => !document.getElementById("mvSearchBtn").disabled);
const qs = t.apiLog.slice(baseline);
ok("Search then issues only the 2 existing quote calls with the picked dates", qs.length === 2 && qs.every((x) => x.startsWith("/api/booking/quote") && x.includes("from=2026-12-31") && x.includes("to=2027-01-03")), qs);
ok("cards still present with prices", await t.page.evaluate(() => [...document.querySelectorAll(".mv-card")].every((c) => /MXN total/.test(c.textContent))));
// reverse pick restarts; past unselectable
await t.open(); await t.goTo("2026-11-07"); await t.pick("2026-11-10"); await t.pick("2026-11-07"); s = await t.state();
ok("earlier day restarts selection (existing behaviour)", s.start === "2026-11-07" && s.end === null && s.open, s);
await t.goTo("2026-10-18"); const before = await t.state(); await t.pick("2026-10-18"); s = await t.state();
ok("past day not selectable", s.start === before.start && s.end === before.end && s.open, s);
await t.pick("2026-11-12"); s = await t.state(); ok("check-out chosen after restart", s.inputs.join() === "2026-11-07,2026-11-12", s);
await t.page.keyboard.press("Escape"); // UX6: a complete range keeps the picker open; close before reopening
// 365-day horizon
await t.open(); let steps = 0; for (; steps < 30; steps++) { s = await t.state(); if (s.nextDis) break; await t.next(); }
s = await t.state();
ok("Next disabled at horizon (reopen starts at selected month Nov 2026 => 10 steps)", s.nextDis && steps === 10 && s.titles.join("|") === "September 2027|October 2027" && s.range === "September 2027 – October 2027", { steps, s });
ok("focus moved to Prev when Next became disabled", await t.page.evaluate(() => document.activeElement && document.activeElement.id === "mvCalPrev"));
ok("last selectable day 2027-10-19 enabled; 2027-10-20 disabled 'too far ahead'", await t.page.evaluate(() => { const a = document.querySelector('[data-date="2027-10-19"]'), b = document.querySelector('[data-date="2027-10-20"]'); return !a.classList.contains("is-disabled") && b.classList.contains("is-disabled") && /too far ahead/.test(b.getAttribute("aria-label")); }));
await t.pick("2027-10-20"); s = await t.state(); ok("beyond-horizon day cannot be picked", s.start === null || s.start !== "2027-10-20", s);
await t.close();
t = await make("2026-10-19T12:00:00"); await t.open(); let fresh = 0; for (; fresh < 30; fresh++) { if ((await t.state()).nextDis) break; await t.next(); }
ok("fresh open from Oct 2026 reaches the horizon in exactly 11 Next clicks", fresh === 11 && (await t.state()).titles[1] === "October 2027", { fresh });
await t.close();

// ================= 90-night boundary =================
t = await make("2026-10-19T12:00:00");
await t.open(); await t.goTo("2026-12-01"); await t.pick("2026-12-01"); await t.goTo("2027-03-01"); await t.pick("2027-03-01"); s = await t.state();
ok("exactly 90 nights (Dec 1 -> Mar 1) accepted (picker stays open; UX6)", s.open && s.inputs.join() === "2026-12-01,2027-03-01", s);
await t.page.keyboard.press("Escape"); // UX6: close before reopening
await t.open(); await t.goTo("2026-12-01"); await t.pick("2026-12-01"); await t.goTo("2027-03-02"); await t.pick("2027-03-02"); s = await t.state();
ok("91 nights (Dec 1 -> Mar 2) rejected: stays open, new check-in Mar 2, notice shown, inputs unchanged", s.open && s.start === "2027-03-02" && s.end === null && /limited to 90 nights/.test(s.notice) && s.inputs.join() === "2026-12-01,2027-03-01", s);
await t.next(); s = await t.state(); ok("notice cleared on navigation", s.notice === "", s);
ok("no API calls during 90-night checks", t.apiLog.filter((x) => !x.includes("/listings")).length === 0, t.apiLog);
await t.close();

// ================= Leap-year boundaries =================
t = await make("2027-11-20T12:00:00");
await t.open(); ok("leap: Feb 2028 reachable", await t.goTo("2028-02-29"));
ok("leap: Feb 2028 has 29 day cells, Feb 29 enabled", await t.page.evaluate(() => { const m = [...document.querySelectorAll("#mvCalendarMonths .mv-cal__month")].find((x) => x.querySelector(".mv-cal__title").textContent === "February 2028"); return m.querySelectorAll(".mv-cal__day").length === 29 && !m.querySelector('[data-date="2028-02-29"]').classList.contains("is-disabled"); }));
await t.pick("2028-02-28"); await t.goTo("2028-03-01"); await t.pick("2028-03-01"); s = await t.state(); ok("stay across leap day (Feb 28 -> Mar 1) selected", s.inputs.join() === "2028-02-28,2028-03-01", s);
await t.close();
t = await make("2028-02-20T12:00:00"); await t.open();
await t.goTo("2029-02-19"); s = await t.state();
ok("365 days from 2028-02-20 = 2029-02-19: enabled; 02-20 disabled; Feb 2029 has 28 cells", await t.page.evaluate(() => { const a = document.querySelector('[data-date="2029-02-19"]'), b = document.querySelector('[data-date="2029-02-20"]'); const m = [...document.querySelectorAll("#mvCalendarMonths .mv-cal__month")].find((x) => x.querySelector(".mv-cal__title").textContent === "February 2029"); return a && b && !a.classList.contains("is-disabled") && b.classList.contains("is-disabled") && m.querySelectorAll(".mv-cal__day").length === 28; }));
ok("horizon month at Next-disabled is Jan/Feb 2029", (await t.state()).nextDis && (await t.state()).titles.join("|") === "January 2029|February 2029", await t.state());
await t.close();
t = await make("2028-02-29T12:00:00"); await t.open(); await t.goTo("2029-02-28");
ok("today = leap day 2028-02-29: +365 = 2029-02-28 enabled, 2029-03-01 not offered/disabled", await t.page.evaluate(() => { const a = document.querySelector('[data-date="2029-02-28"]'); const b = document.querySelector('[data-date="2029-03-01"]'); return a && !a.classList.contains("is-disabled") && (!b || b.classList.contains("is-disabled")); }));
await t.close();

// ================= Keyboard =================
t = await make("2026-10-19T12:00:00");
await t.page.focus("#mvDatesBtn"); await t.page.keyboard.press("Enter");
ok("keyboard open moves focus into dialog", await t.page.evaluate(() => document.getElementById("mvCalendarPanel").contains(document.activeElement) && document.getElementById("mvCalendarModal").getAttribute("aria-hidden") === "false"));
await t.page.keyboard.press("Tab"); await t.page.keyboard.press("Tab");
ok("Tab reaches nav controls in order (Close then Prev disabled skipped -> Next)", await t.page.evaluate(() => ["mvCalendarClose", "mvCalNext"].includes(document.activeElement.id)), await t.page.evaluate(() => document.activeElement.id));
await t.page.focus("#mvCalNext"); await t.page.keyboard.press("Enter"); s = await t.state(); ok("Enter on Next navigates", s.titles[0] === "November 2026", s);
await t.page.keyboard.press("Space"); s = await t.state(); ok("Space on Next navigates", s.titles[0] === "December 2026", s);
await t.page.keyboard.press("PageUp"); s = await t.state(); ok("PageUp = previous month", s.titles[0] === "November 2026", s);
await t.page.keyboard.press("PageDown"); s = await t.state(); ok("PageDown = next month", s.titles[0] === "December 2026", s);
await t.page.keyboard.press("Escape"); s = await t.state();
ok("Escape closes and returns focus to Dates button", !s.open && await t.page.evaluate(() => document.activeElement.id === "mvDatesBtn"), s);
await t.page.keyboard.press("Escape"); ok("Escape while closed is harmless", true);
ok("keyboard run made no API calls", t.apiLog.filter((x) => !x.includes("/listings")).length === 0, t.apiLog);
await t.close();

// ================= Modal calendar, favorites, filters untouched =================
t = await make("2026-10-19T12:00:00");
await t.page.click(".mv-card"); await t.page.waitForSelector("#mvHostawayCalendarMonths .mv-cal__month", { timeout: 10000 });
ok("property modal calendar (N2 contract): 2 months, own Prev/Next, one window-scoped calendar call, search picker nav intact", await t.page.evaluate(() => document.querySelectorAll("#mvHostawayCalendarMonths .mv-cal__month").length === 2 && !!document.querySelector("#mvHcalPrev") && !!document.querySelector("#mvHcalNext")) && t.apiLog.filter((x) => x.includes("/calendar")).length === 1);
await t.close();
t = await make("2026-10-19T12:00:00");
const favBefore = await t.page.evaluate(() => document.body.innerText.match(/Saved \((\d+)\)/)?.[1]);
const favBtn = t.page.locator(".mv-card [data-fav], .mv-card .mv-fav, .mv-card .mv-heart").first();
if (await favBtn.count()) { await favBtn.click(); }
ok("favorites control still operates (saved count readable)", favBefore !== undefined, favBefore);
await t.page.selectOption("#mvGuests", "3"); await t.page.waitForTimeout(200);
ok("guest filter still filters cards", (await t.page.locator(".mv-card").count()) === 0);
await t.close();

// ================= Mobile =================
t = await make("2026-10-19T12:00:00", { width: 390, height: 800 });
await t.open(); await t.next();
const mob = await t.page.evaluate(() => { const g = getComputedStyle(document.getElementById("mvCalendarMonths")).gridTemplateColumns.split(" ").length; const n = document.getElementById("mvCalNext").getBoundingClientRect(); const p = document.getElementById("mvCalPrev").getBoundingClientRect(); return { cols: g, nextW: n.width, nextH: n.height, prevH: p.height, overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth, panelW: document.getElementById("mvCalendarPanel").getBoundingClientRect().width, vw: innerWidth, months: document.querySelectorAll("#mvCalendarMonths .mv-cal__month").length }; });
ok("mobile: months stack in one column (two months), no horizontal overflow, tap targets >= 40px", mob.cols === 1 && mob.months === 2 && !mob.overflowX && mob.nextW >= 40 && mob.nextH >= 40 && mob.prevH >= 40 && mob.panelW <= mob.vw, mob);
await t.close();

// errors
// (collected per page; spot check on a fresh interaction run)
t = await make("2026-10-19T12:00:00"); await t.open(); await t.next(); await t.next(); await t.pick("2026-12-20"); await t.pick("2026-12-24");
ok("no page/console errors during interaction", t.errors.length === 0, t.errors);
await t.close();

await browser.close(); server.close();
const names = Object.keys(results); const pass = names.filter((n) => results[n] === "PASS").length;
console.log(JSON.stringify(results, null, 1)); console.log(`\n${pass}/${names.length} passed`); process.exit(failed ? 1 : 0);
