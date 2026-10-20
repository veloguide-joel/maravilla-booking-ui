// UX2b: property-page photo gallery (desktop mosaic, mobile carousel, full-screen viewer).
// Image fixtures mirror the live pilot inventory shape: 603564 = 12 photos, 603566 = 8 photos (https, feed order,
// no captions). Image bytes are a 1x1 PNG served locally; "broken" URLs answer 404. Nothing is fetched from the network.
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync } from "node:fs";
import { PAGE_PATH } from "../lib/page-source.mjs";
import { htmlFor, enableLegacyModal, openLegacyModal } from "../lib/modal-entry.mjs"; // UX7a: test-only legacy modal entry (see lib)
import { TODAY, PROXY, listings as baseListings, calendarFor, quoteFor, overlaps, nightsOf, PNG_1x1 } from "../fixtures/pilots.mjs";

const PAGE = readFileSync(PAGE_PATH, "utf8");
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost:5500");
  if (u.pathname === "/consumer/booking-test.html" || u.pathname === "/" || /^\/property\/[^/]+\/?$/.test(u.pathname)) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(htmlFor(req, PAGE)); return; }
  res.writeHead(404); res.end("not found");
});
await new Promise((r) => server.listen(5500, "localhost", r));
const results = {}; let failed = 0;
const ok = (name, cond, detail) => { results[name] = cond ? "PASS" : "FAIL " + JSON.stringify(detail); if (!cond) { failed++; console.log("FAIL", name, JSON.stringify(detail)); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const browser = await chromium.launch();

const A = Array.from({ length: 12 }, (_, i) => `https://example.com/603564/p${i}.jpg`);
const B = Array.from({ length: 8 }, (_, i) => `https://example.com/603566/p${i}.jpg`);
const pilot = (idx, urls, extra = {}) => ({ ...baseListings.listings[idx], img: urls[0] ?? null, images: urls.map((url) => ({ url })), ...extra });
const PILOTS = { ok: true, checkedAt: "2026-10-19T00:00:00Z", listings: [pilot(0, A), pilot(1, B)] };
const withImages = (img, images) => ({ ok: true, checkedAt: "x", listings: [{ ...baseListings.listings[0], img, images }, pilot(1, B)] });

async function make({ vp = { width: 1280, height: 900 }, body = PILOTS, reducedMotion = "reduce", legacyModal = false } = {}) {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion, hasTouch: vp.width < 768 });
  if (legacyModal) await enableLegacyModal(ctx);
  const FIXED = new Date(TODAY + "T12:00:00").getTime();
  await ctx.addInitScript((FIXED) => { const D = Date; class M extends D { constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); } static now() { return FIXED; } } window.Date = M; }, FIXED);
  const page = await ctx.newPage();
  const T = { page, api: [], imgs: [], other: [], errors: [] };
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
    if (u.hostname === "example.com") { T.imgs.push(u.href); if (/broken/.test(u.pathname)) return route.fulfill({ status: 404, body: "" }); return route.fulfill({ status: 200, contentType: "image/png", body: PNG_1x1 }); }
    if (u.hostname === "localhost") return route.continue();
    T.other.push(u.href); return route.abort();
  });
  T.go = async (path) => { await page.goto("http://localhost:5500" + path); await page.waitForFunction(() => document.querySelector(".mv-card") || document.querySelector("#mvPropertyView h1:not(:empty)") && !/Loading/.test(document.querySelector("#mvPropertyView h1").textContent), null, { timeout: 15000 }); await page.waitForTimeout(150); };
  T.gal = () => page.evaluate(() => {
    const g = document.getElementById("mvPropGallery"), tr = document.getElementById("mvPropGalleryTrack");
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom) }; };
    const vis = (el) => !!el && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden" && el.getBoundingClientRect().width > 0;
    const tiles = g ? [...g.querySelectorAll(".mv-gal__tile")] : [];
    const dupIds = (() => { const seen = new Map(); document.querySelectorAll("[id]").forEach((el) => seen.set(el.id, (seen.get(el.id) || 0) + 1)); return [...seen].filter(([, n]) => n > 1).map(([id]) => id); })();
    const all = document.getElementById("mvPropGalleryAll"), cnt = document.getElementById("mvPropGalleryCount"), pv = document.getElementById("mvPropGalleryPrev"), nx = document.getElementById("mvPropGalleryNext");
    const V = document.getElementById("mvGallery");
    return {
      present: !!g, count: g?.dataset.count ?? null, n: tiles.length,
      srcs: tiles.map((t) => t.querySelector("img")?.getAttribute("src")), alts: tiles.map((t) => t.querySelector("img")?.alt),
      loading: tiles.map((t) => t.querySelector("img")?.loading), visible: tiles.map(vis), rects: tiles.map(r), track: r(tr), gallery: r(g),
      heroClass: tiles.map((t) => t.querySelector("img")?.classList.contains("mv-prop__hero")),
      broken: tiles.map((t) => t.classList.contains("is-broken")), brokenLabels: tiles.filter((t) => t.classList.contains("is-broken")).map((t) => t.getAttribute("aria-label")),
      allText: all?.textContent ?? null, allVisible: vis(all), allRect: r(all), countText: cnt?.textContent ?? null, countVisible: vis(cnt), countRect: r(cnt),
      prevVisible: vis(pv), nextVisible: vis(nx), prevDisabled: pv?.disabled ?? null, nextDisabled: nx?.disabled ?? null,
      scroll: tr ? { sw: tr.scrollWidth, cw: tr.clientWidth, sl: Math.round(tr.scrollLeft) } : null,
      docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      placeholder: !!document.querySelector("#mvPropertyView .mv-prop__hero.mv-card__noimg"),
      placeholderLabel: document.querySelector("#mvPropertyView .mv-card__noimg")?.getAttribute("aria-label") ?? null,
      viewerOpen: !V.hidden && V.getAttribute("aria-hidden") === "false", htmlLocked: document.documentElement.classList.contains("mv-gallery-open"),
      propInert: document.getElementById("mvPropertyView").inert,
      focus: document.activeElement?.id || document.activeElement?.tagName, dupIds,
      modalOpen: document.getElementById("mvModal").getAttribute("aria-hidden") === "false",
      calOpen: document.getElementById("mvCalendarModal").getAttribute("aria-hidden") === "false",
      path: location.pathname + location.search, h1: document.querySelector("#mvPropertyView h1")?.textContent || null,
      propVisible: !document.getElementById("mvPropertyView").classList.contains("mv-view-hidden"),
      appVisible: !document.getElementById("mv-app").classList.contains("mv-view-hidden")
    };
  });
  T.viewer = () => page.evaluate(() => {
    const V = document.getElementById("mvGallery"), img = document.getElementById("mvGalleryImg");
    const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width) }; };
    return { open: !V.hidden, role: document.getElementById("mvGalleryPanel").getAttribute("role"), modal: document.getElementById("mvGalleryPanel").getAttribute("aria-modal"),
      title: document.getElementById("mvGalleryTitle").textContent, count: document.getElementById("mvGalleryCount").textContent, live: document.getElementById("mvGalleryLive").textContent,
      src: img.getAttribute("src"), alt: img.alt, imgHidden: img.hidden, error: !document.getElementById("mvGalleryError").hidden,
      prevDisabled: document.getElementById("mvGalleryPrev").disabled, nextDisabled: document.getElementById("mvGalleryNext").disabled,
      focus: document.activeElement?.id || document.activeElement?.tagName,
      rects: { close: r(document.getElementById("mvGalleryClose")), prev: r(document.getElementById("mvGalleryPrev")), next: r(document.getElementById("mvGalleryNext")), img: r(img) },
      vw: innerWidth, vh: innerHeight, docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  T.done = () => ctx.close();
  return T;
}

