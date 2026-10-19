import test from "node:test";
import assert from "node:assert/strict";
import { extract } from "../lib/page-source.mjs";

const { resolveApiBase, PRODUCTION_API, DEV_API } = extract(["PRODUCTION_API", "DEV_API", "API_ENVIRONMENTS", "PROJECT_PREVIEW_HOST", "resolveApiBase"]);

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
