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
| `unit/legacy-modal-hook.test.mjs` | 4 | UX7a isolation guards for the test-only legacy modal entry: committed page has no hook/cookie/test switch; hooked copy = page + hook only; served only with the cookie; never injected twice |
| `browser/n1-search-picker.mjs` | 56 | search picker month navigation, 365-day horizon, 90-night guard, keyboard, mobile |
| `browser/n2-modal-calendar.mjs` | 85 | modal navigation, fresh windows, fail-closed, edit/clear, carry-over, Dec 24–31 reservation, highlighting, stale protection |
| `browser/d4-savings-display.mjs` | 58 | six pilot prices, LOS stacking, malformed `direct`, no savings on unavailable/unconfirmed, stale protection, mobile |
| `browser/u5b-search-regression.mjs` | 48 | U1–U6 search flow, favorites, cards, unconfirmed states |
| `browser/ux1-property-routes.mjs` | 48 | `/property/:id` direct load/refresh, unknown ids, strict query params, Back to results, Back/Forward, state preservation, modal untouched, stale listings, mobile/keyboard |
| `browser/ux2b-property-gallery.mjs` | 97 | property-page gallery: 12/8-photo pilots, mosaic layouts for 1–5+ photos, viewer (next/prev, counter, Escape, focus return, Tab trap, swipe), broken/malformed/empty images, lazy loading, mobile 390/320 carousel, refresh, Back/Forward, cards/modal/D4 unchanged, network |
| `browser/ux2c-property-info.mjs` | 72 | property information: both pilots' facts/amenities/times, held 'Beach', show-all toggle, missing/malformed fields, description never shown, no policy/location claims, reserved booking column, 390/320/900 layouts, keyboard/semantics, gallery intact, direct URL/refresh/Back/Forward, modal/calendar/D4 unchanged, network |
| `browser/ux3-booking-panel.mjs` | 77 | property-page booking panel: D4 figures for both pilots incl. weekly/monthly, Dec 24–31 reservation + overlaps + boundaries, capacity, unconfirmed/Retry, malformed calendar/quote/direct, absent/invalid inherited values, stale answers across property/view changes and refresh, modal parity + isolation (no duplicate ids, modal state untouched), 1280/390/320 layout, keyboard/live regions, GET-only network |
| `browser/ux4a-calendar-parity.mjs` | 181 | N2 modal calendar parity against the frozen `fixtures/ux4a-baseline-ccdefda.json` trace (60 scripted steps recorded from the ccdefda page): per step, normalized DOM/a11y/state snapshot, ordered API calls and page errors must be identical. `--record <file>` re-records (only ever from a committed baseline page via `PAGE_SRC`) |
| `browser/ux4b-date-editor.mjs` | 97 | property-page date editor (second calendar host): open from either field, no-date URL, draft vs committed (no URL/price/quote change until Apply), Escape/Close/backdrop discard + focus return, edit one end, full replacement, explicit Clear+Apply, replaceState + reload + Back/Forward, 365-day/90-night limits, month/year boundaries, blocked/unconfirmed/incomplete fail-closed, Dec 24–31 reservation, weekly/monthly D4 after Apply, delayed calendar/quote races, closed-editor and property-switch races, modal parity + no duplicate ids, desktop anchoring, 390/320 sheet, keyboard/focus trap, GET-only network |
| `browser/ux5-guest-editing.mjs` | 51 | guest selector in the property panel: options 1..capacity, 1↔2 repricing through the UX3 pipeline, same-value no-op, over-capacity URL flagged + correctable on the page, forged values rejected, URL guest params (UX1 all-or-nothing rule), no-date changes, date↔guest ordering, date-editor isolation, unavailable/unconfirmed + Retry, out-of-order + rapid changes, leaving / property switch mid-quote, replaceState + reload + Back/Forward, modal parity, layout 1280/390/320, keyboard/focus/accessible name, GET-only network |
| `browser/ux6-search-calendar.mjs` | 50 | homepage search picker: stays open after check-out with the range painted, footer summary + Clear dates / Check availability (disabled until complete), footer search exactly once (also on triple-click and while the same search runs), external button unchanged, revising, Escape/Close/outside keep dates without searching, stale results cleared + 'Dates changed' notice, same-range re-pick keeps results, unfinished revision keeps the last complete range, Clear dates, month/year boundaries, 90-night/365-day limits, unavailable/unconfirmed results, overlapping searches, 390/320 sticky footer, keyboard/focus, GET-only network |
| `browser/ux7a-card-navigation.mjs` | 64 | **guest journey on the unmodified page** (no legacy cookie; asserts served bytes = committed file, no hook): card photo/title real links (one tab stop, aria-hidden photo link, no nested controls), title/photo/body clicks → `/property/:id` with dates + guests, heart independent, Saved filter/favorites/dates preserved, Ctrl/Shift/middle-click new tabs, independent property-page validation (card price never reused), date + guest editing after arrival, Back to results / Back / Forward / reload / direct URLs, Dec 24–31 reservation, stale cross-view answers, keyboard, 390/320 tap + scroll restoration, UX6 picker → card → property journey, GET-only network |
| `browser/ux7b1-guest-corrections.mjs` | 70 | guest-interaction corrections on the unmodified page: favourite heart as a real button (Tab order, Enter/Space, Save/Remove name, focus ring, never navigates, persistence, Saved-filter focus, 390/320 targets); results URL/state consistency after property-page date or guest edits (URL = pill = inputs, stale prices withdrawn + re-check prompt, no extra history entries or requests, refresh keeps the search without searching, Forward re-validates, unchanged search keeps prices, results URL follows search-page changes); persistent capacity message in every panel state incl. calendar/quote failure, delayed checks, date edits and a defensive 'quoted' answer; independent URL validation (dates kept with an unusable guest value, choose-guests prompt, no request until corrected, URL keeps the value, date rules unchanged, card navigation uses visible values); mobile; GET-only network |
| `browser/ux7b2-back-link.mjs` | 32 | property page 'Back to results' link always carries the committed search: updated on applied date and guest changes, unchanged by drafts (Escape/Close), Clear+Apply, direct links with/without dates, unusable guest value omitted until confirmed, Ctrl/middle-click new tabs open the committed results without assumed prices, plain click / Back / Forward, keyboard + 1280/390/320, GET-only network |
| `browser/ux7b2-property-save.mjs` | 30 | property-page Save/Saved toggle: real button with aria-pressed and Save/Remove name, top right opposite the title, same mv_saved key as the cards, card ↔ page synchronisation, Saved filter follows page changes (re-check prompt instead of stale prices), Back/Forward/refresh/direct link, Enter/Space + focus ring, no navigation or requests, 390/320 for both pilots |

