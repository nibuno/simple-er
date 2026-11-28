import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { tableColors } from "../src/types.ts";
import { contrastRatio, normalizeColor } from "../canvas/src/colors.ts";

const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const { document } = new JSDOM(`<style>${css}</style>`).window;
const rules = Array.from(document.styleSheets[0].cssRules);
const light = rules.find((rule) => rule.selectorText === ":root").style;
const dark = Array.from(
  rules.find((rule) => rule.conditionText === "(prefers-color-scheme: dark)")
    .cssRules,
).find((rule) => rule.selectorText === ":root").style;

for (const [scheme, palette] of Object.entries({ light, dark })) {
  test(`${scheme} appearance keeps editor text and key badges legible`, () => {
    const color = (name) =>
      normalizeColor(palette.getPropertyValue(`--${name}`));
    for (const [ink, paper] of [
      ["text", "bg"],
      ["muted", "surface"],
      ["on-accent", "accent"],
      ["accent-strong", "selected"],
      ["hint-accent", "text"],
      ["pk", "pk-bg"],
      ["fk", "fk-bg"],
      ["fk", "pk-bg"], // A combined primary/foreign key uses both colors.
      ["uq", "uq-bg"],
    ]) {
      assert.ok(
        contrastRatio(color(ink), color(paper)) >= 4.5,
        `${ink} on ${paper}`,
      );
    }
  });
}

for (const [scheme, colors, property] of [
  ["light", light, "fill"],
  ["dark", dark, "dark"],
]) {
  test(`${scheme} table colors keep schema and table names legible`, () => {
    for (const color of Object.values(tableColors)) {
      for (const ink of ["text", "text-2"])
        assert.ok(
          contrastRatio(
            normalizeColor(colors.getPropertyValue("--" + ink)),
            normalizeColor(color[property]),
          ) >= 4.5,
          `${ink} on ${color.label}`,
        );
    }
  });
}