// ===== 1-3. Desktop mosaic: 603564 (12) and 603566 (8), primary/secondary images =====
let T = await make();
await T.go("/property/603564"); let g = await T.gal();
ok("1 603564: gallery present with all 12 photos in feed order", g.present && g.n === 12 && same(g.srcs, A), g.srcs);
ok("1 603564: accessible labels from verified name + position (no captions invented)", same(g.alts, A.map((_, i) => `Hacienda 5 De Mayo — photo ${i + 1} of 12`)), g.alts);
ok("3 primary = card image (img) with the UX1 hero hook; only it is eager, the rest lazy", g.srcs[0] === PILOTS.listings[0].img && same(g.heroClass, [true, ...Array(11).fill(false)]) && g.loading[0] === "eager" && g.loading.slice(1).every((l) => l === "lazy"), { h: g.heroClass, l: g.loading });
ok("3 desktop mosaic: photos 1-5 visible (primary + four), 6-12 not displayed", same(g.visible, [true, true, true, true, true, ...Array(7).fill(false)]) && g.count === "5", g.visible);
const [p0, p1, p2, p3, p4] = g.rects;
ok("3 layout: large primary on the left half spanning both rows; four supporting photos in a 2x2 block on the right", Math.abs(p0.w - (p1.w * 2 + 8)) <= 2 && Math.abs(p0.h - (p1.h * 2 + 8)) <= 2 && p1.x === p3.x && p2.x === p4.x && p1.y === p2.y && p3.y === p4.y && p1.x > p0.r && p2.r === g.track.r && p4.b === g.track.b, g.rects.slice(0, 5));
ok("2/3 size: gallery not oversized (height 270-460px at 1280px) and fills the content width", g.track.h >= 270 && g.track.h <= 460 && g.track.w >= 1000, g.track);
ok("3 Show all photos visible with count; mobile-only counter/arrows hidden on desktop", g.allVisible && g.allText === "Show all photos (12)" && !g.countVisible && !g.prevVisible && !g.nextVisible, g);
await T.page.waitForTimeout(400);
ok("5 performance: desktop loads only the five mosaic photos up front (6-12 not requested)", A.slice(0, 5).every((u) => T.imgs.includes(u)) && A.slice(5).every((u) => !T.imgs.includes(u)), T.imgs);
ok("13 property page keeps UX1 content: title, location, facts, booking-soon note", await T.page.evaluate(() => { const v = document.getElementById("mvPropertyView"); return v.querySelector("h1").textContent === "Hacienda 5 De Mayo" && /Bucerías, Nayarit, Mexico/.test(v.querySelector(".mv-prop__where").textContent) && v.querySelectorAll("#mvPropFacts .mv-pill").length === 3 && /opens soon/.test(v.querySelector(".mv-prop__note").textContent); }));
ok("6 no duplicate ids", g.dupIds.length === 0, g.dupIds);

