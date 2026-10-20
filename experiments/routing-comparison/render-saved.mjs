import { readFileSync, writeFileSync } from "node:fs";
import { renderHtml } from "./render.mjs";
const result = JSON.parse(
  readFileSync(new URL("./output/results.json", import.meta.url), "utf8"),
);
for (const c of result.cases)
  for (const r of Object.values(c.results))
    r.routes = new Map(Object.entries(r.routes));
const html = renderHtml(result);
writeFileSync(new URL("./output/comparison.html", import.meta.url), html);
if (process.argv.includes("--serve-copy"))
  writeFileSync(new URL("../../dist/comparison.html", import.meta.url), html);
