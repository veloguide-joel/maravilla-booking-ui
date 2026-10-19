import test from "node:test";
import assert from "node:assert/strict";
import { extract } from "../lib/page-source.mjs";

const { toProperty, esc } = extract(["esc", "httpsUrl", "posInt", "MAX_GALLERY_IMAGES", "galleryUrls", "toProperty"]);

test("toProperty keeps only validated public fields and never invents", () => {
  const good = toProperty({ id: 603564, slug: "hostaway-603564", name: "Hacienda 5 De Mayo", sleeps: 2, tagline: "1 BR • 1 Bath • Bucerías", summary: "Nice", img: "https://x/y.jpg", currency: "MXN", url: null, images: [{ url: "https://x/y.jpg" }], bedrooms: 1 });
  assert.deepEqual(Object.keys(good), ["id", "slug", "source", "name", "sleeps", "tagline", "summary", "img", "images", "currency", "url", "bedrooms", "bathrooms", "city"]); // UX1 added the three facts the feed already sends; UX2b added images
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
test("esc escapes HTML", () => { assert.equal(esc(`<b>"R&D"</b>`), "&lt;b&gt;&quot;R&amp;D&quot;&lt;/b&gt;"); });