await T.go("/property/603566"); g = await T.gal();
ok("2 603566: all 8 photos in feed order, labels 'of 8', mosaic of 5", g.n === 8 && same(g.srcs, B) && g.alts[7] === "East Side Studio — photo 8 of 8" && g.count === "5" && g.visible.filter(Boolean).length === 5 && g.allText === "Show all photos (8)", g);

// ===== 4-6, 9. Viewer: open, navigate, close, Escape, focus =====
await T.go("/property/603564"); T.api.length = 0;
const before = T.imgs.length;
await T.page.click("#mvPropGalleryAll"); await T.page.waitForTimeout(100); let v = await T.viewer(); g = await T.gal();
ok("4 Show all photos opens the viewer: dialog, aria-modal, title, 1 / 12, live label, first photo", v.open && v.role === "dialog" && v.modal === "true" && v.title === "Hacienda 5 De Mayo" && v.count === "1 / 12" && v.live === "Photo 1 of 12" && v.src === A[0] && v.alt === "Hacienda 5 De Mayo — photo 1 of 12", v);
ok("4 viewer: focus on Close, page behind is inert and scroll-locked, Previous disabled at photo 1", v.focus === "mvGalleryClose" && g.propInert && g.htmlLocked && v.prevDisabled && !v.nextDisabled, { f: v.focus, g: [g.propInert, g.htmlLocked] });
ok("5 viewer warms only the next photo (not the whole set)", T.imgs.slice(before).every((u) => u === A[0] || u === A[1]), T.imgs.slice(before));
const seen = [v.src];
for (let i = 0; i < 11; i++) { await T.page.click("#mvGalleryNext"); seen.push((await T.viewer()).src); }
v = await T.viewer();
ok("5 Next steps through all 12 photos in order; 12 / 12 disables Next", same(seen, A) && v.count === "12 / 12" && v.nextDisabled && !v.prevDisabled, { seen, v: v.count });
ok("9 focus never lost when Next becomes disabled (moves to Previous)", v.focus === "mvGalleryPrev", v.focus);
await T.page.click("#mvGalleryPrev"); v = await T.viewer(); ok("5 Previous goes back (11 / 12)", v.count === "11 / 12" && v.src === A[10], v.count);
await T.page.keyboard.press("Home"); v = await T.viewer(); ok("9 Home -> 1 / 12", v.count === "1 / 12", v.count);
await T.page.keyboard.press("ArrowRight"); await T.page.keyboard.press("ArrowRight"); v = await T.viewer(); ok("9 ArrowRight x2 -> 3 / 12", v.count === "3 / 12" && v.src === A[2], v.count);
await T.page.keyboard.press("ArrowLeft"); v = await T.viewer(); ok("9 ArrowLeft -> 2 / 12", v.count === "2 / 12", v.count);
await T.page.keyboard.press("End"); v = await T.viewer(); ok("9 End -> 12 / 12", v.count === "12 / 12", v.count);
await T.page.keyboard.press("ArrowRight"); v = await T.viewer(); ok("5 no wrap past the last photo", v.count === "12 / 12", v.count);
// Tab trap
await T.page.keyboard.press("Home"); await T.page.focus("#mvGalleryClose");
const tabSeq = []; for (let i = 0; i < 4; i++) { await T.page.keyboard.press("Tab"); tabSeq.push(await T.page.evaluate(() => document.activeElement.id)); }
ok("9 Tab stays inside the viewer (Close <-> Next; Previous disabled at 1)", tabSeq.every((id) => ["mvGalleryClose", "mvGalleryNext"].includes(id)), tabSeq);
await T.page.keyboard.press("Shift+Tab"); ok("9 Shift+Tab also stays inside", ["mvGalleryClose", "mvGalleryNext"].includes(await T.page.evaluate(() => document.activeElement.id)));
const urlBefore = await T.page.evaluate(() => location.href);
await T.page.keyboard.press("Escape"); await T.page.waitForTimeout(80); g = await T.gal();
ok("6 Escape closes the viewer, restores focus to Show all photos, unlocks scroll, page interactive", !g.viewerOpen && g.focus === "mvPropGalleryAll" && !g.htmlLocked && !g.propInert, g);
ok("6 Escape in the viewer does not touch the search calendar / booking modal / URL", !g.modalOpen && !g.calOpen && (await T.page.evaluate(() => location.href)) === urlBefore);
await T.page.click("#mvPropGalleryAll"); await T.page.click("#mvGalleryClose"); g = await T.gal();
ok("6 Close button closes and restores focus", !g.viewerOpen && g.focus === "mvPropGalleryAll", g.focus);
await T.page.click('#mvPropGalleryTrack .mv-gal__tile[data-index="3"]'); v = await T.viewer();
ok("4 clicking a mosaic photo opens the viewer at that photo (4 / 12)", v.open && v.count === "4 / 12" && v.src === A[3], v.count);
await T.page.keyboard.press("Escape"); g = await T.gal();
ok("6 after opening from a photo, focus returns to the gallery's Show all photos control", g.focus === "mvPropGalleryAll", g.focus);
ok("15 viewer use made no API calls", T.api.length === 0, T.api);
ok("no page errors (desktop)", T.errors.length === 0, T.errors);
await T.done();

