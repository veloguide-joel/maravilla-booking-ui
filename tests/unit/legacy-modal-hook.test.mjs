// UX7a: isolation guards for the TEST-ONLY legacy modal entry (tests/lib/modal-entry.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { pageSource } from "../lib/page-source.mjs";
import { HOOK_NAME, HOOK_BLOCK, LEGACY_COOKIE, withLegacyModalHook, htmlFor } from "../lib/modal-entry.mjs";

const page = pageSource();

test("committed page contains no test hook, hook cookie or test-mode switch", () => {
  assert.equal(page.includes(HOOK_NAME), false);
  assert.equal(page.includes(LEGACY_COOKIE), false);
  assert.equal(/__mvTest|TEST-ONLY|testMode|test_mode/i.test(page), false);
});

test("hooked copy = committed page + HOOK_BLOCK inside the IIFE, nothing else", () => {
  const hooked = withLegacyModalHook(page);
  assert.equal(hooked.length, page.length + HOOK_BLOCK.length);
  assert.equal(hooked.replace(HOOK_BLOCK, ""), page);
  assert.ok(hooked.indexOf(HOOK_BLOCK) < hooked.lastIndexOf("})();"), "hook sits before the IIFE closes");
  assert.ok(HOOK_BLOCK.includes("openModal(p);"), "hook calls the original modal initialisation");
  assert.equal(/fetch\(|XMLHttpRequest|localStorage|sessionStorage|POST/.test(HOOK_BLOCK), false, "hook makes no requests or writes");
});

test("the test server serves the hook only to contexts with the legacy cookie", () => {
  assert.equal(htmlFor({ headers: {} }, page), page);
  assert.equal(htmlFor({ headers: { cookie: "other=1" } }, page), page);
  assert.equal(htmlFor({ headers: { cookie: `${LEGACY_COOKIE}=0` } }, page), page);
  assert.equal(htmlFor({ headers: { cookie: `a=b; ${LEGACY_COOKIE}=1` } }, page), withLegacyModalHook(page));
});

test("the hook can never be injected twice or into an unexpected page shape", () => {
  assert.throws(() => withLegacyModalHook(withLegacyModalHook(page)));
  assert.throws(() => withLegacyModalHook("<script>(() => {})()</script>"));
});
