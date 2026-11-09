import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";

test("serves the application with hardened headers", async () => {
  const response = await worker.fetch(new Request("https://tempo.test/"), {}, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
  assert.match(await response.text(), /Make today count/);
});

test("returns health metadata", async () => {
  const response = await worker.fetch(new Request("https://tempo.test/api/health"), {}, {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.service, "tempo");
});

test("returns problem details for unknown API routes", async () => {
  const response = await worker.fetch(new Request("https://tempo.test/api/nope"), {}, {});
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.status, 404);
  assert.equal(body.instance, "/api/nope");
  assert.ok(body.traceId);
});

test("rejects unsupported methods", async () => {
  const response = await worker.fetch(new Request("https://tempo.test/", { method: "POST" }), {}, {});
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
});
