import test from "node:test";
import assert from "node:assert/strict";
import { hasLanguageChoice, resolveItemLangs } from "./mediaBadges.js";

test("uses provider metadata when an episode has no language labels", () => {
  assert.deepEqual(
    resolveItemLangs({}, { hasSub: true, hasDub: true, subOrDub: "both" }),
    ["sub", "dub"],
  );
});

test("does not advertise sub for a dub-only provider", () => {
  assert.deepEqual(
    resolveItemLangs({}, { hasDub: true, subOrDub: "dub" }),
    ["dub"],
  );
});

test("episode language labels take priority over provider metadata", () => {
  assert.deepEqual(
    resolveItemLangs(
      { langs: ["dub"] },
      { hasSub: true, hasDub: true, subOrDub: "both" },
    ),
    ["dub"],
  );
});

test("unknown providers keep the safe sub fallback", () => {
  assert.deepEqual(resolveItemLangs({}, {}), ["sub"]);
});

test("shows a language choice only when both sub and dub are available", () => {
  assert.equal(hasLanguageChoice(["sub", "dub"]), true);
  assert.equal(hasLanguageChoice(["sub"]), false);
  assert.equal(hasLanguageChoice(["dub"]), false);
});
