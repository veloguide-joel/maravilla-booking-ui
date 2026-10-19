# booking-ui regression tests

Dev-only. `tests/` is excluded from Vercel deployments by `../.vercelignore`; it has no effect on
`consumer/booking-test.html`, which is the served application and is never modified by these tests.

## Run from a fresh checkout
```
cd tests
npm ci                      # installs playwright 1.56.0 (pinned); no browsers yet
npx playwright install chromium   # one-time Chromium download (~150 MB); skip if PLAYWRIGHT_BROWSERS_PATH already has it
npm test                    # unit (node:test) + browser harnesses
```
Individual: `npm run test:unit`, `npm run test:browser`, or `node browser/n2-modal-calendar.mjs`.
Node ≥ 20. No network is needed: every proxy call is intercepted and answered from `fixtures/`.
`PAGE_SRC=/path/to/booking-test.html` tests another copy of the page (e.g. a checked-out commit).

## What is covered
| Suite | Checks | Covers |
|---|---|---|
| `unit/resolver.test.mjs` | 15 hosts | API host mapping incl. unknown-host fail-safe (B1) |
| `unit/listing-mapping.test.mjs` | | `toProperty` whitelist / https-only images, UX2b gallery URL list (order, de-dup, cap 12, malformed dropped), UX2c beds/amenities/check-in/out validation (held labels), `esc` |
| `unit/calendar-parse.test.mjs` | 13 malformed + ranges | arrival-inclusive/departure-exclusive, isolation, incomplete coverage, fail-closed |
| `unit/stay-selection.test.mjs` | 19 cases | owner's occupancy matrix, 90-night cap, unknown nights |
| `unit/quote-parse.test.mjs` | 25 malformed + live shapes | three quote states, breakdown sum, MXN formatting |
| `unit/direct-estimate.test.mjs` | 15 malformed | D4 consistency checks, estimate_unavailable, no direct on unavailable |
| `browser/n1-search-picker.mjs` | 56 | search picker month navigation, 365-day horizon, 90-night guard, keyboard, mobile |
| `browser/n2-modal-calendar.mjs` | 85 | modal navigation, fresh windows, fail-closed, edit/clear, carry-over, Dec 24–31 reservation, highlighting, stale protection |
| `browser/d4-savings-display.mjs` | 58 | six pilot prices, LOS stacking, malformed `direct`, no savings on unavailable/unconfirmed, stale protection, mobile |
| `browser/u5b-search-regression.mjs` | 48 | U1–U6 search flow, favorites, cards, unconfirmed states |
| `browser/ux1-property-routes.mjs` | 48 | `/property/:id` direct load/refresh, unknown ids, strict query params, Back to results, Back/Forward, state preservation, modal untouched, stale listings, mobile/keyboard |
| `browser/ux2b-property-gallery.mjs` | 97 | property-page gallery: 12/8-photo pilots, mosaic layouts for 1–5+ photos, viewer (next/prev, counter, Escape, focus return, Tab trap, swipe), broken/malformed/empty images, lazy loading, mobile 390/320 carousel, refresh, Back/Forward, cards/modal/D4 unchanged, network |
| `browser/ux2c-property-info.mjs` | 72 | property information: both pilots' facts/amenities/times, held 'Beach', show-all toggle, missing/malformed fields, description never shown, no policy/location claims, reserved booking column, 390/320/900 layouts, keyboard/semantics, gallery intact, direct URL/refresh/Back/Forward, modal/calendar/D4 unchanged, network |

Unit tests import the real functions: `lib/page-source.mjs` extracts named declarations from the page's
inline script at test time (`extract([...names])`); a renamed or removed function fails the suite instead of
silently testing a stale copy. Browser harnesses load the committed page in Chromium with a fixed clock
(`fixtures/pilots.mjs` → `TODAY = 2026-10-19`) and deterministic proxy fixtures, including the real
603566 Dec 24–31 reservation and the 603564 Jan 7–Mar 2 2027 block.

## Known limitations
- Browser harnesses print their own PASS/FAIL lines rather than using a test framework; `browser/run.mjs` aggregates them.
- They bind `localhost:5500` (the origin the page maps to proxy DEV), so run them one at a time (run.mjs does).
- Live-preview verification (real proxy DEV, browser pane) is a manual step documented in each stage report, not automated here.
