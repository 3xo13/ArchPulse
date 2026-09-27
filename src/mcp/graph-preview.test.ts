import { expect, it } from "vitest";
import { createGraphPreview } from "./graph-preview.js";
import { request } from "node:http";

it("serves immutable registered HTML, rejects arbitrary paths and closes with its session", async () => {
  const preview = createGraphPreview();
  let url = "";
  try {
    url = await preview.add("<!doctype html><svg><text>Before</text></svg>");
    const after = await preview.add("<!doctype html><svg><text>After</text></svg>");
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/graph\/[\da-f-]+$/);
    expect(await (await fetch(url)).text()).toContain("Before");
    expect(await (await fetch(after)).text()).toContain("After");
    const response = await fetch(url);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect((await fetch(new URL("/snapshot.json", url))).status).toBe(404);
    expect((await fetch(new URL("/graph/../../package.json", url))).status).toBe(404);
    expect((await fetch(url, { method: "POST" })).status).toBe(405);
    expect((await fetch(url, { headers: { Origin: "https://unrelated.example" } })).status).toBe(403);
    const badHost = await new Promise<number | undefined>((resolve, reject) => {
      const outgoing = request(url, { headers: { Host: "unrelated.example" } }, response => {
        response.resume(); response.once("end", () => resolve(response.statusCode));
      });
      outgoing.once("error", reject); outgoing.end();
    });
    expect(badHost).toBe(403);
    expect(await (await fetch(url, { method: "HEAD" })).text()).toBe("");
  } finally { await preview.close(); }
  await expect(fetch(url)).rejects.toThrow();
  await expect(preview.add("late")).rejects.toThrow(/shutting down/);
});

it("shares one listener for concurrent previews and bounds retained graph data", async () => {
  const preview = createGraphPreview();
  try {
    const urls = await Promise.all([preview.add("first"), preview.add("second")]);
    expect(new URL(urls[0]!).origin).toBe(new URL(urls[1]!).origin);
    await preview.add("x".repeat(32 * 1024 * 1024));
    expect((await fetch(urls[0]!)).status).toBe(404);
    await expect(preview.add("x".repeat(32 * 1024 * 1024 + 1))).rejects.toThrow(/capacity/);
  } finally { await preview.close(); }
});

it("does not resurrect the listener after shutdown during startup", async () => {
  const preview = createGraphPreview();
  const adding = preview.add("graph");
  const closing = preview.close();
  await expect(adding).rejects.toThrow(/shutting down/);
  await closing;
  await preview.close();
});
