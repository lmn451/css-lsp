import { test } from "node:test";
import { strict as assert } from "node:assert";
import { CssVariableManager } from "../src/cssVariableManager";

/**
 * Score variable relevance based on property context (from server.ts)
 */
function scoreVariableRelevance(
  varName: string,
  propertyName: string | null,
): number {
  if (!propertyName) {
    return -1; // No property context, keep all variables
  }

  const lowerVarName = varName.toLowerCase();

  // Color-related properties
  const colorProperties = [
    "color",
    "background-color",
    "background",
    "border-color",
    "outline-color",
    "text-decoration-color",
    "fill",
    "stroke",
  ];
  if (colorProperties.includes(propertyName)) {
    if (
      lowerVarName.includes("color") ||
      lowerVarName.includes("bg") ||
      lowerVarName.includes("background") ||
      lowerVarName.includes("primary") ||
      lowerVarName.includes("secondary") ||
      lowerVarName.includes("accent") ||
      lowerVarName.includes("text") ||
      lowerVarName.includes("border") ||
      lowerVarName.includes("link")
    ) {
      return 10;
    }
    if (
      lowerVarName.includes("spacing") ||
      lowerVarName.includes("margin") ||
      lowerVarName.includes("padding") ||
      lowerVarName.includes("size") ||
      lowerVarName.includes("width") ||
      lowerVarName.includes("height") ||
      lowerVarName.includes("font") ||
      lowerVarName.includes("weight") ||
      lowerVarName.includes("radius")
    ) {
      return 0;
    }
    return 5;
  }

  // Spacing-related properties
  const spacingProperties = [
    "margin",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "gap",
    "row-gap",
    "column-gap",
  ];
  if (spacingProperties.includes(propertyName)) {
    if (
      lowerVarName.includes("spacing") ||
      lowerVarName.includes("margin") ||
      lowerVarName.includes("padding") ||
      lowerVarName.includes("gap")
    ) {
      return 10;
    }
    if (
      lowerVarName.includes("color") ||
      lowerVarName.includes("bg") ||
      lowerVarName.includes("background")
    ) {
      return 0;
    }
    return 5;
  }

  // Size-related properties
  const sizeProperties = [
    "width",
    "height",
    "max-width",
    "max-height",
    "min-width",
    "min-height",
    "font-size",
  ];
  if (sizeProperties.includes(propertyName)) {
    if (
      lowerVarName.includes("width") ||
      lowerVarName.includes("height") ||
      lowerVarName.includes("size")
    ) {
      return 10;
    }
    if (
      lowerVarName.includes("color") ||
      lowerVarName.includes("bg") ||
      lowerVarName.includes("background")
    ) {
      return 0;
    }
    return 5;
  }

  // Border-radius properties
  if (propertyName.includes("radius")) {
    if (lowerVarName.includes("radius") || lowerVarName.includes("rounded")) {
      return 10;
    }
    if (
      lowerVarName.includes("color") ||
      lowerVarName.includes("bg") ||
      lowerVarName.includes("background")
    ) {
      return 0;
    }
    return 5;
  }

  // Font-related properties
  const fontProperties = ["font-family", "font-weight", "font-style"];
  if (fontProperties.includes(propertyName)) {
    if (lowerVarName.includes("font")) {
      return 10;
    }
    if (lowerVarName.includes("color") || lowerVarName.includes("spacing")) {
      return 0;
    }
    return 5;
  }

  // Default: no strong preference, keep all
  return -1;
}

test("color variables score high for color properties", () => {
  assert.strictEqual(scoreVariableRelevance("--primary-color", "color"), 10);
  assert.strictEqual(scoreVariableRelevance("--bg-main", "background"), 10);
  assert.strictEqual(scoreVariableRelevance("--text-accent", "color"), 10);
  assert.strictEqual(scoreVariableRelevance("--border-highlight", "border-color"), 10);
});

