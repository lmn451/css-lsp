import { test } from "node:test";
import { strict as assert } from "node:assert";
import { CssVariableManager } from "../src/cssVariableManager";
import { TextDocument } from "vscode-languageserver-textdocument";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node";
import { UndefinedVarFallbackMode } from "../src/runtimeConfig";

function createDoc(uri: string, content: string, languageId: string = "css") {
  return TextDocument.create(uri, languageId, 1, content);
}

/**
 * Simulates the diagnostic generation from server.ts
 */
function getDiagnostics(
  document: TextDocument,
  manager: CssVariableManager,
  options: { undefinedVarFallback?: UndefinedVarFallbackMode } = {},
): Diagnostic[] {
  const text = document.getText();
  const diagnostics: Diagnostic[] = [];
  const undefinedVarFallback = options.undefinedVarFallback ?? "warning";
  
  // Find all var(--variable) usages
  const usageRegex = /var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)/g;
  let match;

  while ((match = usageRegex.exec(text)) !== null) {
    const variableName = match[1];
    const hasFallback = Boolean(match[2]);
    const definitions = manager.getVariables(variableName);

    if (definitions.length === 0) {
      if (hasFallback && undefinedVarFallback === "off") {
        continue;
      }

      const severity =
        hasFallback && undefinedVarFallback === "info"
          ? DiagnosticSeverity.Information
          : DiagnosticSeverity.Warning;
      // Variable is used but not defined
      const startPos = document.positionAt(match.index);
      const endPos = document.positionAt(match.index + match[0].length);

      const diagnostic: Diagnostic = {
        severity,
        range: {
          start: startPos,
          end: endPos,
        },
        message: `CSS variable '${variableName}' is not defined in the workspace`,
        source: "css-variable-lsp",
      };

      diagnostics.push(diagnostic);
    }
  }

  return diagnostics;
}

test("diagnostics for undefined variable", () => {
  const manager = new CssVariableManager();
  const css = ".btn { color: var(--undefined-color); }";
  const doc = createDoc("file:///test.css", css);
  
  manager.parseDocument(doc);
  const diagnostics = getDiagnostics(doc, manager);

  assert.strictEqual(diagnostics.length, 1);
  assert.strictEqual(diagnostics[0].severity, DiagnosticSeverity.Warning);
  assert.ok(diagnostics[0].message.includes("--undefined-color"));
  assert.ok(diagnostics[0].message.includes("not defined"));
});

test("no diagnostics for defined variable", () => {
  const manager = new CssVariableManager();
  const css = `
    :root { --primary: red; }
    .btn { color: var(--primary); }
  `;
  const doc = createDoc("file:///test.css", css);
  
  manager.parseDocument(doc);
  const diagnostics = getDiagnostics(doc, manager);

  assert.strictEqual(diagnostics.length, 0);
});

test("diagnostics for multiple undefined variables", () => {
  const manager = new CssVariableManager();
  const css = `
    .btn {
      color: var(--undefined-1);
      background: var(--undefined-2);
      border: var(--undefined-3);
    }
  `;
  const doc = createDoc("file:///test.css", css);
  
  manager.parseDocument(doc);
  const diagnostics = getDiagnostics(doc, manager);

  assert.strictEqual(diagnostics.length, 3);
  assert.ok(diagnostics[0].message.includes("--undefined-1"));
  assert.ok(diagnostics[1].message.includes("--undefined-2"));
  assert.ok(diagnostics[2].message.includes("--undefined-3"));
});

test("diagnostics warn on fallback by default", () => {
  const manager = new CssVariableManager();
  const css = ".btn { color: var(--undefined, red); }";
  const doc = createDoc("file:///test.css", css);
  
  manager.parseDocument(doc);
  const diagnostics = getDiagnostics(doc, manager);

  // Still reports undefined by default.
  assert.strictEqual(diagnostics.length, 1);
});

test("diagnostics downgrade to info for fallback when configured", () => {
  const manager = new CssVariableManager();
  const css = ".btn { color: var(--undefined, red); }";
  const doc = createDoc("file:///test.css", css);

  manager.parseDocument(doc);
  const diagnostics = getDiagnostics(doc, manager, {
    undefinedVarFallback: "info",
  });

  assert.strictEqual(diagnostics.length, 1);
  assert.strictEqual(diagnostics[0].severity, DiagnosticSeverity.Information);
});

test("diagnostics omit fallback warnings when configured", () => {
  const manager = new CssVariableManager();
  const css = ".btn { color: var(--undefined, red); }";
  const doc = createDoc("file:///test.css", css);

  manager.parseDocument(doc);
  const diagnostics = getDiagnostics(doc, manager, {
    undefinedVarFallback: "off",
  });

  assert.strictEqual(diagnostics.length, 0);
});

