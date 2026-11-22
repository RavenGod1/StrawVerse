import test from "node:test";
import assert from "node:assert/strict";
import { getProxiedImageUrl } from "./imageUrl.js";

test("routes provider images through the app proxy", () => {
  assert.equal(
    getProxiedImageUrl("https://cdn.atsu.moe/static/posters/a-large.avif"),
    "/api/image?url=https%3A%2F%2Fcdn.atsu.moe%2Fstatic%2Fposters%2Fa-large.avif",
  );
});

test("keeps already-local sources untouched", () => {
  assert.equal(
    getProxiedImageUrl("/api/image?url=https%3A%2F%2Fx%2Fa.jpg"),
    "/api/image?url=https%3A%2F%2Fx%2Fa.jpg",
  );
  assert.equal(
    getProxiedImageUrl("data:image/png;base64,AAA"),
    "data:image/png;base64,AAA",
  );
  assert.equal(
    getProxiedImageUrl("file:///C:/cover.jpg"),
    "file:///C:/cover.jpg",
  );
  assert.equal(
    getProxiedImageUrl("/images/image-404.png"),
    "/images/image-404.png",
  );
});

test("missing image falls back to the placeholder", () => {
  assert.equal(getProxiedImageUrl(null), "/images/image-404.png");
  assert.equal(getProxiedImageUrl(""), "/images/image-404.png");
});

test("passes mal id and title for broken-image reports", () => {
  const url = getProxiedImageUrl("https://x/y.jpg", {
    malid: 42,
    title: "A Title",
  });
  assert.match(url, /&malid=42/);
  assert.match(url, /&title=A%20Title/);
});

test("ignores a non-numeric provider id as mal id", () => {
  const url = getProxiedImageUrl("https://x/y.jpg", { id: "FvDJ1" });
  assert.doesNotMatch(url, /malid=/);
});