test("spacing variables score low for color properties", () => {
  assert.strictEqual(scoreVariableRelevance("--spacing-md", "color"), 0);
  assert.strictEqual(scoreVariableRelevance("--margin-top", "background"), 0);
  assert.strictEqual(scoreVariableRelevance("--padding-large", "color"), 0);
});

test("spacing variables score high for spacing properties", () => {
  assert.strictEqual(scoreVariableRelevance("--spacing-sm", "margin"), 10);
  assert.strictEqual(scoreVariableRelevance("--padding-md", "padding-top"), 10);
  assert.strictEqual(scoreVariableRelevance("--gap-xs", "gap"), 10);
});

test("color variables score low for spacing properties", () => {
  assert.strictEqual(scoreVariableRelevance("--color-primary", "margin"), 0);
  assert.strictEqual(scoreVariableRelevance("--bg-secondary", "padding"), 0);
});

test("size variables score high for size properties", () => {
  assert.strictEqual(scoreVariableRelevance("--width-full", "width"), 10);
  assert.strictEqual(scoreVariableRelevance("--height-screen", "height"), 10);
  assert.strictEqual(scoreVariableRelevance("--size-lg", "max-width"), 10);
});

test("font variables score high for font properties", () => {
  assert.strictEqual(scoreVariableRelevance("--font-sans", "font-family"), 10);
  assert.strictEqual(scoreVariableRelevance("--font-bold", "font-weight"), 10);
});

test("radius variables score high for radius properties", () => {
  assert.strictEqual(scoreVariableRelevance("--radius-sm", "border-radius"), 10);
  assert.strictEqual(scoreVariableRelevance("--rounded-lg", "border-top-left-radius"), 10);
});

test("generic variables get medium score", () => {
  assert.strictEqual(scoreVariableRelevance("--something", "color"), 5);
  assert.strictEqual(scoreVariableRelevance("--value", "margin"), 5);
  assert.strictEqual(scoreVariableRelevance("--misc", "width"), 5);
});

test("no property context returns -1 (keep all)", () => {
  assert.strictEqual(scoreVariableRelevance("--any-var", null), -1);
  assert.strictEqual(scoreVariableRelevance("--color-red", null), -1);
  assert.strictEqual(scoreVariableRelevance("--spacing-md", null), -1);
});

test("unknown property returns -1 (keep all)", () => {
  assert.strictEqual(scoreVariableRelevance("--custom", "custom-property"), -1);
  assert.strictEqual(scoreVariableRelevance("--var", "unknown"), -1);
});

test("case insensitive matching", () => {
  assert.strictEqual(scoreVariableRelevance("--PRIMARY-COLOR", "color"), 10);
  assert.strictEqual(scoreVariableRelevance("--BG-MAIN", "background"), 10);
  assert.strictEqual(scoreVariableRelevance("--SPACING-LG", "margin"), 10);
});

test("compound names with multiple keywords", () => {
  // Has both "text" and "color" - should be high for color properties
  assert.strictEqual(scoreVariableRelevance("--text-color-primary", "color"), 10);
  
  // Has "padding" and "spacing" - should be high for spacing properties
  assert.strictEqual(scoreVariableRelevance("--padding-spacing-md", "padding"), 10);
});

test("semantic color names score high", () => {
  assert.strictEqual(scoreVariableRelevance("--primary", "color"), 10);
  assert.strictEqual(scoreVariableRelevance("--secondary", "background"), 10);
  assert.strictEqual(scoreVariableRelevance("--accent", "color"), 10);
  assert.strictEqual(scoreVariableRelevance("--link", "color"), 10);
});

test("filter out irrelevant variables", () => {
  const variables = [
    { name: "--color-primary", score: scoreVariableRelevance("--color-primary", "margin") },
    { name: "--spacing-md", score: scoreVariableRelevance("--spacing-md", "margin") },
    { name: "--margin-top", score: scoreVariableRelevance("--margin-top", "margin") },
  ];
  
  const filtered = variables.filter(v => v.score !== 0);
  
  // Should filter out --color-primary (score 0)
  assert.strictEqual(filtered.length, 2);
  assert.ok(filtered.every(v => !v.name.includes("color")));
});

