import test from "node:test";
import assert from "node:assert/strict";
import { extract } from "../lib/page-source.mjs";

const { toProperty, esc } = extract(["esc", "httpsUrl", "posInt", "MAX_GALLERY_IMAGES", "galleryUrls", "hhmm", "MAX_AMENITIES", "AMENITY_HOLD", "cleanAmenities", "toProperty"]);

test("toProperty keeps only validated public fields and never invents", () => {
  const good = toProperty({ id: 603564, slug: "hostaway-603564", name: "Hacienda 5 De Mayo", sleeps: 2, tagline: "1 BR • 1 Bath • Bucerías", summary: "Nice", img: "https://x/y.jpg", currency: "MXN", url: null, images: [{ url: "https://x/y.jpg" }], bedrooms: 1 });
  assert.deepEqual(Object.keys(good), ["id", "slug", "source", "name", "sleeps", "tagline", "summary", "img", "images", "currency", "url", "bedrooms", "bathrooms", "city", "beds", "amenities", "checkInFrom", "checkOutBy"]); // UX1 added the three facts the feed already sends; UX2b added images; UX2c the four information fields
  assert.deepEqual([good.bedrooms, good.bathrooms, good.city], [1, null, null]);
  assert.deepEqual((({ bedrooms, bathrooms, city }) => [bedrooms, bathrooms, city])(toProperty({ id: 1, name: "x", sleeps: 2, bedrooms: 0, bathrooms: 1.5, city: " Bucerías " })), [0, 1.5, "Bucerías"]);
  assert.deepEqual((({ bedrooms, bathrooms, city }) => [bedrooms, bathrooms, city])(toProperty({ id: 1, name: "x", sleeps: 2, bedrooms: -1, bathrooms: "1", city: 42 })), [null, null, null]);
  assert.equal(good.source, "hostaway"); assert.equal(good.url, null);
  assert.equal(toProperty({ id: "603564", name: "x", sleeps: 2 }), null);
  assert.equal(toProperty({ id: 1, name: "", sleeps: 2 }), null);
  assert.equal(toProperty({ id: 1, name: "x", sleeps: 0 }), null);
  assert.equal(toProperty(null), null); assert.equal(toProperty("x"), null);
  assert.equal(toProperty({ id: 1, name: "x", sleeps: 2, img: "http://insecure/a.jpg" }).img, null);
  assert.equal(toProperty({ id: 1, name: "x", sleeps: 2, img: "javascript:alert(1)" }).img, null);
  assert.equal(toProperty({ id: 1, name: "x", sleeps: 2 }).slug, "hostaway-1");
  assert.equal(toProperty({ id: 1, name: "x", sleeps: 2, tagline: 42, summary: null }).tagline, "");
});
test("UX2b images: card image first, feed order, https only, de-duplicated, capped at 12, never invented", () => {
  const P = (extra) => toProperty({ id: 1, name: "x", sleeps: 2, ...extra });
  assert.deepEqual(P({ img: "https://h/1.jpg", images: [{ url: "https://h/1.jpg" }, { url: "https://h/2.jpg" }, { url: "https://h/3.jpg" }] }).images, ["https://h/1.jpg", "https://h/2.jpg", "https://h/3.jpg"]);
  // malformed entries dropped, order kept; captions ignored (not part of the frontend model)
  assert.deepEqual(P({ img: "https://h/1.jpg", images: [null, "https://h/s.jpg", { url: "http://h/x.jpg" }, { url: "javascript:alert(1)" }, { url: "https://h/a b.jpg" }, { url: 7 }, { url: "https://h/2.jpg", caption: "c" }, [], { nope: 1 }] }).images, ["https://h/1.jpg", "https://h/2.jpg"]);
  // no images[] -> card image alone; nothing -> []
  assert.deepEqual(P({ img: "https://h/1.jpg" }).images, ["https://h/1.jpg"]);
  assert.deepEqual(P({}).images, []); assert.deepEqual(P({ images: "x" }).images, []); assert.deepEqual(P({ images: [] , img: "http://h/1.jpg" }).images, []);
  // bad card image but good gallery -> gallery only
  assert.deepEqual(P({ img: null, images: [{ url: "https://h/2.jpg" }] }).images, ["https://h/2.jpg"]);
  // duplicates removed, cap 12
  const many = Array.from({ length: 20 }, (_, i) => ({ url: `https://h/${i % 15}.jpg` }));
  const got = P({ img: "https://h/0.jpg", images: many }).images;
  assert.equal(got.length, 12); assert.equal(new Set(got).size, 12); assert.equal(got[0], "https://h/0.jpg");
});
test("UX2c information fields: validated, never defaulted, never inferred", () => {
  const P = (extra) => toProperty({ id: 1, name: "x", sleeps: 2, ...extra });
  const live = P({ beds: 1, checkInFrom: "15:00", checkOutBy: "12:00", amenities: ["Internet", "Wireless", "Swimming pool", "Beach", "Outdoor furniture"] });
  assert.deepEqual([live.beds, live.checkInFrom, live.checkOutBy], [1, "15:00", "12:00"]);
  assert.deepEqual(live.amenities, ["Internet", "Wireless", "Swimming pool", "Outdoor furniture"]); // "Beach" held pending owner wording
  const none = P({});
  assert.deepEqual([none.beds, none.amenities, none.checkInFrom, none.checkOutBy], [null, [], null, null]);
  for (const b of [0, -1, 1.5, "1", null, 51]) assert.equal(P({ beds: b }).beds, null, String(b));
  for (const v of ["3pm", "15:00:00", "24:00", "9:00", "", null, 1500, " 15:00"]) { assert.equal(P({ checkInFrom: v }).checkInFrom, null, String(v)); assert.equal(P({ checkOutBy: v }).checkOutBy, null, String(v)); }
  assert.equal(P({ checkOutBy: "00:30" }).checkOutBy, "00:30");
  assert.deepEqual(P({ amenities: "Pool" }).amenities, []); assert.deepEqual(P({ amenities: { a: 1 } }).amenities, []);
  assert.deepEqual(P({ amenities: [null, 7, "", " ", "x", "  Kitchen  ", "kitchen", "KITCHEN", "Air\n conditioning", "<b>TV</b>", "a\u0007b", "y".repeat(81), "BEACH", "TV"] }).amenities, ["Kitchen", "Air conditioning", "TV"]);
  assert.equal(P({ amenities: Array.from({ length: 80 }, (_, i) => `Item ${i}`) }).amenities.length, 60);
});
test("esc escapes HTML", () => { assert.equal(esc(`<b>"R&D"</b>`), "&lt;b&gt;&quot;R&amp;D&quot;&lt;/b&gt;"); });
