import { test } from "node:test";
import { strict as assert } from "node:assert";
import { CssVariableManager } from "../src/cssVariableManager";
import { TextDocument } from "vscode-languageserver-textdocument";

function createDoc(uri: string, content: string, languageId: string = "css") {
  return TextDocument.create(uri, languageId, 1, content);
}

test("color resolution respects !important flag", () => {
  const manager = new CssVariableManager();
  const css = `
    :root { --color: #ff0000; }
    div { --color: #0000ff !important; }
    .class { --color: #00ff00; }
  `;
  manager.parseContent(css, "file:///test.css", "css");

  const color = manager.resolveVariableColor("--color");
  assert.ok(color);
  // Blue should win because of !important
  assert.strictEqual(color.red, 0);
  assert.strictEqual(color.green, 0);
  assert.strictEqual(color.blue, 1);
});

test("color resolution uses specificity when no !important", () => {
  const manager = new CssVariableManager();
  const css = `
    :root { --color: #ff0000; }
    div { --color: #00ff00; }
    #id { --color: #0000ff; }
  `;
  manager.parseContent(css, "file:///test.css", "css");

  const color = manager.resolveVariableColor("--color");
  assert.ok(color);
  // Blue should win because #id has highest specificity
  assert.strictEqual(color.red, 0);
  assert.strictEqual(color.green, 0);
  assert.strictEqual(color.blue, 1);
});

test("color resolution uses source order for equal specificity", () => {
  const manager = new CssVariableManager();
  const css = `
    :root { --color: #ff0000; }
    :root { --color: #0000ff; }
  `;
  manager.parseContent(css, "file:///test.css", "css");

  const color = manager.resolveVariableColor("--color");
  assert.ok(color);
  // Blue should win because it comes later in source
  assert.strictEqual(color.red, 0);
  assert.strictEqual(color.green, 0);
  assert.strictEqual(color.blue, 1);
});

test("color resolution handles variable references", () => {
  const manager = new CssVariableManager();
  const css = `
    :root {
      --primary: #ff0000;
      --text-color: var(--primary);
    }
  `;
  manager.parseContent(css, "file:///test.css", "css");

  const color = manager.resolveVariableColor("--text-color");
  assert.ok(color);
  assert.strictEqual(color.red, 1);
  assert.strictEqual(color.green, 0);
  assert.strictEqual(color.blue, 0);
});

test("color resolution detects circular references", () => {
  const manager = new CssVariableManager();
  const css = `
    :root {
      --a: var(--b);
      --b: var(--a);
    }
  `;
  manager.parseContent(css, "file:///test.css", "css");

  const color = manager.resolveVariableColor("--a");
  assert.strictEqual(color, null);
});

test("color resolution handles multi-level variable chains", () => {
  const manager = new CssVariableManager();
  const css = `
    :root {
      --base: #00ff00;
      --level1: var(--base);
      --level2: var(--level1);
      --level3: var(--level2);
    }
  `;
  manager.parseContent(css, "file:///test.css", "css");

  const color = manager.resolveVariableColor("--level3");
  assert.ok(color);
  assert.strictEqual(color.red, 0);
  assert.strictEqual(color.green, 1);
  assert.strictEqual(color.blue, 0);
});

test("color resolution combines cascade rules correctly", () => {
  const manager = new CssVariableManager();
  const css = `
    :root { --color: #ff0000; }
    div { --color: #00ff00; }
    .class { --color: #0000ff; }
    #id { --color: #ffff00 !important; }
    body { --color: #800080; }
  `;
  manager.parseContent(css, "file:///test.css", "css");

  const color = manager.resolveVariableColor("--color");
  assert.ok(color);
  // Yellow should win because of !important on #id (highest priority)
  assert.strictEqual(color.red, 1);
  assert.strictEqual(color.green, 1);
  assert.strictEqual(color.blue, 0);
});

test("color resolution works across multiple files", () => {
  const manager = new CssVariableManager();
  
  manager.parseContent(
    ":root { --primary: #ff0000; }",
    "file:///base.css",
    "css"
  );
  manager.parseContent(
    "div { --primary: #0000ff; }",
    "file:///override.css",
    "css"
  );

  const color = manager.resolveVariableColor("--primary");
  assert.ok(color);
  // Should consider both files and use cascade rules
  // div has specificity (0,0,1), :root has (0,1,0) - so :root is higher
  // But div comes later in parsing, so if equal specificity, later wins
  // Actually :root is a pseudo-class with specificity (0,1,0) > div (0,0,1)
  // So red should win, not blue
  assert.strictEqual(color.red, 1);
});

test("color resolution with rgba values", () => {
  const manager = new CssVariableManager();
  const css = `
    :root {
      --transparent-red: rgba(255, 0, 0, 0.5);
    }
  `;
  manager.parseContent(css, "file:///test.css", "css");

  const color = manager.resolveVariableColor("--transparent-red");
  assert.ok(color);
  assert.strictEqual(color.red, 1);
  assert.strictEqual(color.green, 0);
  assert.strictEqual(color.blue, 0);
  assert.strictEqual(color.alpha, 0.5);
});

test("color resolution with hsl values", () => {
  const manager = new CssVariableManager();
  const css = `
    :root {
      --hsl-color: hsl(120, 100%, 50%);
    }
  `;
  manager.parseContent(css, "file:///test.css", "css");

  const color = manager.resolveVariableColor("--hsl-color");
  assert.ok(color);
  // HSL(120, 100%, 50%) = pure green
  assert.strictEqual(color.red, 0);
  assert.strictEqual(color.green, 1);
  assert.strictEqual(color.blue, 0);
});

test("color resolution returns null for non-color values", () => {
  const manager = new CssVariableManager();
  const css = `
    :root {
      --spacing: 10px;
      --font: Arial;
      --size: small;
      --ui-font: system-ui;
      --state: error;
    }
  `;
  manager.parseContent(css, "file:///test.css", "css");

  assert.strictEqual(manager.resolveVariableColor("--spacing"), null);
  assert.strictEqual(manager.resolveVariableColor("--font"), null);
  assert.strictEqual(manager.resolveVariableColor("--size"), null);
  assert.strictEqual(manager.resolveVariableColor("--ui-font"), null);
  assert.strictEqual(manager.resolveVariableColor("--state"), null);
});

test("color resolution with !important overrides higher specificity", () => {
  const manager = new CssVariableManager();
  const css = `
    #high-specificity { --color: #ff0000; }
    div { --color: #0000ff !important; }
  `;
  manager.parseContent(css, "file:///test.css", "css");

  const color = manager.resolveVariableColor("--color");
  assert.ok(color);
  // Blue wins despite lower specificity because of !important
  assert.strictEqual(color.blue, 1);
});
