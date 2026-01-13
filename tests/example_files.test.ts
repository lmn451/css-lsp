import { test } from "node:test";
import { strict as assert } from "node:assert";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CssVariableManager } from "../src/cssVariableManager";
import { collectDocumentColors } from "../src/colorProvider";

function createDoc(uri: string, content: string, languageId: string) {
  return TextDocument.create(uri, languageId, 1, content);
}

test("collectDocumentColors finds colors in example .vue file", () => {
  const manager = new CssVariableManager();
  const uri = "file:///Users/applesucks/dev/css-lsp/example/index.vue";
  const vueContent = `<template>
  <div class="container" style="color: var(--vue-color); background: var(--vue-bg);">
    Vue example
  </div>
</template>

<style>
:root {
  --vue-color: #e11d48;
  --vue-bg: #ffe4e6;
}

.container {
  padding: 1rem;
  border: 1px solid var(--vue-color);
}
</style>
`;
  const doc = createDoc(uri, vueContent, "vue");
  manager.parseDocument(doc);

  const colors = collectDocumentColors(doc, manager, {
    enabled: true,
    onlyVariables: false,
  });

  // Should find:
  // 1. --vue-color: #e11d48 (definition)
  // 2. --vue-bg: #ffe4e6 (definition)
  // 3. var(--vue-color) in inline style
  // 4. var(--vue-bg) in inline style
  // 5. var(--vue-color) in .container
  console.log(`Found ${colors.length} colors in example .vue file`);
  for (const c of colors) {
    console.log(
      `Color at ${c.range.start.line}:${c.range.start.character} - ${c.range.end.line}:${c.range.end.character}`
    );
  }

  assert.equal(colors.length, 5, "Should find 5 colors in example .vue file");
});

test("collectDocumentColors finds colors in example .css file", () => {
  const manager = new CssVariableManager();
  const uri = "file:///Users/applesucks/dev/css-lsp/example/index.css";
  const cssContent = `:root {
  --primary: #ff0000;
  --x: var(--primary);
  --secondary-color: #00ff00;
}
`;
  const doc = createDoc(uri, cssContent, "css");
  manager.parseDocument(doc);

  const colors = collectDocumentColors(doc, manager, {
    enabled: true,
    onlyVariables: false,
  });

  // Should find:
  // 1. --primary: red (definition)
  // 2. --x: var(--primary) (usage resolved to red)
  // 3. --secondary-color: green (definition)
  // Note: --x is a variable that resolves to another variable, so we might get fewer if not resolving properly
  console.log(`Found ${colors.length} colors in example .css file`);
  for (const c of colors) {
    console.log(
      `Color at ${c.range.start.line}:${c.range.start.character} - ${c.range.end.line}:${c.range.end.character}`
    );
  }

  // At minimum: 2 definitions + 1 usage = 3
  assert.ok(
    colors.length >= 3,
    "Should find at least 3 colors in example .css file"
  );
});
