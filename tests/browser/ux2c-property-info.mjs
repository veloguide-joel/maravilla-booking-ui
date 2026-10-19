// UX2c: property information area (facts, amenities, check-in/out, reserved booking column).
// Fixtures mirror the live proxy DEV 20-field contract for the two pilots as recorded on 2026-10-19
// (amenity labels, beds, times, description:null). Nothing is fetched from the network.
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync } from "node:fs";
import { PAGE_PATH } from "../lib/page-source.mjs";
import { TODAY, PROXY, listings as baseListings, calendarFor, quoteFor, overlaps, nightsOf, PNG_1x1 } from "../fixtures/pilots.mjs";

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

const AM_564 = ["Internet", "Wireless", "Air conditioning", "Swimming pool", "Kitchen", "Washing Machine", "Dryer", "Hair Dryer", "Smoke detector", "Carbon Monoxide Detector", "Essentials", "Hangers", "Laptop Friendly workspace", "TV", "Suitable for infants", "Coffee/tea maker", "Refrigerator", "Hot water", "Cooking basics", "Beach", "Outdoor furniture"];
const AM_566 = ["Wireless", "Air conditioning", "Swimming pool", "Kitchen", "Washing Machine", "Dryer", "Hair Dryer", "Carbon Monoxide Detector", "Essentials", "Hangers", "TV", "Coffee/tea maker", "Refrigerator", "Hot water", "Cooking basics", "Beach", "Outdoor furniture"];
const SHOWN_564 = AM_564.filter((a) => a !== "Beach"), SHOWN_566 = AM_566.filter((a) => a !== "Beach");
const SUM_564 = "Enjoy stunning bay views from this designer-created retreat. This west-facing, second-floor apartment features a full kitchen…";
const SUM_566 = "Welcome to the Upper East Side. This south-facing, second-floor studio offers a full kitchen and a spacious layout…";
const NAME_564 = "Hacienda 5 De Mayo with Ocean and Town Views", NAME_566 = "East Side Studio with Rooftop Access & Ocean Views";
const live = (idx, extra) => ({ ...baseListings.listings[idx], images: baseListings.listings[idx].images, description: null, minNights: 1, maxNights: 365, ...extra });
const PILOTS = { ok: true, checkedAt: "2026-10-19T00:00:00Z", listings: [
  live(0, { name: NAME_564, summary: SUM_564, beds: 1, amenities: AM_564, checkInFrom: "15:00", checkOutBy: "12:00" }),
  live(1, { name: NAME_566, summary: SUM_566, beds: 1, amenities: AM_566, checkInFrom: "15:00", checkOutBy: null })
] };
const variant = (extra) => ({ ...PILOTS, listings: [{ ...PILOTS.listings[0], ...extra }, PILOTS.listings[1]] });