// ===== 9. Keyboard-only path from the title =====
T = await make(); await T.go("/property/603566");
const order = []; for (let i = 0; i < 4; i++) { await T.page.keyboard.press("Tab"); order.push(await T.page.evaluate(() => document.activeElement.id || document.activeElement.className)); }
ok("9 keyboard: Tab from the property title reaches Save (UX7b2) then Show all photos (photos are not extra tab stops)", order[0] === "mvPropSave" && order[1] === "mvPropGalleryAll", order);
await T.page.focus("#mvPropGalleryAll"); await T.page.keyboard.press("Enter"); v = await T.viewer();
ok("9 Enter on Show all photos opens the viewer focused on Close", v.open && v.focus === "mvGalleryClose" && v.count === "1 / 8", v);
await T.page.keyboard.press("Escape"); g = await T.gal(); ok("9 Escape returns focus to Show all photos", g.focus === "mvPropGalleryAll" && !g.viewerOpen, g.focus);
await T.done();

// ===== 7. Missing, malformed and broken images =====
const MIX = [
  { url: "https://example.com/603564/p0.jpg" }, { url: "http://example.com/insecure.jpg" }, "https://example.com/string.jpg", null, { url: "javascript:alert(1)" },
  { url: "https://example.com/603564/broken-1.jpg" }, { url: "https://example.com/603564/p2.jpg", caption: "Invented-looking caption" }, { url: 42 }, { url: "https://example.com/603564/p0.jpg" }
];
T = await make({ body: withImages("https://example.com/603564/p0.jpg", MIX) }); await T.go("/property/603564"); await T.page.waitForTimeout(400); g = await T.gal();
ok("7 malformed / insecure / duplicate entries dropped; valid order kept", same(g.srcs, ["https://example.com/603564/p0.jpg", "https://example.com/603564/broken-1.jpg", "https://example.com/603564/p2.jpg"]) && g.count === "3", g.srcs);
ok("7 captions are never displayed or used as labels", same(g.alts, [1, 2, 3].map((i) => `Hacienda 5 De Mayo — photo ${i} of 3`)) && !(await T.page.evaluate(() => document.body.innerText.includes("Invented-looking caption"))), g.alts);
ok("7 broken photo: tile kept in place with 'Photo unavailable' and an accessible label; others unaffected", same(g.broken, [false, true, false]) && /photo 2 of 3 \(photo unavailable\)/.test(g.brokenLabels[0] || "") && (await T.page.evaluate(() => document.querySelector(".mv-gal__tile.is-broken").innerText)) === "Photo unavailable", g);
ok("7 broken tile does not shift the layout (mosaic of 3 keeps its cells)", g.rects[1].w > 0 && g.rects[1].h > 0 && Math.abs(g.rects[1].h - g.rects[2].h) <= 1, g.rects);
await T.page.click("#mvPropGalleryAll"); await T.page.click("#mvGalleryNext"); await T.page.waitForTimeout(250); v = await T.viewer();
ok("7 viewer on a broken photo: clear message, image hidden, navigation still works", v.count === "2 / 3" && v.error && v.imgHidden && !v.nextDisabled, v);
await T.page.click("#mvGalleryNext"); await T.page.waitForTimeout(150); v = await T.viewer();
ok("7 next photo after a broken one displays normally", v.count === "3 / 3" && !v.error && !v.imgHidden && v.src === "https://example.com/603564/p2.jpg", v);
await T.page.keyboard.press("Escape");
ok("7 no page errors with broken/malformed images", T.errors.length === 0, T.errors);
await T.done();
// broken PRIMARY image
T = await make({ body: withImages("https://example.com/603564/broken-hero.jpg", [{ url: "https://example.com/603564/broken-hero.jpg" }, { url: A[1] }, { url: A[2] }]) });
await T.go("/property/603564"); await T.page.waitForTimeout(400); g = await T.gal();
ok("7 broken primary photo: placeholder text in the large cell; Show all photos still works", g.broken[0] && !g.broken[1] && g.allVisible, g);
await T.page.click("#mvPropGalleryAll"); await T.page.waitForTimeout(250); v = await T.viewer(); ok("7 viewer opens on the broken primary with the error message", v.open && v.error && v.count === "1 / 3", v);
await T.page.keyboard.press("Escape"); await T.done();

