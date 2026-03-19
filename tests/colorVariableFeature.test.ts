import { test } from "node:test";
import { strict as assert } from "node:assert";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { CssVariableManager } from "../src/cssVariableManager";
import {
  collectColorReplacementDiagnostics,
  getColorReplacementCodeActions,
  getColorReplacementCompletionItems,
} from "../src/colorVariableFeature";

function createDoc(uri: string, content: string, languageId: string = "css") {
  return TextDocument.create(uri, languageId, 1, content);
}

test("variables match by normalized color value", () => {
  const manager = new CssVariableManager();
  manager.parseContent(
    ":root { --white: #fff; --paper: rgb(255 255 255); --accent: #0d6efd; }",
    "file:///vars.css",
    "css"
  );

  const matches = manager.getVariablesByColor(
    { red: 1, green: 1, blue: 1, alpha: 1 },
    {}
  );

  assert.deepEqual(
    matches.map((match) => match.name),
    ["--paper", "--white"]
  );
});

test("document color literals are collected from compound values and skip var()", () => {
  const manager = new CssVariableManager();
  const doc = createDoc(
    "file:///test.css",
    ".card { background: linear-gradient(#fff, rgb(255 255 255), var(--paper)); box-shadow: 0 0 2px white; }"
  );

  manager.parseDocument(doc);
  const literals = manager.getDocumentColorLiterals(doc.uri);

  assert.deepEqual(
    literals.map((literal) => literal.value),
    ["#fff", "rgb(255 255 255)", "white"]
  );
});

test("diagnostics are informational and preserve multiple variable options", () => {
  const manager = new CssVariableManager();
  manager.parseContent(
    ":root { --white: #fff; --paper: rgb(255 255 255); }",
    "file:///vars.css",
    "css"
  );
  const doc = createDoc("file:///test.css", ".title { color: white; }");

  manager.parseDocument(doc);
  const diagnostics = collectColorReplacementDiagnostics(doc, manager);

  assert.strictEqual(diagnostics.length, 1);
  assert.strictEqual(diagnostics[0].severity, DiagnosticSeverity.Information);
  assert.match(diagnostics[0].message, /matching CSS variables: '--paper', '--white'/);
});

test("diagnostics are not shown on variable definitions", () => {
  const manager = new CssVariableManager();
  manager.parseContent(
    ":root { --white: #fff; --paper: rgb(255 255 255); }",
    "file:///vars.css",
    "css"
  );
  const doc = createDoc("file:///test.css", ":root { --white: #fff; }");

  manager.parseDocument(doc);
  const diagnostics = collectColorReplacementDiagnostics(doc, manager);

  // No diagnostics on definitions (only on usages)
  assert.strictEqual(diagnostics.length, 0);
});

test("diagnostic message includes variable name when only one match", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --white: #fff; }", "file:///vars.css", "css");
  const doc = createDoc("file:///test.css", ".title { color: white; }");

  manager.parseDocument(doc);
  const diagnostics = collectColorReplacementDiagnostics(doc, manager);

  assert.strictEqual(diagnostics.length, 1);
  assert.strictEqual(diagnostics[0].severity, DiagnosticSeverity.Information);
  assert.match(diagnostics[0].message, /matching CSS variable '--white'/);
});

test("completion items replace the full literal color token", () => {
  const manager = new CssVariableManager();
  manager.parseContent(":root { --white: #fff; }", "file:///vars.css", "css");

  const source = ".title { color: white; }";
  const doc = createDoc("file:///test.css", source);
  manager.parseDocument(doc);

  const completions = getColorReplacementCompletionItems(
    doc,
    doc.positionAt(source.indexOf("white") + 2),
    manager,
    { formatLocation: (uri) => uri }
  );

  assert.strictEqual(completions.length, 1);
  assert.strictEqual(completions[0].label, "var(--white)");
  assert.deepEqual(completions[0].textEdit, {
    range: {
      start: doc.positionAt(source.indexOf("white")),
      end: doc.positionAt(source.indexOf("white") + "white".length),
    },
    newText: "var(--white)",
  });
});

test("code actions return one quick fix per matching variable", () => {
  const manager = new CssVariableManager();
  manager.parseContent(
    ":root { --white: #fff; --paper: rgb(255 255 255); }",
    "file:///vars.css",
    "css"
  );
  const source = ".title { color: white; }";
  const doc = createDoc("file:///test.css", source);

  manager.parseDocument(doc);
  const diagnostics = collectColorReplacementDiagnostics(doc, manager);
  const actions = getColorReplacementCodeActions(doc, diagnostics);

  assert.strictEqual(actions.length, 2);
  assert.deepEqual(
    actions.map((action) => action.title),
    ["Replace with var(--paper)", "Replace with var(--white)"]
  );
});

test("literal detection works in html and less documents", () => {
  const manager = new CssVariableManager();
  const htmlDoc = createDoc(
    "file:///test.html",
    '<div style="color: white; background: linear-gradient(#fff, red)"></div>',
    "html"
  );
  const lessDoc = createDoc(
    "file:///test.less",
    ".box { color: white; border-color: #fff; }",
    "less"
  );

  manager.parseDocument(htmlDoc);
  manager.parseDocument(lessDoc);

  assert.ok(manager.getDocumentColorLiterals(htmlDoc.uri).length >= 2);
  assert.strictEqual(manager.getDocumentColorLiterals(lessDoc.uri).length, 2);
});