async function make({ vp = { width: 1280, height: 900 }, body = PILOTS } = {}) {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: "reduce" });
  const FIXED = new Date(TODAY + "T12:00:00").getTime();
  await ctx.addInitScript((FIXED) => { const D = Date; class M extends D { constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); } static now() { return FIXED; } } window.Date = M; }, FIXED);
  const page = await ctx.newPage();
  const T = { page, api: [], other: [], errors: [] };
  page.on("pageerror", (e) => T.errors.push(e.message)); page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) T.errors.push(m.text()); });
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === PROXY) {
      const p = Object.fromEntries(u.searchParams); T.api.push(u.pathname + u.search);
      const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", headers: { "access-control-allow-origin": "http://localhost:5500" }, body: JSON.stringify(b) });
      if (u.pathname === "/api/booking/listings") return json(body);
      if (u.pathname === "/api/booking/calendar") { const c = calendarFor(p.id, p.from, p.to); return json(c.body, c.status); }
      if (u.pathname === "/api/booking/quote") { const id = Number(p.id), n = nightsOf(p.from, p.to); const base = { ok: true, listingId: id, from: p.from, to: p.to, nights: n, guests: Number(p.guests), currency: "MXN", checkedAt: "x" }; if (overlaps(id, p.from, p.to)) return json({ ...base, available: false, decision: "unavailable", reasons: [{ code: "NIGHT_UNAVAILABLE", message: "x" }] }); const q = quoteFor(id, n); return json({ ...base, available: true, decision: "quoted", total: q.total, nightlyAverage: q.total / n, breakdown: q.breakdown, direct: q.direct, note: "Quote only." }); }
      return json({ ok: false }, 404);
    }
    if (u.hostname === "example.com") return route.fulfill({ status: 200, contentType: "image/png", body: PNG_1x1 });
    if (u.hostname === "localhost") return route.continue();
    T.other.push(u.href); return route.abort();
  });
  T.go = async (path) => { await page.goto("http://localhost:5500" + path); await page.waitForFunction(() => document.querySelector(".mv-card") || (document.querySelector("#mvPropertyView h1") && !/Loading/.test(document.querySelector("#mvPropertyView h1").textContent)), null, { timeout: 15000 }); await page.waitForTimeout(120); };
  T.info = () => page.evaluate(() => {
    const pv = document.getElementById("mvPropertyView");
    const vis = (el) => !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0;
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom) }; };
    const items = [...pv.querySelectorAll("#mvPropAmenitiesList .mv-amen__item")];
    const tog = document.getElementById("mvPropAmenitiesToggle");
    const dupIds = (() => { const seen = new Map(); document.querySelectorAll("[id]").forEach((el) => seen.set(el.id, (seen.get(el.id) || 0) + 1)); return [...seen].filter(([, n]) => n > 1).map(([id]) => id); })();
    return {
      h1: pv.querySelector("h1")?.textContent || null, where: pv.querySelector(".mv-prop__where")?.textContent || null,
      facts: [...pv.querySelectorAll("#mvPropFacts .mv-pill")].map((p) => p.textContent),
      summary: pv.querySelector(".mv-prop__summary")?.textContent ?? null, summaryCount: pv.querySelectorAll(".mv-prop__summary").length,
      amenSection: !!document.getElementById("mvPropAmenities"), amenHeading: document.getElementById("mvPropAmenitiesTitle")?.textContent ?? null,
      amen: items.map((li) => li.textContent), amenVisible: items.filter(vis).length, icons: items.map((li) => li.querySelector("svg")?.dataset.icon),
      iconsHidden: items.every((li) => li.querySelector("svg")?.getAttribute("aria-hidden") === "true"),
      toggle: tog ? { text: tog.textContent, expanded: tog.getAttribute("aria-expanded"), controls: tog.getAttribute("aria-controls"), visible: vis(tog) } : null,
      practical: document.getElementById("mvPropPractical") ? [...document.querySelectorAll("#mvPropPractical .mv-prop__times > div")].map((d) => [d.querySelector("dt").textContent, d.querySelector("dd").textContent]) : null,
      sections: [...pv.querySelectorAll("section.mv-prop__section")].map((s) => [s.id, s.getAttribute("aria-labelledby"), s.querySelector("h2")?.textContent]),
      headings: [...pv.querySelectorAll("h1,h2,h3")].map((h) => h.tagName + ":" + h.textContent),
      text: pv.innerText,
      aside: { present: !!document.getElementById("mvPropAside"), rect: r(document.getElementById("mvPropAside")), text: document.getElementById("mvPropAside")?.innerText || "", note: !!document.querySelector("#mvPropAside .mv-prop__note"), request: (() => { const a = document.querySelector("#mvPropAside #mvPanelCheckin")?.textContent; return a && a !== "Not selected" ? `${a} → ${document.getElementById("mvPanelCheckout").textContent}` : null; })() }, // UX3: panel fields replaced the request line
      main: r(document.getElementById("mvPropMain")), mainText: document.getElementById("mvPropMain")?.innerText || "", gallery: r(document.getElementById("mvPropGallery")), view: r(pv),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      bookingIdsInView: ["mvHostawayCalendar", "mvHostawayQuote", "mvHostawayQuoteBtn", "mvHostawaySelection", "mvGuests", "mvCheckin", "mvCheckout"].filter((id) => pv.querySelector("#" + id)).length,
      controls: [...pv.querySelectorAll("button,a,input,select")].map((b) => b.textContent.trim() || b.getAttribute("aria-label") || b.tagName),
      dupIds, focus: document.activeElement?.id || document.activeElement?.tagName, path: location.pathname + location.search,
      propVisible: !pv.classList.contains("mv-view-hidden"), appVisible: !document.getElementById("mv-app").classList.contains("mv-view-hidden"),
      gal: { n: document.querySelectorAll(".mv-gal__tile").length, count: document.getElementById("mvPropGallery")?.dataset.count ?? null, all: document.getElementById("mvPropGalleryAll")?.textContent ?? null },
      modalOpen: document.getElementById("mvModal").getAttribute("aria-hidden") === "false"
    };
  });
  T.done = () => ctx.close();
  return T;
}