// ===== 8. Empty and reduced image arrays =====
for (const [label, img, images] of [["no images and no img", null, []], ["images not an array", null, "nope"], ["only malformed entries", "http://x/insecure.jpg", [{ url: "ftp://x" }, { url: "" }]]]) {
  T = await make({ body: withImages(img, images) }); await T.go("/property/603564"); g = await T.gal();
  ok(`8 ${label}: neutral 'No photo available' placeholder, no gallery, no Show all photos, no errors`, !g.present && g.placeholder && g.placeholderLabel === "No photo available" && g.allText === null && T.errors.length === 0, g);
  await T.done();
}
T = await make({ body: withImages(A[0], []) }); await T.go("/property/603564"); g = await T.gal();
ok("8 img only (no images[]): single-photo gallery from the card image", g.n === 1 && g.srcs[0] === A[0] && g.count === "1", g);
await T.done();
const layouts = {};
for (const k of [1, 2, 3, 4]) {
  T = await make({ body: withImages(A[0], A.slice(0, k).map((url) => ({ url }))) }); await T.go("/property/603564"); g = await T.gal(); layouts[k] = g;
  const tr = g.track, rs = g.rects;
  const fills = Math.max(...rs.map((r) => r.r)) === tr.r && Math.max(...rs.map((r) => r.b)) === tr.b && rs[0].x === tr.x && rs[0].y === tr.y;
  let shape = false;
  if (k === 1) shape = rs[0].w === tr.w && rs[0].h === tr.h;
  if (k === 2) shape = Math.abs(rs[0].w - rs[1].w) <= 1 && rs[0].h === tr.h && rs[1].h === tr.h;
  if (k === 3) shape = rs[0].h === tr.h && rs[1].x === rs[2].x && rs[1].w === rs[2].w && rs[2].y > rs[1].y;
  if (k === 4) shape = rs[0].h === tr.h && rs[1].w > rs[2].w && rs[2].y === rs[3].y && rs[3].r === tr.r;
  ok(`8 ${k} photo${k > 1 ? "s" : ""}: adapted mosaic fills the frame with no empty cells`, g.count === String(k) && g.n === k && fills && shape, { tr, rs });
  if (k === 1) {
    ok("8 1 photo: smaller frame (no oversized container); Show all photos without a count", tr.h <= 430 && g.allText === "Show all photos", { h: tr.h, t: g.allText });
    await T.page.click("#mvPropGalleryAll"); v = await T.viewer();
    ok("8 1 photo viewer: 1 / 1, both arrows disabled, focus on Close; Tab stays on Close", v.count === "1 / 1" && v.prevDisabled && v.nextDisabled && v.focus === "mvGalleryClose", v);
    await T.page.keyboard.press("Tab"); ok("8 1 photo viewer: Tab keeps focus on Close", (await T.page.evaluate(() => document.activeElement.id)) === "mvGalleryClose");
    await T.page.keyboard.press("Escape");
  }
  await T.done();
}

