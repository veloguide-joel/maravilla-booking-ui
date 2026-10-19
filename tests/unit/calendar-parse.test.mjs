import test from "node:test";
import assert from "node:assert/strict";
import { extract } from "../lib/page-source.mjs";

const { parseCalendarResponse, nightState } = extract(["isoDateRe", "isIsoDate", "addDaysISO", "nightsSpan", "parseCalendarResponse", "nightState"]);
const base = { ok: true, listingId: 603564, checkedAt: "2026-10-17T17:00:00Z", from: "2026-10-17", to: "2027-01-15", coverage: { daysRequested: 91, daysReturned: 91, complete: true }, unavailable: [], unavailableNights: 0, restrictions: {} };
const T = "2026-10-17";

test("ranges are arrival-inclusive / departure-exclusive", () => {
  let s = parseCalendarResponse({ ...base, unavailable: [{ arrival: "2026-11-10", departure: "2026-11-13", nights: 3 }] }, 603564);
  assert.equal(s.status, "ok");
  assert.deepEqual([...s.nights], ["2026-11-10", "2026-11-11", "2026-11-12"]);
  assert.equal(nightState("2026-11-09", s, T), "available");
  assert.equal(nightState("2026-11-10", s, T), "unavailable");
  assert.equal(nightState("2026-11-12", s, T), "unavailable");
  assert.equal(nightState("2026-11-13", s, T), "available");
  assert.equal(nightState("2026-10-16", s, T), "past");
  assert.equal(nightState("2027-01-16", s, T), "unknown");
  assert.equal(nightState("2027-01-15", s, T), "available");
  s = parseCalendarResponse({ ...base, unavailable: [{ arrival: "2026-11-10", departure: "2026-11-11", nights: 1 }] }, 603564);
  assert.deepEqual([...s.nights], ["2026-11-10"]); assert.equal(nightState("2026-11-11", s, T), "available");
});
test("per-listing isolation", () => {
  const s2 = parseCalendarResponse({ ...base, listingId: 603566 }, 603566);
  assert.equal(s2.nights.size, 0); assert.equal(nightState("2026-11-10", s2, T), "available");
});
test("incomplete coverage: unknown for open days, unavailable for blocked", () => {
  const s = parseCalendarResponse({ ...base, coverage: { daysRequested: 91, daysReturned: 88, complete: false }, unavailable: [{ arrival: "2026-12-01", departure: "2026-12-04", nights: 3 }] }, 603564);
  assert.equal(s.status, "incomplete"); assert.equal(nightState("2026-11-20", s, T), "unknown"); assert.equal(nightState("2026-12-02", s, T), "unavailable");
});
test("malformed payloads fail closed (13 cases + null state)", () => {
  const bad = [null, "x", { ...base, ok: false }, { ...base, listingId: 603566 }, { ...base, from: "2026-11-1" }, { ...base, to: "2026-10-01" }, { ...base, unavailable: {} },
    { ...base, unavailable: [{ arrival: "2026-11-12", departure: "2026-11-10" }] }, { ...base, unavailable: [{ arrival: "2026-11-10" }] }, { ...base, unavailable: [null] },
    { ...base, coverage: null }, { ...base, coverage: { complete: "yes" } }, { ...base, unavailable: [{ arrival: "2026-11-10", departure: "2028-11-10" }] }];
  assert.equal(bad.length, 13);
  for (const b of bad) { const e = parseCalendarResponse(b, 603564); assert.equal(e.status, "error", JSON.stringify(b).slice(0, 60)); assert.equal(nightState("2026-11-20", e, T), "unknown"); }
  assert.equal(nightState("2026-11-20", null, T), "unknown");
});
