import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const pagesRoot = new URL("../pages-dist/", import.meta.url);

test("creates a project-path-safe GitHub Pages build", async () => {
  const html = await readFile(new URL("index.html", pagesRoot), "utf8");
  const assets = await readdir(new URL("assets/", pagesRoot));

  assert.match(html, /<title>Kalkulačka střešní skladby \| Střešní fyzika<\/title>/i);
  assert.match(html, /\.\/assets\/[^"']+\.js/);
  assert.match(html, /\.\/assets\/[^"']+\.css/);
  assert.doesNotMatch(html, /(?:src|href)="\/(?!\/)/);
  assert.ok(assets.some((file) => file.endsWith(".js")));
  assert.ok(assets.some((file) => file.endsWith(".css")));
  await access(new URL("og.png", pagesRoot));
});