test("sort by relevance score", () => {
  const variables = [
    { name: "--generic", score: scoreVariableRelevance("--generic", "color") },
    { name: "--color-primary", score: scoreVariableRelevance("--color-primary", "color") },
    { name: "--spacing-md", score: scoreVariableRelevance("--spacing-md", "color") },
  ];
  
  const sorted = variables
    .filter(v => v.score !== 0)
    .sort((a, b) => b.score - a.score);
  
  // --color-primary (10) should be first, --generic (5) second
  assert.strictEqual(sorted[0].name, "--color-primary");
  assert.strictEqual(sorted[1].name, "--generic");
  // --spacing-md should be filtered out (score 0)
  assert.strictEqual(sorted.length, 2);
});

test("completion ranking for background property", () => {
  const vars = ["--bg-primary", "--text-color", "--spacing-lg", "--generic"];
  const scored = vars.map(name => ({
    name,
    score: scoreVariableRelevance(name, "background"),
  }));
  
  const sorted = scored
    .filter(v => v.score !== 0)
    .sort((a, b) => b.score - a.score);
  
  // --bg-primary should rank first (10)
  assert.strictEqual(sorted[0].name, "--bg-primary");
  // --spacing-lg should be filtered out (0)
  assert.ok(!sorted.some(v => v.name === "--spacing-lg"));
});

test("completion ranking for padding property", () => {
  const vars = ["--padding-sm", "--color-blue", "--spacing-md", "--width-full"];
  const scored = vars.map(name => ({
    name,
    score: scoreVariableRelevance(name, "padding-top"),
  }));
  
  const sorted = scored
    .filter(v => v.score !== 0)
    .sort((a, b) => b.score - a.score);
  
  // High relevance spacing vars should come first
  const topNames = sorted.slice(0, 2).map(v => v.name);
  assert.ok(topNames.includes("--padding-sm"));
  assert.ok(topNames.includes("--spacing-md"));
  
  // Color vars should be filtered
  assert.ok(!sorted.some(v => v.name === "--color-blue"));
});

test("completion ranking for border-radius property", () => {
  const vars = ["--radius-md", "--rounded-lg", "--color-primary", "--spacing-sm"];
  const scored = vars.map(name => ({
    name,
    score: scoreVariableRelevance(name, "border-radius"),
  }));
  
  const sorted = scored
    .filter(v => v.score !== 0)
    .sort((a, b) => b.score - a.score);
  
  // Radius variables should rank highest
  assert.strictEqual(sorted[0].name, "--radius-md");
  assert.strictEqual(sorted[1].name, "--rounded-lg");
});

test("alphabetical sorting for same score", () => {
  const vars = ["--z-var", "--a-var", "--m-var"];
  const scored = vars.map(name => ({
    name,
    score: scoreVariableRelevance(name, "color"),
  }));
  
  // All should have same score (5 - generic)
  assert.ok(scored.every(v => v.score === 5));
  
  const sorted = scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });
  
  assert.strictEqual(sorted[0].name, "--a-var");
  assert.strictEqual(sorted[1].name, "--m-var");
  assert.strictEqual(sorted[2].name, "--z-var");
});

test("fill and stroke properties for SVG", () => {
  assert.strictEqual(scoreVariableRelevance("--icon-color", "fill"), 10);
  assert.strictEqual(scoreVariableRelevance("--stroke-primary", "stroke"), 10);
  assert.strictEqual(scoreVariableRelevance("--border-color", "fill"), 10);
});

test("outline-color property", () => {
  // --outline-focus doesn't match the specific keywords, gets medium score
  assert.strictEqual(scoreVariableRelevance("--outline-focus", "outline-color"), 5);
  assert.strictEqual(scoreVariableRelevance("--color-accent", "outline-color"), 10);
});

test("text-decoration-color property", () => {
  assert.strictEqual(scoreVariableRelevance("--link-underline", "text-decoration-color"), 10);
  assert.strictEqual(scoreVariableRelevance("--text-color", "text-decoration-color"), 10);
});