// ===== 10. Mobile: 390px and 320px =====
for (const vp of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
  T = await make({ vp }); await T.go("/property/603564"); g = await T.gal();
  const tile0 = g.rects[0];
  ok(`10 ${vp.width}px: carousel replaces the mosaic — one large photo per slide, swipeable track, no page overflow`, !g.docOverflow && g.scroll.sw > g.scroll.cw * 11 && Math.abs(tile0.w - g.track.w) <= 1 && tile0.r <= vp.width && Math.abs(tile0.h - Math.round(tile0.w * 3 / 4)) <= 2, { g: g.scroll, tile0, of: g.docOverflow });
  ok(`10 ${vp.width}px: all 12 slides displayable (no hidden extras), counter 1 / 12, Previous hidden, Next shown`, g.visible.filter(Boolean).length >= 1 && g.countVisible && g.countText === "1 / 12" && !g.prevVisible && g.nextVisible && (await T.page.evaluate(() => [...document.querySelectorAll(".mv-gal__tile")].every((t) => getComputedStyle(t).display !== "none"))), g);
  const ov = (a, b) => a && b && !(a.r <= b.x || b.r <= a.x || a.b <= b.y || b.b <= a.y);
  ok(`10 ${vp.width}px: 'Show all photos' and the counter both visible and not overlapping`, g.allVisible && !ov(g.allRect, g.countRect) && g.allRect.x >= g.track.x && g.countRect.r <= g.track.r, { a: g.allRect, c: g.countRect });
  await T.page.click("#mvPropGalleryNext"); await T.page.waitForTimeout(200); g = await T.gal();
  ok(`10 ${vp.width}px: Next moves one slide; counter 2 / 12; Previous appears`, g.countText === "2 / 12" && g.scroll.sl === g.scroll.cw && g.prevVisible, g);
  await T.page.evaluate(() => { const t = document.getElementById("mvPropGalleryTrack"); t.scrollLeft = t.clientWidth * 6; }); await T.page.waitForTimeout(200); g = await T.gal();
  ok(`10 ${vp.width}px: swiping (scroll) updates the counter (7 / 12)`, g.countText === "7 / 12", g.countText);
  await T.page.click("#mvPropGalleryAll"); await T.page.waitForTimeout(100); v = await T.viewer();
  ok(`10 ${vp.width}px: Show all photos opens the viewer at the current slide (7 / 12)`, v.open && v.count === "7 / 12" && v.src === A[6], v.count);
  const inside = (r) => r.x >= 0 && r.r <= v.vw && r.y >= 0 && r.b <= v.vh;
  ok(`10 ${vp.width}px: viewer controls and photo fit the screen (no overflow)`, inside(v.rects.close) && inside(v.rects.prev) && inside(v.rects.next) && v.rects.img.r <= v.vw && !v.docOverflow, v.rects);
  // touch swipe in the viewer
  const sw = async (x0, x1) => { await T.page.evaluate(([x0, x1]) => { const st = document.getElementById("mvGalleryStage"); const y = st.getBoundingClientRect().top + 100; const o = { pointerType: "touch", bubbles: true, isPrimary: true, pointerId: 7 }; st.dispatchEvent(new PointerEvent("pointerdown", { ...o, clientX: x0, clientY: y })); st.dispatchEvent(new PointerEvent("pointerup", { ...o, clientX: x1, clientY: y + 5 })); }, [x0, x1]); };
  await sw(260, 80); v = await T.viewer(); ok(`10 ${vp.width}px: swipe left in the viewer -> next photo (8 / 12)`, v.count === "8 / 12", v.count);
  await sw(80, 260); v = await T.viewer(); ok(`10 ${vp.width}px: swipe right -> previous photo (7 / 12)`, v.count === "7 / 12", v.count);
  await sw(150, 170); v = await T.viewer(); ok(`10 ${vp.width}px: small movement is not a swipe`, v.count === "7 / 12", v.count);
  await T.page.click("#mvGalleryClose"); g = await T.gal();
  ok(`10 ${vp.width}px: closing returns focus to Show all photos; no page overflow`, !g.viewerOpen && g.focus === "mvPropGalleryAll" && !g.docOverflow, g.focus);
  ok(`10 ${vp.width}px: no page errors`, T.errors.length === 0, T.errors);
  await T.done();
}
T = await make({ vp: { width: 390, height: 844 } }); await T.go("/property/603566"); g = await T.gal();
ok("10 390px 603566: 8 slides, counter 1 / 8", g.n === 8 && g.countText === "1 / 8" && g.scroll.sw > g.scroll.cw * 7, g);
await T.page.evaluate(() => { const t = document.getElementById("mvPropGalleryTrack"); t.scrollLeft = t.scrollWidth; }); await T.page.waitForTimeout(200); g = await T.gal();
ok("10 390px: last slide 8 / 8 hides Next", g.countText === "8 / 8" && !g.nextVisible && g.nextDisabled, g);
await T.done();

