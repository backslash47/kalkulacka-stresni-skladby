import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server renders the roof calculator", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="cs"/i);
  assert.match(html, /<title>Kalkulačka střešní skladby \| Střešní fyzika<\/title>/i);
  assert.match(html, /S vatou/);
  assert.match(html, /Bez vaty/);
  assert.match(html, /Vnitřní a vnější podmínky/);
  assert.match(html, /Vrstvy varianty/);
  assert.match(html, /Měsíční bilance kondenzace a vysychání/);
  assert.match(html, /Klimatické zkratky/);
  assert.match(html, /Průměrná venkovní teplota v daném měsíci/);
  assert.match(html, /Faktor difuzního odporu vůči vodní páře/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