Unit tests import the real functions: `lib/page-source.mjs` extracts named declarations from the page's
inline script at test time (`extract([...names])`); a renamed or removed function fails the suite instead of
silently testing a stale copy. Browser harnesses load the committed page in Chromium with a fixed clock
(`fixtures/pilots.mjs` → `TODAY = 2026-10-19`) and deterministic proxy fixtures, including the real
603566 Dec 24–31 reservation and the 603564 Jan 7–Mar 2 2027 block.

## Legacy modal suites (UX7a)
Since UX7a, search cards open the dedicated property page; nothing in the application opens the old N2 modal any more.
Its calendar/quote engine (shared with the property-page editor through the UX4a calendar host) stays under regression
through a **test-only** entry, `lib/modal-entry.mjs`:
- The local test server keeps the committed page in memory. Only for a browser context carrying the cookie
  `mv_test_legacy_modal=1` (set by `enableLegacyModal(ctx)`, scoped to `localhost:5500`) does it serve a copy with a
  small block inserted just before the script's closing `})();`. That block is the pre-UX7a card-click branch,
  verbatim: it sets `mvSelectedApartmentId`, moves `.mv-selected` and calls the original `openModal(p)`. It makes no
  requests or writes of its own.
- The committed page never contains it (`unit/legacy-modal-hook.test.mjs`, the UX7a suite, and the live preview check).
  `tests/` is excluded from deployments by `.vercelignore`.
- **Legacy-modal coverage** (hooked contexts): `ux4a-calendar-parity` (all), `n2-modal-calendar` (all),
  `d4-savings-display` (all), `u5b-search-regression` (all), and the sections labelled "LEGACY modal (test hook)" in
  `n1` (modal), `ux1` (E), `ux2b` (13–15), `ux2c` (13–14), `ux3` (8), `ux4b` (6) and `ux5` (8).
- **Guest-facing coverage** (unmodified page): `ux7a-card-navigation`, `ux6`, and every other section of
  `n1`/`ux1`–`ux5`.

## UX4a parity fixture
`fixtures/ux4a-baseline-ccdefda.json` is frozen evidence recorded from `consumer/booking-test.html` at commit `ccdefda` (pre-refactor). Do not regenerate it from a refactored page; a deliberate behaviour change needs owner approval and a new, separately recorded baseline.

## Known limitations
- Browser harnesses print their own PASS/FAIL lines rather than using a test framework; `browser/run.mjs` aggregates them.
- They bind `localhost:5500` (the origin the page maps to proxy DEV), so run them one at a time (run.mjs does).
- Live-preview verification (real proxy DEV, browser pane) is a manual step documented in each stage report, not automated here.
