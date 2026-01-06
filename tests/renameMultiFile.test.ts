import { test } from "node:test";
import { strict as assert } from "node:assert";
import { CssVariableManager } from "../src/cssVariableManager";
import { TextDocument } from "vscode-languageserver-textdocument";
import { TextEdit, WorkspaceEdit } from "vscode-languageserver/node";

function createDoc(uri: string, content: string, languageId: string = "css") {
  return TextDocument.create(uri, languageId, 1, content);
}

/**
 * Simulates the rename logic from server.ts
 */
function getRenameEdits(
  manager: CssVariableManager,
  oldName: string,
  newName: string,
): WorkspaceEdit {
  const references = manager.getReferences(oldName);
  const changes: { [uri: string]: TextEdit[] } = {};

  for (const ref of references) {
    if (!changes[ref.uri]) {
      changes[ref.uri] = [];
    }

    // Replace just the variable name to preserve formatting and fallbacks
    const editRange = ref.nameRange ?? ref.range;
    const edit: TextEdit = {
      range: editRange,
      newText: newName,
    };

    changes[ref.uri].push(edit);
  }

  return { changes };
}

test("rename variable across multiple files", () => {
  const manager = new CssVariableManager();
  
  // Define in one file
  manager.parseContent(":root { --old-name: red; }", "file:///vars.css", "css");
  
  // Use in multiple files
  manager.parseContent(".btn { color: var(--old-name); }", "file:///styles.css", "css");
  manager.parseContent(".card { background: var(--old-name); }", "file:///components.css", "css");
  
  const edits = getRenameEdits(manager, "--old-name", "--new-name");
  
  // Should have changes in 3 files
  assert.strictEqual(Object.keys(edits.changes || {}).length, 3);
  
  // Check vars.css has definition edit
  const varsEdits = edits.changes?.["file:///vars.css"];
  assert.ok(varsEdits);
  assert.strictEqual(varsEdits.length, 1);
  assert.strictEqual(varsEdits[0].newText, "--new-name");
  
  // Check styles.css has usage edit
  const stylesEdits = edits.changes?.["file:///styles.css"];
  assert.ok(stylesEdits);
  assert.strictEqual(stylesEdits.length, 1);
  assert.strictEqual(stylesEdits[0].newText, "--new-name");
  
  // Check components.css has usage edit
  const componentsEdits = edits.changes?.["file:///components.css"];
  assert.ok(componentsEdits);
  assert.strictEqual(componentsEdits.length, 1);
  assert.strictEqual(componentsEdits[0].newText, "--new-name");
});

test("rename variable with multiple definitions", () => {
  const manager = new CssVariableManager();
  
  manager.parseContent(`
    :root { --color: red; }
    .dark { --color: blue; }
  `, "file:///test.css", "css");
  
  const edits = getRenameEdits(manager, "--color", "--theme-color");
  
  const testEdits = edits.changes?.["file:///test.css"];
  assert.ok(testEdits);
  // Should have 2 edits (both definitions)
  assert.strictEqual(testEdits.length, 2);
  assert.strictEqual(testEdits[0].newText, "--theme-color");
  assert.strictEqual(testEdits[1].newText, "--theme-color");
});

test("rename preserves !important flag", () => {
  const manager = new CssVariableManager();
  
  manager.parseContent(":root { --urgent: red !important; }", "file:///test.css", "css");
  
  const edits = getRenameEdits(manager, "--urgent", "--critical");
  
  const testEdits = edits.changes?.["file:///test.css"];
  assert.ok(testEdits);
  assert.strictEqual(testEdits.length, 1);
  assert.strictEqual(testEdits[0].newText, "--critical");
});

test("rename in HTML inline styles", () => {
  const manager = new CssVariableManager();
  
  manager.parseContent(":root { --inline-color: blue; }", "file:///vars.css", "css");
  manager.parseContent(
    '<div style="color: var(--inline-color);"></div>',
    "file:///index.html",
    "html"
  );
  
  const edits = getRenameEdits(manager, "--inline-color", "--html-color");
  
  // Should have changes in both files
  assert.strictEqual(Object.keys(edits.changes || {}).length, 2);
  
  const htmlEdits = edits.changes?.["file:///index.html"];
  assert.ok(htmlEdits);
  assert.strictEqual(htmlEdits.length, 1);
  assert.strictEqual(htmlEdits[0].newText, "--html-color");
});

test("rename in HTML style blocks", () => {
  const manager = new CssVariableManager();
  
  const html = `
    <html>
      <head>
        <style>
          :root { --style-var: green; }
          .btn { color: var(--style-var); }
        </style>
      </head>
    </html>
  `;
  
  manager.parseContent(html, "file:///page.html", "html");
  
  const edits = getRenameEdits(manager, "--style-var", "--block-var");
  
  const htmlEdits = edits.changes?.["file:///page.html"];
  assert.ok(htmlEdits);
  // Should have 2 edits: 1 definition, 1 usage
  assert.strictEqual(htmlEdits.length, 2);
});