// ===== 11-12. Direct URL, refresh, Back/Forward =====
T = await make(); await T.go("/property/603564?checkin=2026-12-20&checkout=2026-12-24&guests=2"); g = await T.gal();
ok("11 direct URL with search params: gallery renders (12) with the booking panel showing the dates (UX3 replaced the request line)", g.n === 12 && (await T.page.evaluate(() => document.getElementById("mvPanelCheckin")?.textContent)) === "Dec 20, 2026", g.n);
await T.page.click("#mvPropGalleryAll"); await T.page.reload(); await T.page.waitForSelector("#mvPropGallery"); await T.page.waitForTimeout(150); g = await T.gal();
ok("11 refresh: gallery rebuilt, viewer closed, page not scroll-locked", g.n === 12 && !g.viewerOpen && !g.htmlLocked && !g.propInert, g);
await T.page.click("#mvPropBack"); await T.page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden"));
await T.page.goBack(); await T.page.waitForSelector("#mvPropGallery"); g = await T.gal();
ok("12 Back from results returns to the property page with its gallery", g.propVisible && g.n === 12 && g.h1 === "Hacienda 5 De Mayo", g);
await T.page.click("#mvPropGalleryAll"); await T.page.click("#mvGalleryNext");
await T.page.goForward(); await T.page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden")); await T.page.waitForTimeout(100); g = await T.gal();
ok("12 Forward while the viewer is open: results shown, viewer closed, scroll lock released, nothing inert", g.appVisible && !g.propVisible && !g.viewerOpen && !g.htmlLocked && !g.propInert, g);
await T.page.goBack(); await T.page.waitForSelector("#mvPropGallery"); g = await T.gal();
ok("12 Back again: property page with a fresh gallery, viewer closed, focus on title", g.propVisible && g.n === 12 && !g.viewerOpen && g.focus === "mvPropTitle", g);
ok("11/12 no page errors", T.errors.length === 0, T.errors);
await T.done();

