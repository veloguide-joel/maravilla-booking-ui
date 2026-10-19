import test from "node:test";
import assert from "node:assert/strict";
import { extract } from "../lib/page-source.mjs";

const { parseQuoteResponse, fmtMoney } = extract(["nightsSpan", "QUOTE_DECISIONS", "UNCONFIRMED", "isMoney", "fmtMoney", "parseQuoteResponse", "toCents", "parseDirectEstimate"]);
const req = { id: 603564, from: "2026-11-16", to: "2026-11-19", guests: 2 };
const quoted = { ok: true, available: true, decision: "quoted", listingId: 603564, from: "2026-11-16", to: "2026-11-19", nights: 3, guests: 2, currency: "MXN", total: 6600, nightlyAverage: 2200, breakdown: [{ type: "accommodation", label: "Accommodation", total: 6600 }], checkedAt: "2026-10-17T14:37:00Z", quoteBasis: "hostaway.priceDetails.v2", note: "Quote only. no inventory is held" };

test("live F3 shapes parse as quoted", () => {
  let r = parseQuoteResponse(quoted, req); assert.equal(r.state, "quoted"); assert.equal(r.total, 6600); assert.equal(r.currency, "MXN"); assert.equal(r.breakdown.length, 1); assert.equal(r.direct, null);
  r = parseQuoteResponse({ ...quoted, listingId: 603566, from: "2026-11-20", to: "2026-11-27", nights: 7, total: 10080, nightlyAverage: 1440, breakdown: [{ type: "accommodation", label: "Accommodation", total: 11200 }, { type: "discount", label: "Weekly discount", total: -1120 }] }, { id: 603566, from: "2026-11-20", to: "2026-11-27", guests: 2 }); assert.equal(r.state, "quoted"); assert.equal(r.total, 10080);
  r = parseQuoteResponse({ ...quoted, from: "2026-11-20", to: "2026-12-20", nights: 30, total: 52800, nightlyAverage: 1760, breakdown: [{ type: "accommodation", label: "Accommodation", total: 66000 }, { type: "discount", label: "Monthly discount", total: -13200 }] }, { id: 603564, from: "2026-11-20", to: "2026-12-20", guests: 2 }); assert.equal(r.state, "quoted");
  r = parseQuoteResponse({ ...quoted, listingId: 603566, from: "2026-11-20", to: "2026-11-21", nights: 1, total: 1600, nightlyAverage: 1600, breakdown: [{ type: "accommodation", label: "Accommodation", total: 1600 }] }, { id: 603566, from: "2026-11-20", to: "2026-11-21", guests: 2 }); assert.equal(r.state, "quoted");
});
test("unavailable and backend-unconfirmed carry no price", () => {
  const unav = { ok: true, available: false, decision: "unavailable", listingId: 603564, from: "2026-11-16", to: "2026-11-19", nights: 3, guests: 3, currency: "MXN", reasons: [{ code: "CAPACITY_EXCEEDED", message: "This property sleeps fewer guests than selected.", maxGuests: 2 }], checkedAt: "x" };
  let r = parseQuoteResponse(unav, { ...req, guests: 3 }); assert.equal(r.state, "unavailable"); assert.equal(r.reasons[0].code, "CAPACITY_EXCEEDED"); assert.equal("total" in r, false);
  r = parseQuoteResponse({ ...unav, decision: "unconfirmed", reasons: [{ code: "CALENDAR_INCOMPLETE", message: "x" }] }, { ...req, guests: 3 }); assert.equal(r.state, "unconfirmed");
});
test("25 malformed payloads are unconfirmed with no price", () => {
  const unav = { ok: true, available: false, decision: "unavailable", listingId: 603564, from: "2026-11-16", to: "2026-11-19", nights: 3, guests: 3, currency: "MXN", reasons: [{ code: "X", message: "x" }], checkedAt: "x" };
  const bad = [null, "x", { ...quoted, ok: false }, { ...quoted, decision: "maybe" }, { ...quoted, listingId: 603566 }, { ...quoted, from: "2026-11-15" }, { ...quoted, to: "2026-11-20" }, { ...quoted, guests: 4 }, { ...quoted, nights: 2 }, { ...quoted, currency: null }, { ...quoted, currency: "mxn" }, { ...quoted, total: "6600" }, { ...quoted, total: -1 }, { ...quoted, total: NaN }, { ...quoted, nightlyAverage: -5 }, { ...quoted, nightlyAverage: "2200" }, { ...quoted, available: false }, { ...quoted, breakdown: [] }, { ...quoted, breakdown: "x" }, { ...quoted, breakdown: [{ type: "accommodation", label: "A", total: "6600" }] }, { ...quoted, breakdown: [{ type: "accommodation", label: "A", total: 6000 }] }, { ...quoted, breakdown: [{ type: "accommodation", total: 6600 }] }, { ...unav, reasons: [] }, { ...unav, reasons: "x" }, { ...unav, available: true }];
  assert.equal(bad.length, 25);
  for (const b of bad) { const x = parseQuoteResponse(b, b && b.guests === 3 ? { ...req, guests: 3 } : req); assert.equal(x.state, "unconfirmed", JSON.stringify(b).slice(0, 70)); assert.equal("total" in x, false); }
});
test("fmtMoney shows the backend currency only", () => {
  assert.equal(fmtMoney(6600, "MXN"), "6,600 MXN"); assert.equal(fmtMoney(1439.5, "MXN"), "1,439.5 MXN"); assert.equal(fmtMoney(1760, "MXN").includes("$"), false);
});
