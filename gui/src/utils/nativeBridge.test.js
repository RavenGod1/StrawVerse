import test from "node:test";
import assert from "node:assert/strict";
import { getNativeRequestTimeout } from "./nativeBridge.js";

test("uses the bridge timeout supplied by the Axios request", () => {
  assert.equal(getNativeRequestTimeout(65000), 65000);
});

test("falls back to the native timeout for an invalid bridge value", () => {
  assert.equal(getNativeRequestTimeout(undefined), 30000);
  assert.equal(getNativeRequestTimeout(0), 30000);
  assert.equal(getNativeRequestTimeout("invalid"), 30000);
});
