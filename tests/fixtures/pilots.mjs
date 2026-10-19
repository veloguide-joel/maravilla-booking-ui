// Deterministic fixtures mirroring the live proxy contracts for the two pilot listings.
// Values come from the recorded live runs (Stage F / U4 / D3a). Nothing here is fetched.
export const TODAY = "2026-10-19"; // fixed clock used by the browser harnesses (addInitScript Date mock)
export const PROXY = "https://maravilla-smoobu-proxy-git-dev-joel-goralskis-projects.vercel.app"; // what the page calls from localhost

export const listings = {
  ok: true, checkedAt: "2026-10-19T00:00:00Z", listings: [
    { id: 603564, source: "hostaway", slug: "hostaway-603564", name: "Hacienda 5 De Mayo", sleeps: 2, bedrooms: 1, bathrooms: 1, city: "Bucerías", tagline: "1 BR • 1 Bath • Bucerías", summary: "s", img: "https://example.com/a.jpg", images: [{ url: "https://example.com/a.jpg" }], currency: "MXN", minNights: 1, maxNights: 365 },
    { id: 603566, source: "hostaway", slug: "hostaway-603566", name: "East Side Studio", sleeps: 2, bedrooms: 1, bathrooms: 1, city: "Bucerías", tagline: "1 BR • 1 Bath • Bucerías", summary: "s", img: "https://example.com/b.jpg", images: [{ url: "https://example.com/b.jpg" }], currency: "MXN", minNights: 1, maxNights: 365 }
  ]
};

// Real calendar blocks observed in Hostaway (arrival-inclusive / departure-exclusive):
//  603566 2026-12-24 -> 2026-12-31 = the owner's Airbnb Instant Book reservation (7 nights)
//  603564 2027-01-07 -> 2027-03-02 = a 54-night block seen on 2026-10-19
export const BLOCKS = { 603564: [["2027-01-07", "2027-03-02"]], 603566: [["2026-12-24", "2026-12-31"]] };
export const RATE = { 603564: 2200, 603566: 1600 }; // base nightly MXN

export const dayMs = 86400000;
export const nightsOf = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / dayMs);
export const addD = (iso, n) => new Date(Date.parse(iso) + n * dayMs).toISOString().slice(0, 10);
export const overlaps = (id, a, b) => (BLOCKS[id] || []).some(([x, y]) => a < y && b > x);

/** Public calendar response for a window, with the horizon closure Hostaway shows from today+366. */
export function calendarFor(id, from, to) {
  if (!from || !to || nightsOf(from, to) > 90 || from < addD(TODAY, -1)) return { status: 400, body: { ok: false, error: "BAD_WINDOW" } };
  const n = nightsOf(from, to) + 1;
  const unavailable = (BLOCKS[id] || []).filter(([x, y]) => x < to && y > from).map(([x, y]) => ({ arrival: x, departure: y, nights: nightsOf(x, y) }));
  const hz = addD(TODAY, 366);
  if (to >= hz) unavailable.push({ arrival: from > hz ? from : hz, departure: addD(to, 1), nights: nightsOf(from > hz ? from : hz, addD(to, 1)) });
  return { status: 200, body: { ok: true, listingId: Number(id), from, to, coverage: { daysRequested: n, daysReturned: n, complete: true }, unavailable, unavailableNights: unavailable.reduce((a, r) => a + r.nights, 0), restrictions: { closedOnArrival: [], closedOnDeparture: [], minimumStay: [], maximumStay: [] }, checkedAt: "2026-10-19T18:00:00Z" } };
}

/** Standard quote + server-style direct estimate: weekly (7+) 10% and monthly (28+) 20% Hostaway LOS discounts,
 *  direct = 10% of accommodation after LOS, half-up in centavos (lib/direct-pricing.js arithmetic). */
export function quoteFor(id, n) {
  const acc = RATE[id] * n; const los = n >= 28 ? -Math.round(acc * 0.2) : n >= 7 ? -Math.round(acc * 0.1) : 0;
  const breakdown = [{ type: "accommodation", label: "Accommodation", total: acc }];
  if (los) breakdown.push({ type: "discount", label: n >= 28 ? "Monthly discount" : "Weekly discount", total: los });
  const total = acc + los, eligMinor = (acc + los) * 100, discMinor = Math.floor((eligMinor * 1000 + 5000) / 10000);
  return { total, breakdown, direct: { estimate: true, status: "estimated", currency: "MXN", standardTotal: total, eligibleAccommodation: eligMinor / 100, discount: discMinor / 100, estimatedTotal: (total * 100 - discMinor) / 100, policyVersion: "direct-v1", rateBps: 1000, note: "Estimated direct-booking total. Final price confirmed at checkout." } };
}

export const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