const BANNED = /cancell|refund|house rule|no pets|pets allowed|pet[- ]friendly|smoking|parties|cleaning fee|security deposit|deposit|additional charge|extra fee|beachfront|oceanfront|beach access|steps (from|to) the beach|walk to the beach|private pool|exclusive|gated|doorman|concierge|parking|elevator|gym|rooftop pool/i;

// ===== 1-3, 6-8. Desktop content for both pilots =====
let T = await make();
await T.go("/property/603564"); let s = await T.info();
ok("1 603564: verified name and location (Bucerías, Nayarit, Mexico) unchanged", s.h1 === NAME_564 && s.where === "Bucerías, Nayarit, Mexico", { h1: s.h1, w: s.where });
ok("2 603564 facts: Sleeps 2 · 1 bedroom · 1 bed · 1 bath (beds now shown, order fixed)", same(s.facts, ["Sleeps 2", "1 bedroom", "1 bed", "1 bath"]), s.facts);
ok("3 603564: all 20 displayable amenities in feed order, exactly as labelled", same(s.amen, SHOWN_564), s.amen);
ok("8 'Beach' is held back (no beach-access implication) and appears nowhere on the page", !s.amen.includes("Beach") && !/\bbeach\b/i.test(s.text), s.amen);
ok("3 icons only for unambiguous labels; the rest a neutral check; icons hidden from screen readers", s.iconsHidden && same(s.icons.slice(0, 10), ["wifi", "wifi", "snow", "waves", "utensils", "washer", "washer", "check", "alarm", "alarm"]) && s.icons[SHOWN_564.indexOf("Essentials")] === "check" && s.icons[SHOWN_564.indexOf("Suitable for infants")] === "check", s.icons);
ok("3 desktop: first 10 visible, 'Show all 20 amenities' (collapsed, controls the list)", s.amenVisible === 10 && s.toggle && s.toggle.visible && s.toggle.text === "Show all 20 amenities" && s.toggle.expanded === "false" && s.toggle.controls === "mvPropAmenitiesList", { v: s.amenVisible, t: s.toggle });
await T.page.click("#mvPropAmenitiesToggle"); let s2 = await T.info();
ok("3 expand: all 20 visible, aria-expanded=true, label 'Show fewer amenities', focus stays on the toggle", s2.amenVisible === 20 && s2.toggle.expanded === "true" && s2.toggle.text === "Show fewer amenities" && s2.focus === "mvPropAmenitiesToggle", s2.toggle);
await T.page.click("#mvPropAmenitiesToggle"); s2 = await T.info();
ok("3 collapse again: back to 10", s2.amenVisible === 10 && s2.toggle.expanded === "false", s2.amenVisible);
ok("1 603564 check-in/check-out section: From 3:00 PM / By 12:00 PM (feed 15:00 / 12:00)", same(s.practical, [["Check-in", "From 3:00 PM"], ["Check-out", "By 12:00 PM"]]), s.practical);
ok("6 summary: exactly one paragraph, same text as the feed (UX1 behaviour); no 'About' section; description never shown", s.summaryCount === 1 && s.summary === SUM_564 && !s.headings.some((h) => /about/i.test(h)), { c: s.summaryCount, h: s.headings });
ok("7 no cancellation, refund, house-rule, pet, fee or deposit wording", !/cancell|refund|house rule|pet|fee\b|deposit/i.test(s.text), s.text.match(/cancell|refund|house rule|pet|fee\b|deposit/i));
ok("8 no invented location / building / beach / exclusive-pool claims", !BANNED.test(s.text), s.text.match(BANNED));
ok("headings: h1 title, h2 Amenities, h2 Check-in and check-out; sections labelled by their headings", same(s.headings, ["H1:" + NAME_564, "H2:Amenities", "H2:Check-in and check-out"]) && s.sections.every(([id, lab, h]) => lab === id + "Title" && h), s);
ok("reserved right column: aside next to the main column, holding only the existing booking-soon note (no booking controls)", s.aside.present && s.aside.rect.x > s.main.r && s.aside.rect.w >= 300 && s.aside.note && /opens soon/.test(s.aside.text) && s.bookingIdsInView === 0 && !s.controls.some((c) => /reserve|book|checkout|pay\b|check price|availability/i.test(c)), { a: s.aside, c: s.controls });
ok("desktop main column starts under the gallery and the gallery spans both columns", s.main.y > s.gallery.b && s.gallery.r >= s.aside.rect.r - 1 && s.main.x === s.gallery.x, { m: s.main, g: s.gallery, a: s.aside.rect });
ok("no duplicate ids; no booking ids inside the property view", s.dupIds.length === 0 && s.bookingIdsInView === 0, s.dupIds);
ok("11 gallery untouched: 1 tile per fixture photo, Show all photos present", s.gal.n === 1 && s.gal.all === "Show all photos", s.gal);

