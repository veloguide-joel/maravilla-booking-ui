import test from "node:test";
import assert from "node:assert/strict";
import { extract } from "../lib/page-source.mjs";

const { toProperty, esc } = extract(["esc", "httpsUrl", "posInt", "toProperty"]);

test("toProperty keeps only validated public fields and never invents", () => {
  const good = toProperty({ id: 603564, slug: "hostaway-603564", name: "Hacienda 5 De Mayo", sleeps: 2, tagline: "1 BR • 1 Bath • Bucerías", summary: "Nice", img: "https://x/y.jpg", currency: "MXN", url: null, images: [{ url: "https://x/y.jpg" }], bedrooms: 1 });
  assert.deepEqual(Object.keys(good), ["id", "slug", "source", "name", "sleeps", "tagline", "summary", "img", "currency", "url", "bedrooms", "bathrooms", "city"]); // UX1 added the three facts the feed already sends
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
test("esc escapes HTML", () => { assert.equal(esc(`<b>"R&D"</b>`), "&lt;b&gt;&quot;R&amp;D&quot;&lt;/b&gt;"); });
