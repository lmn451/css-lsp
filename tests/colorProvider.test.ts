import { test } from "node:test";
import { strict as assert } from "node:assert";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CssVariableManager } from "../src/cssVariableManager";
import {
  collectColorPresentations,
  collectDocumentColors,
} from "../src/colorProvider";

function createDoc(uri: string, content: string, languageId: string = "css") {
  return TextDocument.create(uri, languageId, 1, content);
}

test("collectDocumentColors returns empty when disabled", () => {
  const manager = new CssVariableManager();
  const uri = "file:///colors.css";
  const css = ":root { --primary: #ff0000; }";
  const doc = createDoc(uri, css);
  manager.parseDocument(doc);

  const colors = collectDocumentColors(doc, manager, {
    enabled: false,
    onlyVariables: false,
  });

  assert.deepEqual(colors, []);
});

test("collectDocumentColors respects onlyVariables flag", () => {
  const manager = new CssVariableManager();
  const uri = "file:///colors-usage.css";
  const css = `
:root { --primary: #ff0000; }
.btn { color: var(--primary); }
`;
  const doc = createDoc(uri, css);
  manager.parseDocument(doc);

  const allColors = collectDocumentColors(doc, manager, {
    enabled: true,
    onlyVariables: false,
  });

  const usageOnly = collectDocumentColors(doc, manager, {
    enabled: true,
    onlyVariables: true,
  });

  assert.equal(allColors.length, 2);
  assert.equal(usageOnly.length, 1);
});

test("collectColorPresentations honors enabled flag", () => {
  const range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 3 },
  };
  const color = { red: 1, green: 0, blue: 0, alpha: 1 };

  const disabled = collectColorPresentations(range, color, false);
  const enabled = collectColorPresentations(range, color, true);

  assert.deepEqual(disabled, []);
  assert.equal(enabled.length, 3);
});

test("collectDocumentColors resolves named color variables", () => {
  const manager = new CssVariableManager();
  const uri = "file:///colors-named.css";
  const css = `
:root { --primary: red; }
.btn { color: var(--primary); }
`;
  const doc = createDoc(uri, css);
  manager.parseDocument(doc);

  const colors = collectDocumentColors(doc, manager, {
    enabled: true,
    onlyVariables: false,
  });

  assert.equal(colors.length, 2);
  assert.ok(
    colors.every(
      (entry) =>
        entry.color.red === 1 &&
        entry.color.green === 0 &&
        entry.color.blue === 0
    )
  );
});
