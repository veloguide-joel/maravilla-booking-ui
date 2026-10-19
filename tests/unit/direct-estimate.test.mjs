import test from "node:test";
import assert from "node:assert/strict";
import { extract } from "../lib/page-source.mjs";

// D4: the browser only checks the server's figures for consistency; it never computes a discount.
const { parseDirectEstimate, parseQuoteResponse } = extract(["nightsSpan", "QUOTE_DECISIONS", "UNCONFIRMED", "isMoney", "fmtMoney", "parseQuoteResponse", "toCents", "parseDirectEstimate"]);
const quote = { currency: "MXN", total: 10080 };
const ok = { estimate: true, status: "estimated", currency: "MXN", standardTotal: 10080, eligibleAccommodation: 10080, discount: 1008, estimatedTotal: 9072, policyVersion: "direct-v1", rateBps: 1000, note: "n" };

test("a consistent server estimate is accepted as-is", () => {
  const d = parseDirectEstimate(ok, quote);
  assert.deepEqual(d, { status: "estimated", currency: "MXN", standardTotal: 10080, discount: 1008, estimatedTotal: 9072, policyVersion: "direct-v1", rateBps: 1000 });
});
test("estimate_unavailable keeps the standard quote with a reason", () => {
  assert.deepEqual(parseDirectEstimate({ estimate: true, status: "estimate_unavailable", reason: "TAX_POLICY_UNRESOLVED", currency: "MXN", note: "n" }, quote), { status: "estimate_unavailable", reason: "TAX_POLICY_UNRESOLVED" });
  assert.equal(parseDirectEstimate({ estimate: true, status: "estimate_unavailable", reason: "X", currency: "USD" }, quote), null);
});
test("missing, malformed or inconsistent objects are ignored (standard price only)", () => {
  const bad = [undefined, null, [1], { ...ok, estimate: false }, { ...ok, status: "approved" }, { ...ok, currency: "USD" }, { ...ok, estimatedTotal: "9072" }, { ...ok, estimatedTotal: 9000 },
    { ...ok, standardTotal: 10081, estimatedTotal: 9073 }, { ...ok, eligibleAccommodation: 100 }, { ...ok, discount: -1008, estimatedTotal: 11088 }, { ...ok, rateBps: 99999 }, { ...ok, rateBps: "1000" },
    { ...ok, policyVersion: "" }, { ...ok, discount: 0, estimatedTotal: 10080 }];
  for (const b of bad) assert.equal(parseDirectEstimate(b, quote), null, JSON.stringify(b));
});
test("the quote parser attaches direct only on quoted results", () => {
  const q = { ok: true, available: true, decision: "quoted", listingId: 603566, from: "2026-11-01", to: "2026-11-08", nights: 7, guests: 2, currency: "MXN", total: 10080, nightlyAverage: 1440, breakdown: [{ type: "accommodation", label: "Accommodation", total: 11200 }, { type: "discount", label: "Weekly discount", total: -1120 }], checkedAt: "x", direct: ok };
  const req = { id: 603566, from: "2026-11-01", to: "2026-11-08", guests: 2 };
  assert.equal(parseQuoteResponse(q, req).direct.estimatedTotal, 9072);
  assert.equal(parseQuoteResponse({ ...q, direct: { ...ok, currency: "USD" } }, req).direct, null);
  const unav = parseQuoteResponse({ ...q, available: false, decision: "unavailable", reasons: [{ code: "NIGHT_UNAVAILABLE", message: "x" }] }, req);
  assert.equal(unav.state, "unavailable"); assert.equal("direct" in unav, false);
});