// ===== 13-15. Search page, cards, LEGACY modal (test hook), booking flow and network =====
T = await make({ legacyModal: true }); await T.go("/"); g = await T.gal();
const cards = await T.page.evaluate(() => [...document.querySelectorAll(".mv-card")].map((c) => ({ id: c.dataset.apartmentId, img: c.querySelector("img")?.getAttribute("src") || null })));
ok("13 search page: 2 cards with the primary image only; no gallery or viewer visible", same(cards, [{ id: "603564", img: A[0] }, { id: "603566", img: B[0] }]) && !g.present && !g.viewerOpen, cards);
ok("5 search page loads only the two card images (gallery photos untouched)", T.imgs.every((u) => u === A[0] || u === B[0]), T.imgs);
await T.page.evaluate(() => { for (const [id, v] of [["mvCheckin", "2026-12-20"], ["mvCheckout", "2026-12-24"]]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); } });
await openLegacyModal(T.page, "603566"); /* UX7a: legacy modal via test hook (was a card-title click) */ await T.page.waitForSelector("#mvHostawayCalendarMonths .mv-cal__month");
await T.page.waitForFunction(() => !/checking availability/.test(document.getElementById("mvHostawaySelection").innerText));
const modal = await T.page.evaluate(() => ({ open: document.getElementById("mvModal").getAttribute("aria-hidden") === "false", path: location.pathname, img: document.querySelector("#mvModalContent img")?.getAttribute("src") || null, titles: [...document.querySelectorAll("#mvHostawayCalendarMonths .mv-cal__title")].map((t) => t.textContent), sel: document.getElementById("mvHostawaySelection").innerText.split("\n")[0], gallery: !!document.querySelector("#mvModal .mv-gal") }));
ok("13 LEGACY modal (test hook): same image, N2 carry-over, URL unchanged, no gallery inside", modal.open && modal.path === "/" && modal.img === B[0] && same(modal.titles, ["December 2026", "January 2027"]) && /Dec 20 → Dec 24/.test(modal.sel) && !modal.gallery, modal);
await T.page.click("#mvHostawayQuoteBtn"); await T.page.waitForFunction(() => /direct total/.test(document.getElementById("mvHostawayQuote").innerText));
ok("14 D4 quote in the modal unchanged (6,400 -> 5,760 estimated direct total)", /^5,760 MXN estimated direct total/.test(await T.page.evaluate(() => document.getElementById("mvHostawayQuote").innerText)));
await T.page.keyboard.press("Escape"); await T.page.waitForTimeout(80);
ok("14 Escape still closes the booking modal", !(await T.gal()).modalOpen);
ok("14 search calendar opens/closes as before (Escape)", await (async () => { await T.page.click("#mvDatesBtn"); await T.page.waitForTimeout(80); const o = (await T.gal()).calOpen; await T.page.keyboard.press("Escape"); await T.page.waitForTimeout(80); return o && !(await T.gal()).calOpen; })());
// go to a property page in the same document, use the viewer, come back, booking still works
await T.page.evaluate(() => { history.pushState({ mvFrom: "search" }, "", "/property/603564"); window.dispatchEvent(new PopStateEvent("popstate", { state: { mvFrom: "search" } })); }); await T.page.waitForSelector("#mvPropGallery");
await T.page.click("#mvPropGalleryAll"); await T.page.keyboard.press("ArrowRight"); await T.page.keyboard.press("Escape");
g = await T.gal(); ok("6/13 viewer + booking modal never open together; no duplicate ids with both views built", !g.modalOpen && !g.viewerOpen && g.dupIds.length === 0, g);
await T.page.click("#mvPropBack"); await T.page.waitForFunction(() => !document.getElementById("mv-app").classList.contains("mv-view-hidden"));
await openLegacyModal(T.page, "603566"); /* UX7a: legacy modal via test hook (was a card-title click) */ await T.page.waitForSelector("#mvHostawayCalendarMonths .mv-cal__month");
await T.page.click("#mvHostawayQuoteBtn").catch(() => {}); await T.page.waitForFunction(() => /direct total/.test(document.getElementById("mvHostawayQuote").innerText), null, { timeout: 8000 }).catch(() => {});
ok("14 after using the gallery, the modal quote still works (5,760)", /^5,760 MXN estimated direct total/.test(await T.page.evaluate(() => document.getElementById("mvHostawayQuote").innerText)));
ok("15 network: only the proxy (listings/calendar/quote) and image hosts; nothing else", T.other.length === 0 && T.api.every((a) => /^\/api\/booking\/(listings|calendar|quote)(\?|$)/.test(a)), { other: T.other, api: T.api });
ok("15 no hold/reservation/checkout/payment calls", !T.api.some((a) => /hold|reserv|checkout|pay|stripe|smoobu/i.test(a)), T.api);
ok("13/14 no page errors", T.errors.length === 0, T.errors);
await T.done();

await browser.close(); server.close();
const names = Object.keys(results), pass = names.filter((n) => results[n] === "PASS").length;
console.log(JSON.stringify(results, null, 1)); console.log(`\n${pass}/${names.length} passed`); process.exit(failed ? 1 : 0);
