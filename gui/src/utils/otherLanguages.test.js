import test from "node:test";
import assert from "node:assert/strict";
import { parseLangRequest, langRequest } from "./otherLanguages.js";

test("parses a language request apart from the app's versions", () => {
  assert.deepEqual(parseLangRequest("lang:Hindi"), {
    lang: "Hindi",
    base: null,
  });
  assert.deepEqual(parseLangRequest("dub"), { lang: null, base: "dub" });
  assert.deepEqual(parseLangRequest(""), { lang: null, base: null });
});

test("builds a language request", () => {
  assert.equal(langRequest("Hindi"), "lang:Hindi");
});
