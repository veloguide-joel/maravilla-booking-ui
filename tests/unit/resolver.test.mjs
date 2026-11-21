import test from "node:test";
import assert from "node:assert/strict";
import { extract } from "../lib/page-source.mjs";

const { resolveApiBase, PRODUCTION_API, DEV_API, CATALOG_PREVIEW_API } = extract(["PRODUCTION_API", "DEV_API", "CATALOG_PREVIEW_API", "MICASA_API", "API_ENVIRONMENTS", "PROJECT_PREVIEW_HOST", "resolveApiBase"]);

test("API host mapping: production hosts, DEV/preview class, unknown hosts fail safe (B1 contract)", () => {
  assert.equal(PRODUCTION_API, "https://maravilla-smoobu-proxy.vercel.app");
  assert.equal(DEV_API, "https://maravilla-smoobu-proxy-git-dev-joel-goralskis-projects.vercel.app");
  const cases = [
    ["maravilla-booking-ui.vercel.app", PRODUCTION_API], ["www.maravillanayarit.com", PRODUCTION_API], ["maravillanayarit.com", PRODUCTION_API],
    ["maravilla-booking-ui-git-dev-joel-goralskis-projects.vercel.app", DEV_API],
    ["maravilla-booking-ui-git-featu-abc123-joel-goralskis-projects.vercel.app", DEV_API],
    ["maravilla-booking-ui-git-feature-227ea7-joel-goralskis-projects.vercel.app", DEV_API],
    ["localhost", DEV_API], ["127.0.0.1", DEV_API],
    ["maravilla-booking-ui-abc123-joel-goralskis-projects.vercel.app", null], // commit-hash preview is not the branch class
    ["evil.example", null], ["maravilla-booking-ui.vercel.app.evil.example", null],
    ["maravilla-booking-ui-git-dev-joel-goralskis-projects.vercel.app.evil.com", null],
    ["book.maravillanayarit.com", null], ["", null], ["MARAVILLA-BOOKING-UI.VERCEL.APP", null]
  ];
  for (const [h, e] of cases) assert.equal(resolveApiBase(h), e, h);
});

test("C89 exact catalog-preview host: ONLY the mcd-catalog UI alias targets the proxy e7-test preview; look-alikes keep their existing class", () => {
  assert.equal(CATALOG_PREVIEW_API, "https://maravilla-smoobu-proxy-git-e7-test-joel-goralskis-projects.vercel.app");
  const cases = [
    ["maravilla-booking-ui-git-mcd-catalog-joel-goralskis-projects.vercel.app", CATALOG_PREVIEW_API],
    ["maravilla-booking-ui-git-mcd-catalog2-joel-goralskis-projects.vercel.app", DEV_API],          // another branch alias: generic preview class, unchanged
    ["maravilla-booking-ui-git-mcd-cat-abc123-joel-goralskis-projects.vercel.app", DEV_API],         // truncated / hashed alias is NOT the exact host
    ["maravilla-booking-ui-git-mcd-catalog-joel-goralskis-projects.vercel.app.evil.com", null],
    ["MARAVILLA-BOOKING-UI-GIT-MCD-CATALOG-JOEL-GORALSKIS-PROJECTS.VERCEL.APP", null],
    ["maravilla-booking-ui.vercel.app", PRODUCTION_API], ["maravilla-booking-ui-git-dev-joel-goralskis-projects.vercel.app", DEV_API]
  ];
  for (const [h, e] of cases) assert.equal(resolveApiBase(h), e, h);
});

test("P4-2 Book now: checkout base only for the exact catalog-preview host; the link carries only validated values", () => {
  const x = extract(["PRODUCTION_API", "DEV_API", "CATALOG_PREVIEW_API", "MICASA_API", "CHECKOUT_ENVIRONMENTS", "resolveCheckoutBase", "checkoutUrl"]);
  assert.equal(x.resolveCheckoutBase("maravilla-booking-ui-git-mcd-catalog-joel-goralskis-projects.vercel.app"), x.CATALOG_PREVIEW_API);
  for (const h of ["maravilla-booking-ui.vercel.app", "www.maravillanayarit.com", "maravilla-booking-ui-git-dev-joel-goralskis-projects.vercel.app", "localhost", "evil.example", "",
    "maravilla-booking-ui-git-mcd-catalog-joel-goralskis-projects.vercel.app.evil.com"]) assert.equal(x.resolveCheckoutBase(h), null, h);
  const base = x.CATALOG_PREVIEW_API; const stay = { id: 606998, from: "2026-12-12", to: "2026-12-15", guests: 2, name: "Casa Uno & Dos" };
  assert.equal(x.checkoutUrl(base, stay), `${base}/checkout.html?listing=606998&from=2026-12-12&to=2026-12-15&guests=2&name=Casa+Uno+%26+Dos`);
  assert.equal(x.checkoutUrl(base, { ...stay, name: "<b>x" }), `${base}/checkout.html?listing=606998&from=2026-12-12&to=2026-12-15&guests=2`);
  for (const bad of [{ ...stay, id: 0 }, { ...stay, id: "6 OR 1" }, { ...stay, from: "12/12/2026" }, { ...stay, to: "2026-12-12" }, { ...stay, guests: 0 }, { ...stay, guests: 99 }, null]) assert.equal(x.checkoutUrl(base, bad), null);
  for (const b of [null, "", "http://insecure.example", "https://host/path", "javascript:alert(1)"]) assert.equal(x.checkoutUrl(b, stay), null, String(b));
});

test("P4-5 MiCasaDirect production hosts: API and checkout on book.micasadirect.com; look-alikes fail safe", () => {
  const x = extract(["PRODUCTION_API", "DEV_API", "CATALOG_PREVIEW_API", "MICASA_API", "API_ENVIRONMENTS", "PROJECT_PREVIEW_HOST", "resolveApiBase", "CHECKOUT_ENVIRONMENTS", "resolveCheckoutBase"]);
  assert.equal(x.MICASA_API, "https://book.micasadirect.com");
  for (const h of ["micasadirect.com", "www.micasadirect.com"]) { assert.equal(x.resolveApiBase(h), x.MICASA_API, h); assert.equal(x.resolveCheckoutBase(h), x.MICASA_API, h); }
  for (const h of ["book.micasadirect.com", "micasadirect.com.evil.example", "xmicasadirect.com", "MICASADIRECT.COM"]) { assert.equal(x.resolveApiBase(h), null, h); assert.equal(x.resolveCheckoutBase(h), null, h); }
});

