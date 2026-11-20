import test from "node:test";
import assert from "node:assert/strict";
import { mergeUniqueResults } from "./catalogMerge.js";

test("keeps every new row and drops repeated ids", () => {
  const merged = mergeUniqueResults(
    [{ id: "a" }, { id: "b" }],
    [{ id: "b" }, { id: "c" }],
  );
  assert.deepEqual(
    merged.map((x) => x.id),
    ["a", "b", "c"],
  );
});

test("a page that repeats the previous one adds nothing", () => {
  const previous = [{ id: "a" }, { id: "b" }];
  const merged = mergeUniqueResults(previous, [{ id: "a" }, { id: "b" }]);
  assert.equal(merged.length, previous.length);
});

test("rows without an id are kept", () => {
  const merged = mergeUniqueResults([{ title: "x" }], [{ title: "x" }]);
  assert.equal(merged.length, 2);
});
