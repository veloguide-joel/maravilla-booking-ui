import test from "node:test";
import assert from "node:assert/strict";
import { extract } from "../lib/page-source.mjs";

const { parseCalendarResponse, evaluateStaySelection } = extract(["isoDateRe", "isIsoDate", "addDaysISO", "nightsSpan", "parseCalendarResponse", "nightState", "evaluateStaySelection"]);
const T = "2026-10-17";
const base = { ok: true, listingId: 603564, checkedAt: "x", from: "2026-10-17", to: "2027-01-15", coverage: { complete: true }, unavailable: [] };
const one = parseCalendarResponse({ ...base, unavailable: [{ arrival: "2026-11-10", departure: "2026-11-11" }] }, 603564);
const three = parseCalendarResponse({ ...base, unavailable: [{ arrival: "2026-11-10", departure: "2026-11-13" }] }, 603564);
const ev = (s, e, st) => evaluateStaySelection(s, e, st, T);

test("owner's occupancy matrix (checkout on first blocked night is clear; overlaps name the first bad night)", () => {
  assert.equal(ev("2026-11-09", "2026-11-10", one).ok, true);
  assert.deepEqual([ev("2026-11-09", "2026-11-11", one).ok, ev("2026-11-09", "2026-11-11", one).night], [false, "2026-11-10"]);
  assert.deepEqual([ev("2026-11-10", "2026-11-13", three).ok, ev("2026-11-10", "2026-11-13", three).reason], [false, "NIGHT_UNAVAILABLE"]);
  assert.equal(ev("2026-11-13", "2026-11-15", three).ok, true);
  assert.equal(ev("2026-11-09", "2026-11-10", three).ok, true);
  assert.equal(ev("2026-11-12", "2026-11-14", three).ok, false);
  assert.equal(ev("2026-11-08", "2026-11-15", three).night, "2026-11-10");
});
test("unknown coverage, errors, stale and out-of-window nights fail closed", () => {
  const inc = parseCalendarResponse({ ...base, coverage: { complete: false } }, 603564);
  assert.deepEqual([ev("2026-11-16", "2026-11-19", inc).ok, ev("2026-11-16", "2026-11-19", inc).reason], [false, "NIGHT_UNCONFIRMED"]);
  assert.equal(ev("2026-11-16", "2026-11-19", parseCalendarResponse({ ok: false }, 603564)).reason, "NIGHT_UNCONFIRMED");
  assert.equal(ev("2026-11-16", "2026-11-19", null).reason, "NIGHT_UNCONFIRMED");
  assert.equal(ev("2027-01-15", "2027-01-17", one).reason, "NIGHT_UNCONFIRMED");
  assert.equal(ev("2027-01-14", "2027-01-16", one).ok, true);
});
test("structural rules and the 90-night cap", () => {
  assert.equal(ev("2026-10-16", "2026-10-18", one).reason, "PAST_START");
  assert.equal(ev("2026-11-10", "2026-11-10", one).reason, "END_NOT_AFTER_START");
  assert.equal(ev("2026-11-12", "2026-11-10", one).reason, "END_NOT_AFTER_START");
  assert.equal(ev("bad", "2026-11-10", one).reason, "NO_START");
  const wide = parseCalendarResponse({ ...base, to: "2027-06-01" }, 603564);
  assert.equal(ev("2026-11-01", "2027-01-01", wide).ok, true);
  assert.equal(ev("2026-10-18", "2027-01-20", wide).reason, "TOO_LONG");
});
