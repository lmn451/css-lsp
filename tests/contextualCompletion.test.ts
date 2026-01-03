import { test } from "node:test";
import { strict as assert } from "node:assert";
import { CssVariableManager } from "../src/cssVariableManager";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  TextDocumentPositionParams,
  CompletionItem,
} from "vscode-languageserver/node";

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
  const text = doc.getText();
  const offset = doc.offsetAt(position);
  
  // Check if we're in a CSS value context (simplified from server.ts)
  const beforeCursor = text.slice(Math.max(0, offset - 200), offset);
  
  // Check if we're inside var()
  const varMatch = beforeCursor.match(/var\(\s*(--[\w-]*)$/);
  if (varMatch) {
    return manager.getAllVariables().map((v) => ({
      label: v.name,
      kind: 13, // CompletionItemKind.Variable
      detail: v.value,
    }));
  }
  
  // Check if we're in a property value position
  let inBraces = 0;
  let inParens = 0;
  let lastColonPos = -1;
  let lastSemicolonPos = -1;
  let lastBracePos = -1;

  for (let i = beforeCursor.length - 1; i >= 0; i--) {
    const char = beforeCursor[i];
    if (char === ")") inParens++;
    else if (char === "(") {
      inParens--;
      if (inParens < 0) break;
    } else if (char === "}") inBraces++;
    else if (char === "{") {
      inBraces--;
      if (inBraces < 0) {
        lastBracePos = i;
        break;
      }
    } else if (char === ":" && inParens === 0 && inBraces === 0 && lastColonPos === -1) {
      lastColonPos = i;
    } else if (char === ";" && inParens === 0 && inBraces === 0 && lastSemicolonPos === -1) {
      lastSemicolonPos = i;
    }
  }

  if (lastColonPos > lastSemicolonPos && lastColonPos > lastBracePos) {
    const beforeColon = beforeCursor.slice(0, lastColonPos).trim();
    const propertyMatch = beforeColon.match(/[\w-]+$/);
    if (propertyMatch) {
      return manager.getAllVariables().map((v) => ({
        label: v.name,
        kind: 13,
        detail: v.value,
      }));
    }
  }

  // Check for HTML style attribute
  const styleAttrMatch = beforeCursor.match(/style\s*=\s*["'][^"']*:\s*[^"';]*$/i);
  if (styleAttrMatch) {
    return manager.getAllVariables().map((v) => ({
      label: v.name,
      kind: 13,
      detail: v.value,
    }));
  }

  return [];
}

test("completion suggests variables inside var()", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --primary: red; --secondary: blue; }", "file:///vars.css", "css");
  
  const completions = getCompletionsAt(manager, ".btn { color: var(--|) }");
  
  assert.strictEqual(completions.length, 2);
  assert.ok(completions.some((c) => c.label === "--primary"));
  assert.ok(completions.some((c) => c.label === "--secondary"));
});

test("completion suggests variables after property colon", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --bg-color: white; }", "file:///vars.css", "css");
  
  const completions = getCompletionsAt(manager, ".box { background: | }");
  
  assert.strictEqual(completions.length, 1);
  assert.strictEqual(completions[0].label, "--bg-color");
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
  
  const completions = getCompletionsAt(manager, '<div style="color: |">', "html");
  
  assert.ok(completions.length > 0);
  assert.ok(completions.some((c) => c.label === "--text-color"));
});

test("completion works after semicolon in declaration block", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --primary: red; --secondary: blue; }", "file:///vars.css", "css");
  
  const completions = getCompletionsAt(manager, ".selector { color: red; background: | }");
  
  assert.strictEqual(completions.length, 2);
});

test("completion works in nested var() fallback", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --fallback: gray; }", "file:///vars.css", "css");
  
  const completions = getCompletionsAt(manager, ".box { color: var(--primary, var(--|)) }");
  
  assert.ok(completions.some((c) => c.label === "--fallback"));
});

test("completion works across multiple lines", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --margin: 20px; }", "file:///vars.css", "css");
  
  const content = `.container {
  color: red;
  background: |
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