await T.go("/property/603566"); s = await T.info();
ok("1 603566: name, location, facts Sleeps 2 · 1 bedroom · 1 bed · 1 bath", s.h1 === NAME_566 && same(s.facts, ["Sleeps 2", "1 bedroom", "1 bed", "1 bath"]), s);
ok("3 603566: all 16 displayable amenities, Beach held, toggle 'Show all 16 amenities'", same(s.amen, SHOWN_566) && s.toggle.text === "Show all 16 amenities" && s.amenVisible === 10, { a: s.amen, t: s.toggle });
ok("5 603566: check-out not supplied -> only 'Check-in From 3:00 PM' (no invented default)", same(s.practical, [["Check-in", "From 3:00 PM"]]) && !/check-out\s*by/i.test(s.text), s.practical);
ok("8 603566 page: no banned claims, no beach wording", !BANNED.test(s.text) && !/\bbeach\b/i.test(s.text), s.text.match(BANNED));
ok("no page errors (desktop)", T.errors.length === 0, T.errors);
await T.done();

// ===== 4-6. Missing / malformed data =====
const cases = [
  ["4 amenities missing (undefined)", { amenities: undefined }, (s) => !s.amenSection && s.toggle === null],
  ["4 amenities not an array", { amenities: "Pool, Wifi" }, (s) => !s.amenSection],
  ["4 amenities only malformed", { amenities: [null, 5, "", " ", "x", "<script>", { a: 1 }] }, (s) => !s.amenSection],
  ["4 amenities only 'Beach'", { amenities: ["Beach", "BEACH"] }, (s) => !s.amenSection],
  ["4 amenities mixed: valid kept in order, duplicates and junk dropped, no HTML injected", { amenities: ["TV", "<img src=x onerror=alert(1)>", "tv", "  Kitchen  ", 7, "Air\nconditioning"] }, (s) => same(s.amen, ["TV", "Kitchen", "Air conditioning"]) && s.toggle === null],
  ["4 exactly 7 amenities: all shown on desktop, no toggle there", { amenities: ["TV", "Kitchen", "Dryer", "Hangers", "Essentials", "Hot water", "Refrigerator"] }, (s) => s.amen.length === 7 && s.amenVisible === 7 && s.toggle && !s.toggle.visible],
  ["5 check-in and check-out both missing: no section", { checkInFrom: null, checkOutBy: undefined }, (s) => s.practical === null && !/check-in|check-out/i.test(s.mainText)],
  ["5 malformed times ('3pm', '25:00') are not shown", { checkInFrom: "3pm", checkOutBy: "25:00" }, (s) => s.practical === null],
  ["5 only check-out supplied", { checkInFrom: null, checkOutBy: "11:00" }, (s) => same(s.practical, [["Check-out", "By 11:00 AM"]])],
  ["2 beds missing / 0 / malformed: no bed pill", { beds: 0 }, (s) => same(s.facts, ["Sleeps 2", "1 bedroom", "1 bath"])],
  ["2 bedrooms/bathrooms/beds missing: only Sleeps", { bedrooms: null, bathrooms: undefined, beds: "2" }, (s) => same(s.facts, ["Sleeps 2"])],
  ["2 plurals and half baths", { bedrooms: 2, beds: 3, bathrooms: 1.5, sleeps: 6 }, (s) => same(s.facts, ["Sleeps 6", "2 bedrooms", "3 beds", "1.5 baths"])],
  ["2 studio", { bedrooms: 0, beds: 1 }, (s) => same(s.facts, ["Sleeps 2", "Studio", "1 bed", "1 bath"])],
  ["6 description present in the payload is STILL not shown (publication stays off)", { description: "PRIVATE FULL DESCRIPTION door code 4321" }, (s) => !/PRIVATE FULL DESCRIPTION|4321/.test(s.text)],
  ["6 no summary: no empty paragraph, sections still render", { summary: null }, (s) => s.summaryCount === 0 && s.amenSection],
  ["everything optional missing: compact page (facts + note), no empty sections", { summary: null, amenities: [], checkInFrom: null, checkOutBy: null, beds: null }, (s) => s.sections.length === 0 && s.summaryCount === 0 && s.aside.note && same(s.facts, ["Sleeps 2", "1 bedroom", "1 bath"])]
];
for (const [name, extra, check] of cases) {
  T = await make({ body: variant(extra) }); await T.go("/property/603564"); s = await T.info();
  ok(name, check(s) && T.errors.length === 0 && !s.text.includes("undefined") && !s.text.includes("null") && !s.text.includes("NaN"), { s: { facts: s.facts, amen: s.amen, practical: s.practical, sections: s.sections, toggle: s.toggle, sc: s.summaryCount }, e: T.errors });
  await T.done();
}
T = await make({ body: variant({ amenities: ["TV", "<img src=x onerror=alert(1)>"] }) }); await T.go("/property/603564");
ok("14 no element injected from amenity text", (await T.page.evaluate(() => document.querySelectorAll("#mvPropertyView img[src='x']").length)) === 0);
await T.done();