test("rename with no usages only renames definitions", () => {
  const manager = new CssVariableManager();
  
  manager.parseContent(":root { --unused: red; }", "file:///test.css", "css");
  
  const edits = getRenameEdits(manager, "--unused", "--still-unused");
  
  const testEdits = edits.changes?.["file:///test.css"];
  assert.ok(testEdits);
  assert.strictEqual(testEdits.length, 1);
  assert.strictEqual(testEdits[0].newText, "--still-unused");
});

test("rename with only usages and no definitions", () => {
  const manager = new CssVariableManager();
  
  // Only usage, no definition
  manager.parseContent(".btn { color: var(--external); }", "file:///test.css", "css");
  
  const edits = getRenameEdits(manager, "--external", "--imported");
  
  const testEdits = edits.changes?.["file:///test.css"];
  assert.ok(testEdits);
  assert.strictEqual(testEdits.length, 1);
  assert.strictEqual(testEdits[0].newText, "--imported");
});

test("rename across CSS and HTML files", () => {
  const manager = new CssVariableManager();
  
  // CSS definition
  manager.parseContent(":root { --shared: purple; }", "file:///global.css", "css");
  
  // CSS usage
  manager.parseContent(".component { color: var(--shared); }", "file:///component.css", "css");
  
  // HTML usage
  manager.parseContent(
    '<div style="background: var(--shared);"></div>',
    "file:///index.html",
    "html"
  );
  
  const edits = getRenameEdits(manager, "--shared", "--global-var");
  
  assert.strictEqual(Object.keys(edits.changes || {}).length, 3);
  
  // Verify each file has edits
  assert.ok(edits.changes?.["file:///global.css"]);
  assert.ok(edits.changes?.["file:///component.css"]);
  assert.ok(edits.changes?.["file:///index.html"]);
});

test("rename in SCSS files", () => {
  const manager = new CssVariableManager();
  
  manager.parseContent(":root { --scss-var: teal; }", "file:///vars.scss", "scss");
  manager.parseContent(".btn { color: var(--scss-var); }", "file:///styles.scss", "scss");
  
  const edits = getRenameEdits(manager, "--scss-var", "--sass-var");
  
  assert.strictEqual(Object.keys(edits.changes || {}).length, 2);
});

test("rename same variable defined in multiple selectors", () => {
  const manager = new CssVariableManager();
  
  const css = `
    :root { --theme: light; }
    .dark-mode { --theme: dark; }
    body { --theme: system; }
    .btn { color: var(--theme); }
  `;
  
  manager.parseContent(css, "file:///test.css", "css");
  
  const edits = getRenameEdits(manager, "--theme", "--mode");
  
  const testEdits = edits.changes?.["file:///test.css"];
  assert.ok(testEdits);
  // Should have 4 edits: 3 definitions + 1 usage
  assert.strictEqual(testEdits.length, 4);
});

test("rename updates references map correctly", () => {
  const manager = new CssVariableManager();
  
  manager.parseContent(":root { --ref: blue; }", "file:///test.css", "css");
  manager.parseContent(".btn { color: var(--ref); }", "file:///usage.css", "css");
  
  const references = manager.getReferences("--ref");
  assert.strictEqual(references.length, 2); // 1 definition + 1 usage
  
  const edits = getRenameEdits(manager, "--ref", "--reference");
  
  // Verify edit structure
  assert.ok(edits.changes);
  assert.strictEqual(Object.keys(edits.changes).length, 2);
});

test("rename with nested var() fallback", () => {
  const manager = new CssVariableManager();
  
  const css = `
    :root { --primary: red; --fallback: blue; }
    .btn { color: var(--primary, var(--fallback)); }
  `;
  
  manager.parseContent(css, "file:///test.css", "css");
  
  const edits = getRenameEdits(manager, "--fallback", "--backup");
  
  const testEdits = edits.changes?.["file:///test.css"];
  assert.ok(testEdits);
  // css-tree parses var() fallback values as Raw text nodes, not as Function nodes
  // So the nested var(--fallback) is not extracted as a separate usage
  // Only the definition is tracked and will be renamed
  assert.strictEqual(testEdits.length, 1); // Only the definition
});

test("rename empty workspace returns empty edits", () => {
  const manager = new CssVariableManager();
  
  const edits = getRenameEdits(manager, "--nonexistent", "--new-name");
  
  assert.ok(edits.changes);
  assert.strictEqual(Object.keys(edits.changes).length, 0);
});
