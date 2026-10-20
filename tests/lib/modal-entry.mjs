// UX7a: TEST-ONLY entry to the legacy N2 booking modal.
//
// Since UX7a, search cards open the dedicated property page and nothing in the application opens the old modal.
// The modal's calendar/quote engine (shared with the property-page editor through the UX4a calendar host) is still
// covered by the legacy suites (UX4a frozen parity, N2, D4, U5b and the legacy sections of other suites). They reach
// it through this hook.
//
// How it works:
//   * The committed page is NEVER modified. The local test server holds the page in memory and, only for a browser
//     context that carries the cookie LEGACY_COOKIE, serves a copy with HOOK_BLOCK inserted just before the page
//     script's closing `})();`, i.e. inside the IIFE, where `openModal` lives.
//   * HOOK_BLOCK is the pre-UX7a card-click branch (0d30751), verbatim: find the rendered card, set
//     window.mvSelectedApartmentId, move .mv-selected, call the ORIGINAL openModal(p). It reconstructs nothing and
//     makes no network request or write of its own.
//   * Contexts without the cookie (all guest-journey tests, incl. UX7a) get the committed bytes unchanged.
//   * Guards: the injection marker must occur exactly once; removing HOOK_BLOCK from the served copy must give back
//     the committed page byte-for-byte; the committed page must not contain HOOK_NAME (unit test + UX7a suite);
//     tests/ is excluded from deployments by .vercelignore.
export const HOOK_NAME = "__mvTestOpenCardModal";
export const LEGACY_COOKIE = "mv_test_legacy_modal";
const MARKER = "\n})();\n</script>";

export const HOOK_BLOCK = `
    // ---- TEST-ONLY (injected by tests/lib/modal-entry.mjs into the test server's in-memory copy; never committed) ----
    window.${HOOK_NAME} = (wantedId) => {
        const card = $results.querySelector('.mv-card[data-apartment-id="' + String(wantedId) + '"]');
        if (!card) return false;
        const id = String(card.dataset.propertyId || card.dataset.id);
        const p = PROPERTIES.find(x => getPropertyId(x) === id || String(x.id) === id);
        if (p) {
            const apartmentId = card.dataset.apartmentId || p.id;
            window.mvSelectedApartmentId = String(apartmentId);
            document.querySelectorAll(".mv-selected").forEach((el) => el.classList.remove("mv-selected"));
            card.classList.add("mv-selected");
            openModal(p);
        }
        return !!p;
    };`;

const cache = new Map();
/** The committed page plus HOOK_BLOCK (inside the IIFE). Throws if the page shape changed or the guard fails. */
export function withLegacyModalHook(page) {
  if (cache.has(page)) return cache.get(page);
  if (page.includes(HOOK_NAME)) throw new Error(`committed page already contains ${HOOK_NAME}`);
  const at = page.indexOf(MARKER);
  if (at < 0 || page.indexOf(MARKER, at + 1) >= 0) throw new Error("legacy modal hook: script end marker not found exactly once");
  const hooked = page.slice(0, at) + HOOK_BLOCK + page.slice(at);
  if (hooked.replace(HOOK_BLOCK, "") !== page) throw new Error("legacy modal hook: served copy differs from the committed page beyond the hook");
  cache.set(page, hooked);
  return hooked;
}

/** What the local test server sends for an HTML request: hooked copy only for legacy-modal contexts. */
export function htmlFor(req, page) {
  const cookie = String(req.headers.cookie || "");
  return cookie.split(/;\s*/).includes(`${LEGACY_COOKIE}=1`) ? withLegacyModalHook(page) : page;
}

/** Mark a browser context as a legacy-modal context (cookie scoped to the local test server only). */
export async function enableLegacyModal(ctx) {
  await ctx.addCookies([{ name: LEGACY_COOKIE, value: "1", url: "http://localhost:5500" }]);
}

/** Open the legacy modal for a rendered card through the original openModal path. */
export async function openLegacyModal(page, apartmentId) {
  const ok = await page.evaluate(([name, id]) => {
    if (typeof window[name] !== "function") throw new Error("legacy modal hook missing: context not enabled with enableLegacyModal()");
    return window[name](id);
  }, [HOOK_NAME, String(apartmentId)]);
  if (!ok) throw new Error(`legacy modal hook: no rendered card for ${apartmentId}`);
}