// ===== 9. Responsive: 390 and 320 =====
for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
  T = await make({ vp }); await T.go("/property/603564"); s = await T.info();
  ok(`9 ${vp.width}px: single column — reserved column stacked (UX3: compact panel above the content), nothing beside it; no horizontal overflow`, !s.overflow && s.aside.rect.b <= s.main.y && s.aside.rect.x === s.main.x && s.main.r <= vp.width && s.aside.rect.r <= vp.width, { m: s.main, a: s.aside.rect, o: s.overflow });
  ok(`9 ${vp.width}px: amenities one per row, 6 visible + 'Show all 20 amenities'`, s.amenVisible === 6 && s.toggle.visible && s.toggle.text === "Show all 20 amenities", { v: s.amenVisible, t: s.toggle });
  const rows = await T.page.evaluate(() => [...document.querySelectorAll("#mvPropAmenitiesList .mv-amen__item")].filter((li) => getComputedStyle(li).display !== "none").map((li) => Math.round(li.getBoundingClientRect().left)));
  ok(`9 ${vp.width}px: amenity items share one left edge (one column)`, new Set(rows).size === 1, rows);
  await T.page.click("#mvPropAmenitiesToggle"); s2 = await T.info();
  ok(`9 ${vp.width}px: expanding shows all 20, still no overflow`, s2.amenVisible === 20 && !s2.overflow, s2.amenVisible);
  ok(`9 ${vp.width}px: facts pills wrap inside the viewport`, await T.page.evaluate((w) => [...document.querySelectorAll("#mvPropFacts .mv-pill")].every((p) => p.getBoundingClientRect().right <= w), vp.width));
  ok(`11 ${vp.width}px: UX2b mobile carousel layout unchanged (flex track, single photo hides counter/arrows)`, same(await T.page.evaluate(() => [getComputedStyle(document.getElementById("mvPropGalleryTrack")).display, getComputedStyle(document.getElementById("mvPropGalleryCount")).display, getComputedStyle(document.getElementById("mvPropGalleryNext")).display]), ["flex", "none", "none"]));
  await T.done();
}
T = await make({ vp: { width: 390, height: 844 }, body: variant({ amenities: ["TV", "Kitchen", "Dryer", "Hangers", "Essentials", "Hot water", "Refrigerator"] }) }); await T.go("/property/603564"); s = await T.info();
ok("9 390px with 7 amenities: 6 visible and the toggle appears on phones only", s.amenVisible === 6 && s.toggle.visible && s.toggle.text === "Show all 7 amenities", s);
await T.done();
T = await make({ vp: { width: 900, height: 900 } }); await T.go("/property/603564"); s = await T.info();
ok("9 900px (tablet): single column, no overflow", !s.overflow && s.aside.rect.b <= s.main.y, { m: s.main, a: s.aside.rect });
await T.done();