test("diagnostics work across files", () => {
  const manager = new CssVariableManager();
  
  // Define variable in one file
  manager.parseContent(":root { --theme-color: blue; }", "file:///vars.css", "css");
  
  // Use it in another file
  const css = ".btn { color: var(--theme-color); }";
  const doc = createDoc("file:///styles.css", css);
  manager.parseDocument(doc);
  
  const diagnostics = getDiagnostics(doc, manager);
  assert.strictEqual(diagnostics.length, 0);
});

test("diagnostics detect usage of removed variables", () => {
  const manager = new CssVariableManager();
  
  // Initially define and use a variable
  manager.parseContent(":root { --color: red; }", "file:///vars.css", "css");
  const css = ".btn { color: var(--color); }";
  const doc = createDoc("file:///styles.css", css);
  manager.parseDocument(doc);
  
  // No diagnostics initially
  let diagnostics = getDiagnostics(doc, manager);
  assert.strictEqual(diagnostics.length, 0);
  
  // Remove the file with the definition
  manager.removeFile("file:///vars.css");
  
  // Now should have diagnostic
  diagnostics = getDiagnostics(doc, manager);
  assert.strictEqual(diagnostics.length, 1);
  assert.ok(diagnostics[0].message.includes("--color"));
});

test("diagnostics in HTML inline styles", () => {
  const manager = new CssVariableManager();
  const html = '<div style="color: var(--undefined-inline);"></div>';
  const doc = createDoc("file:///test.html", html, "html");
  
  manager.parseDocument(doc);
  const diagnostics = getDiagnostics(doc, manager);

  assert.strictEqual(diagnostics.length, 1);
  assert.ok(diagnostics[0].message.includes("--undefined-inline"));
});

test("diagnostics in HTML style blocks", () => {
  const manager = new CssVariableManager();
  const html = `
    <html>
      <head>
        <style>
          .btn { color: var(--missing-var); }
        </style>
      </head>
    </html>
  `;
  const doc = createDoc("file:///test.html", html, "html");
  
  manager.parseDocument(doc);
  const diagnostics = getDiagnostics(doc, manager);

  assert.strictEqual(diagnostics.length, 1);
  assert.ok(diagnostics[0].message.includes("--missing-var"));
});

test("no diagnostics for variable definitions", () => {
  const manager = new CssVariableManager();
  const css = ":root { --my-var: red; }";
  const doc = createDoc("file:///test.css", css);
  
  manager.parseDocument(doc);
  const diagnostics = getDiagnostics(doc, manager);

  assert.strictEqual(diagnostics.length, 0);
});

test("diagnostics range covers entire var() expression", () => {
  const manager = new CssVariableManager();
  const css = ".btn { color: var(--undefined); }";
  const doc = createDoc("file:///test.css", css);
  
  manager.parseDocument(doc);
  const diagnostics = getDiagnostics(doc, manager);

  assert.strictEqual(diagnostics.length, 1);
  
  const range = diagnostics[0].range;
  const startOffset = doc.offsetAt(range.start);
  const endOffset = doc.offsetAt(range.end);
  const highlightedText = css.substring(startOffset, endOffset);
  
  assert.strictEqual(highlightedText, "var(--undefined)");
});

test("diagnostics handle nested var() expressions", () => {
  const manager = new CssVariableManager();
  const css = ".btn { color: var(--undefined-1, var(--undefined-2)); }";
  const doc = createDoc("file:///test.css", css);
  
  manager.parseDocument(doc);
  const diagnostics = getDiagnostics(doc, manager);

  // The diagnostic regex matches the outer var() call but not nested ones
  // This is correct behavior - if the outer var is undefined, that's the error
  // The nested fallback is only relevant if the outer variable is defined
  assert.strictEqual(diagnostics.length, 1);
  assert.ok(diagnostics[0].message.includes("--undefined-1"));
});

test("diagnostics in SCSS files", () => {
  const manager = new CssVariableManager();
  const scss = `
    $sass-var: 10px; // SCSS variable, ignored
    .btn {
      color: var(--undefined-css-var); // CSS variable, should diagnose
    }
  `;
  const doc = createDoc("file:///test.scss", scss, "scss");
  
  manager.parseDocument(doc);
  const diagnostics = getDiagnostics(doc, manager);

  assert.strictEqual(diagnostics.length, 1);
  assert.ok(diagnostics[0].message.includes("--undefined-css-var"));
});

test("diagnostics work after file updates", () => {
  const manager = new CssVariableManager();
  
  // Initial: no variable defined
  let css = ".btn { color: var(--dynamic); }";
  let doc = createDoc("file:///test.css", css);
  manager.parseDocument(doc);
  
  let diagnostics = getDiagnostics(doc, manager);
  assert.strictEqual(diagnostics.length, 1);
  
  // Update: define the variable
  css = `:root { --dynamic: blue; }
.btn { color: var(--dynamic); }`;
  doc = createDoc("file:///test.css", css);
  manager.parseDocument(doc);
  
  diagnostics = getDiagnostics(doc, manager);
  assert.strictEqual(diagnostics.length, 0);
});
