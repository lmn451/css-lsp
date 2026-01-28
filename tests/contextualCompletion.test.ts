import { test } from "node:test";
import { strict as assert } from "node:assert";
import { CssVariableManager } from "../src/cssVariableManager";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionItem } from "vscode-languageserver/node";
import { getCssCompletionContext } from "../src/completionContext";

function createDoc(uri: string, content: string, languageId: string = "css") {
  return TextDocument.create(uri, languageId, 1, content);
}

/**
 * Helper to get completions at a specific position marked by | in the content
 */
function getCompletionsAt(
  manager: CssVariableManager,
  content: string,
  languageId: string = "css",
): CompletionItem[] {
  const cursorPos = content.indexOf("|");
  if (cursorPos === -1) {
    throw new Error("Content must contain | to mark cursor position");
  }

  const contentWithoutMarker = content.slice(0, cursorPos) + content.slice(cursorPos + 1);
  const doc = createDoc("file:///test.css", contentWithoutMarker, languageId);
  
  // Mock the server's completion logic
  const position = doc.positionAt(cursorPos);
  const completionContext = getCssCompletionContext(doc, position);
  if (!completionContext) {
    return [];
  }

  return manager.getAllVariables().map((v) => ({
    label: v.name,
    kind: 13, // CompletionItemKind.Variable
    detail: v.value,
    insertText: v.name,
  }));
}

test("completion suggests variables inside var()", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --primary: red; --secondary: blue; }", "file:///vars.css", "css");
  
  const completions = getCompletionsAt(manager, ".btn { color: var(--|) }");
  
  assert.strictEqual(completions.length, 2);
  assert.ok(completions.some((c) => c.label === "--primary"));
  assert.ok(completions.some((c) => c.label === "--secondary"));
});

test("no completion after property colon without var()", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --bg-color: white; }", "file:///vars.css", "css");
  
  const completions = getCompletionsAt(manager, ".box { background: | }");
  
  assert.strictEqual(completions.length, 0);
});

test("completion works in multi-value properties", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --spacing: 10px; }", "file:///vars.css", "css");
  
  const completions = getCompletionsAt(manager, ".box { padding: 5px var(--|) }");
  
  assert.ok(completions.length > 0);
  assert.ok(completions.some((c) => c.label === "--spacing"));
});

test("no completion in property name position", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --color: red; }", "file:///vars.css", "css");
  
  const completions = getCompletionsAt(manager, ".selector { col| }");
  
  assert.strictEqual(completions.length, 0);
});

test("no completion in selector position", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --color: red; }", "file:///vars.css", "css");
  
  const completions = getCompletionsAt(manager, ".my-class| { color: red; }");
  
  assert.strictEqual(completions.length, 0);
});

test("completion works in HTML style attribute", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --text-color: black; }", "file:///vars.css", "css");
  
  const completions = getCompletionsAt(
    manager,
    '<div style="color: var(--|)">',
    "html",
  );
  
  assert.ok(completions.length > 0);
  assert.ok(completions.some((c) => c.label === "--text-color"));
});

test("completion works in HTML style block", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --text-color: black; }", "file:///vars.css", "css");

  const completions = getCompletionsAt(
    manager,
    "<style>.btn { color: var(--|) }</style>",
    "html",
  );

  assert.ok(completions.length > 0);
  assert.ok(completions.some((c) => c.label === "--text-color"));
});

test("no completion in HTML outside style context", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --color: red; }", "file:///vars.css", "css");

  const completions = getCompletionsAt(
    manager,
    '<div class="button|">Click</div>',
    "html",
  );

  assert.strictEqual(completions.length, 0);
});

test("completion works in non-CSS language when using var()", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --color: red; }", "file:///vars.css", "css");

  const completions = getCompletionsAt(
    manager,
    "const styles = `color: var(--|)`;",
    "javascript",
  );

  assert.ok(completions.length > 0);
  assert.ok(completions.some((c) => c.label === "--color"));
});

test("no completion in non-CSS language without var()", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --color: red; }", "file:///vars.css", "css");

  const completions = getCompletionsAt(
    manager,
    "const styles = { color: | };",
    "javascript",
  );

  assert.strictEqual(completions.length, 0);
});

test("no completion in selector pseudo-class", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --color: red; }", "file:///vars.css", "css");

  const completions = getCompletionsAt(
    manager,
    ".button:ho| { color: red; }",
  );

  assert.strictEqual(completions.length, 0);
});

test("completion works after semicolon in declaration block", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --primary: red; --secondary: blue; }", "file:///vars.css", "css");
  
  const completions = getCompletionsAt(
    manager,
    ".selector { color: red; background: var(--|) }",
  );
  
  assert.strictEqual(completions.length, 2);
});

test("completion works in nested var() fallback", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --fallback: gray; }", "file:///vars.css", "css");
  
  const completions = getCompletionsAt(manager, ".box { color: var(--primary, var(--|)) }");
  
  assert.ok(completions.some((c) => c.label === "--fallback"));
});

test("no completion in var() fallback value", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --fallback: gray; }", "file:///vars.css", "css");

  const completions = getCompletionsAt(
    manager,
    ".box { color: var(--primary, |) }",
  );

  assert.strictEqual(completions.length, 0);
});

test("completion works across multiple lines", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --margin: 20px; }", "file:///vars.css", "css");
  
  const content = `.container {
  color: red;
  background: var(--|
}`;
  
  const completions = getCompletionsAt(manager, content);
  
  assert.ok(completions.length > 0);
  assert.ok(completions.some((c) => c.label === "--margin"));
});

test("completion shows variable values in detail", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --theme-color: #ff5500; }", "file:///vars.css", "css");
  
  const completions = getCompletionsAt(manager, ".btn { color: var(--|) }");
  
  const themeColor = completions.find((c) => c.label === "--theme-color");
  assert.ok(themeColor);
  assert.strictEqual(themeColor.detail, "#ff5500");
});