// ===== 10. Keyboard and accessibility =====
T = await make(); await T.go("/property/603564");
const order = []; for (let i = 0; i < 4; i++) { await T.page.keyboard.press("Tab"); order.push(await T.page.evaluate(() => document.activeElement.id || document.activeElement.className)); }
ok("10 Tab order from the title: Show all photos, the UX3 panel link, then Show all amenities (amenities are not tab stops)", order[0] === "mvPropGalleryAll" && order[1] === "mvPanelChange" && order[2] === "mvPropAmenitiesToggle", order);
await T.page.focus("#mvPropAmenitiesToggle"); await T.page.keyboard.press("Enter"); s = await T.info();
ok("10 Enter toggles the amenity list (aria-expanded true)", s.toggle.expanded === "true" && s.amenVisible === 20, s.toggle);
await T.page.keyboard.press("Space"); s = await T.info();
ok("10 Space toggles back", s.toggle.expanded === "false" && s.amenVisible === 10, s.toggle);
const a11y = await T.page.evaluate(() => ({ ul: document.getElementById("mvPropAmenitiesList").tagName, lis: document.querySelectorAll("#mvPropAmenitiesList > li").length, dl: !!document.querySelector("#mvPropPractical dl"), aside: document.getElementById("mvPropAside").tagName + ":" + document.getElementById("mvPropAside").getAttribute("aria-label") }));
ok("10 semantics: amenities = ul/li list, times = dl, reserved column = labelled <aside>", a11y.ul === "UL" && a11y.lis === 20 && a11y.dl && a11y.aside === "ASIDE:Booking information", a11y);
await T.page.click("#mvPropGalleryAll"); await T.page.keyboard.press("Escape"); s = await T.info();
ok("11 photo viewer still opens/closes from the info-rich page; focus returns to Show all photos", s.focus === "mvPropGalleryAll", s.focus);
await T.done();

// ===== 12. Direct URLs, refresh, Back/Forward =====
T = await make(); await T.go("/property/603566?checkin=2026-12-20&checkout=2026-12-24&guests=2"); s = await T.info();
ok("12 direct URL with search params: info area renders; the dates sit in the reserved column (UX3 panel)", s.amen.length === 16 && s.aside.request === "Dec 20, 2026 → Dec 24, 2026", s.aside);
await T.page.reload(); await T.page.waitForSelector("#mvPropAmenities"); s = await T.info();
ok("12 refresh: same information", s.h1 === NAME_566 && s.amen.length === 16 && same(s.practical, [["Check-in", "From 3:00 PM"]]), s);
await T.page.click("#mvPropAmenitiesToggle");
await T.page.click("#mvPropBack"); await T.page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden")); s = await T.info();
ok("12 Back to results: search view with dates kept", s.appVisible && s.path === "/?checkin=2026-12-20&checkout=2026-12-24&guests=2", s.path);
await T.page.goBack(); await T.page.waitForSelector("#mvPropAmenities"); s = await T.info();
ok("12 browser Back: property page re-rendered (amenities collapsed again), focus on title", s.propVisible && s.amenVisible === 10 && s.focus === "mvPropTitle", s);
await T.page.goForward(); await T.page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden")); s = await T.info();
ok("12 browser Forward: results", s.appVisible && !s.propVisible, s);
ok("12 no page errors", T.errors.length === 0, T.errors);
await T.done();

// ===== 13-14. Search, modal, prices, network =====
T = await make(); await T.go("/");
const cards = await T.page.evaluate(() => [...document.querySelectorAll(".mv-card")].map((c) => ({ id: c.dataset.apartmentId, text: c.innerText })));
ok("13 search cards unchanged: 2 cards, no amenities or times added to them", cards.length === 2 && cards.every((c) => !/Swimming pool|Check-in|Air conditioning/.test(c.text)), cards);
await T.page.evaluate(() => { for (const [id, v] of [["mvCheckin", "2026-12-20"], ["mvCheckout", "2026-12-24"]]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); } });
await T.page.click('.mv-card[data-apartment-id="603566"] .mv-card__title'); await T.page.waitForSelector("#mvHostawayCalendarMonths .mv-cal__month");
await T.page.waitForFunction(() => !/checking availability/.test(document.getElementById("mvHostawaySelection").innerText));
const modal = await T.page.evaluate(() => ({ open: document.getElementById("mvModal").getAttribute("aria-hidden") === "false", path: location.pathname, titles: [...document.querySelectorAll("#mvHostawayCalendarMonths .mv-cal__title")].map((t) => t.textContent), sel: document.getElementById("mvHostawaySelection").innerText.split("\n")[0], amen: /Swimming pool|Amenities/.test(document.getElementById("mvModalContent").innerText) }));
ok("13 card click opens the original modal (N2 carry-over Dec 20 → Dec 24, URL unchanged, no info area inside)", modal.open && modal.path === "/" && same(modal.titles, ["December 2026", "January 2027"]) && /Dec 20 → Dec 24/.test(modal.sel) && !modal.amen, modal);
await T.page.click("#mvHostawayQuoteBtn"); await T.page.waitForFunction(() => /direct total/.test(document.getElementById("mvHostawayQuote").innerText));
ok("13 D4 quote unchanged (6,400 -> 5,760 estimated direct total)", /^5,760 MXN estimated direct total/.test(await T.page.evaluate(() => document.getElementById("mvHostawayQuote").innerText)));
await T.page.keyboard.press("Escape"); await T.page.waitForTimeout(80);
await T.page.evaluate(() => { for (const [id, v] of [["mvCheckin", "2026-12-24"], ["mvCheckout", "2026-12-31"]]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); } });
await T.page.click('.mv-card[data-apartment-id="603566"] .mv-card__title'); await T.page.waitForSelector("#mvHostawayCalendarMonths .mv-cal__month");
await T.page.waitForFunction(() => !/checking availability/.test(document.getElementById("mvHostawaySelection").innerText));
ok("13 Dec 24 → 31 on 603566 still refused in the modal (reservation boundary)", /not available|unavailable|booked/i.test(await T.page.evaluate(() => document.getElementById("mvHostawaySelection").innerText)));
await T.page.keyboard.press("Escape");
const pagesApi = T.api.slice();
T.api.length = 0;
await T.page.evaluate(() => { history.pushState({ mvFrom: "search" }, "", "/property/603564"); window.dispatchEvent(new PopStateEvent("popstate", { state: { mvFrom: "search" } })); }); await T.page.waitForSelector("#mvPropAmenities");
await T.page.waitForFunction(() => document.getElementById("mvPanel")?.dataset.state && document.getElementById("mvPanel").dataset.state !== "loading");
const panelCalls = T.api.slice(); T.api.length = 0;
await T.page.click("#mvPropAmenitiesToggle");
ok("14 property page: only the UX3 panel's stay check (+ quote if clear) for this property and stay; the amenity toggle makes no API calls", panelCalls.length >= 1 && panelCalls.length <= 2 && panelCalls.every((a) => /id=603564&from=2026-12-24&to=2026-12-31/.test(a)) && T.api.length === 0, { panelCalls, after: T.api });
ok("14 network: only proxy listings/calendar/quote; nothing else contacted", T.other.length === 0 && pagesApi.every((a) => /^\/api\/booking\/(listings|calendar|quote)(\?|$)/.test(a)), { other: T.other, api: pagesApi });
s = await T.info();
ok("14 no sensitive internals on the page (no raw keys, ids of other systems, 'null'/'undefined', JSON)", !/\{"|minNights|maxNights|checkInFrom|checkOutBy|listingId|hostaway-|undefined|\bnull\b/i.test(s.text), s.text.match(/\{"|minNights|maxNights|checkInFrom|checkOutBy|listingId|hostaway-|undefined|\bnull\b/i));
ok("13/14 no page errors", T.errors.length === 0, T.errors);
await T.done();

await browser.close(); server.close();
const names = Object.keys(results), pass = names.filter((n) => results[n] === "PASS").length;
console.log(JSON.stringify(results, null, 1)); console.log(`\n${pass}/${names.length} passed`); process.exit(failed ? 1 : 0);
