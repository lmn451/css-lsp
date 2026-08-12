import { test } from "node:test";
import { strict as assert } from "node:assert";
import { CssVariableManager } from "../src/cssVariableManager";
import { TextDocument } from "vscode-languageserver-textdocument";

function createDoc(uri: string, content: string, languageId: string = "css") {
  return TextDocument.create(uri, languageId, 1, content);
}

test("nested var() in a fallback is tracked", () => {
  const manager = new CssVariableManager();
  
  // Define both variables
  const css = `
    :root { 
      --primary: red; 
      --fallback: blue; 
    }
    .btn { 
      color: var(--primary, var(--fallback)); 
    }
  `;
  
  manager.parseContent(css, "file:///test.css", "css");
  
  // Check that --primary usage is tracked
  const primaryUsages = manager.getVariableUsages("--primary");
  assert.strictEqual(primaryUsages.length, 1);
  
  // css-tree exposes the fallback as Raw text, but the manager still scans it.
  const fallbackUsages = manager.getVariableUsages("--fallback");
  assert.strictEqual(fallbackUsages.length, 1);
  const document = createDoc("file:///test.css", css);
  const nestedCall = "var(--fallback)";
  const nestedStart = css.indexOf(nestedCall);
  const nestedNameStart = css.indexOf("--fallback", nestedStart);
  assert.deepEqual(fallbackUsages[0].range, {
    start: document.positionAt(nestedStart),
    end: document.positionAt(nestedStart + nestedCall.length),
  });
  assert.deepEqual(fallbackUsages[0].nameRange, {
    start: document.positionAt(nestedNameStart),
    end: document.positionAt(nestedNameStart + "--fallback".length),
  });
  
  // Both variables ARE defined, though
  assert.strictEqual(manager.getVariables("--primary").length, 1);
  assert.strictEqual(manager.getVariables("--fallback").length, 1);
});

test("multiple levels of nested fallback usages are tracked", () => {
  const manager = new CssVariableManager();
  
  const css = `
    :root { 
      --a: red;
      --b: blue;
      --c: green;
    }
    .btn { 
      color: var(--a, var(--b, var(--c))); 
    }
  `;
  
  manager.parseContent(css, "file:///test.css", "css");
  
  assert.strictEqual(manager.getVariableUsages("--a").length, 1);
  assert.strictEqual(manager.getVariableUsages("--b").length, 1);
  assert.strictEqual(manager.getVariableUsages("--c").length, 1);
});

test("separate var() calls are all tracked", () => {
  const manager = new CssVariableManager();
  
  const css = `
    :root { 
      --primary: red;
      --secondary: blue;
    }
    .btn { 
      color: var(--primary); 
      background: var(--secondary);
    }
  `;
  
  manager.parseContent(css, "file:///test.css", "css");
  
  // When var() calls are separate (not nested), both are tracked
  assert.strictEqual(manager.getVariableUsages("--primary").length, 1);
  assert.strictEqual(manager.getVariableUsages("--secondary").length, 1);
});

test("var() in multiple properties tracks all usages", () => {
  const manager = new CssVariableManager();
  
  const css = `
    :root { --color: red; }
    .a { color: var(--color); }
    .b { background: var(--color); }
    .c { border-color: var(--color); }
  `;
  
  manager.parseContent(css, "file:///test.css", "css");
  
  // All three separate var(--color) calls are tracked
  const usages = manager.getVariableUsages("--color");
  assert.strictEqual(usages.length, 3);
});

test("fallback with static value doesn't create false usage", () => {
  const manager = new CssVariableManager();
  
  const css = `
    :root { --primary: red; }
    .btn { color: var(--primary, blue); }
  `;
  
  manager.parseContent(css, "file:///test.css", "css");
  
  // Static fallback values don't create variable usages
  assert.strictEqual(manager.getVariableUsages("--primary").length, 1);
  
  // No variable called "--blue" or "blue" should be tracked
  const allUsages = manager.getAllVariables()
    .flatMap(v => manager.getVariableUsages(v.name));
  
  assert.ok(!allUsages.some(u => u.name.includes("blue")));
});

test("raw fallback nodes are scanned for nested references", () => {
  const manager = new CssVariableManager();
  
  // css-tree parses var() arguments like this:
  //   var(--name, fallback)
  //   ├─ Identifier: --name
  //   ├─ Operator: ,
  //   └─ Raw: " fallback"  <-- Everything after comma is Raw text
  //
  // So var(--a, var(--b)) becomes:
  //   var(--a, var(--b))
  //   ├─ Identifier: --a
  //   ├─ Operator: ,
  //   └─ Raw: " var(--b)"  <-- Not parsed as a Function!
  
  const css = `
    :root { --outer: red; --inner: blue; }
    .btn { color: var(--outer, var(--inner)); }
  `;
  
  manager.parseContent(css, "file:///test.css", "css");
  
  assert.strictEqual(manager.getVariableUsages("--outer").length, 1);
  assert.strictEqual(manager.getVariableUsages("--inner").length, 1);
});

test("nested fallback usages are tracked in HTML inline styles", () => {
  const manager = new CssVariableManager();
  const html =
    '<div style="color: var(--primary, var(--fallback))"></div>';

  manager.parseContent(html, "file:///test.html", "html");

  assert.strictEqual(manager.getVariableUsages("--primary").length, 1);
  assert.strictEqual(manager.getVariableUsages("--fallback").length, 1);
});

test("quoted and commented fallback text does not create usages", () => {
  const manager = new CssVariableManager();
  const css = `
    .btn {
      color: var(--primary, "var(--quoted)" /* var(--commented) */);
    }
  `;

  manager.parseContent(css, "file:///test.css", "css");

  assert.strictEqual(manager.getVariableUsages("--primary").length, 1);
  assert.strictEqual(manager.getVariableUsages("--quoted").length, 0);
  assert.strictEqual(manager.getVariableUsages("--commented").length, 0);
});

test("references include nested fallback usages", () => {
  const manager = new CssVariableManager();
  
  const css = `
    :root { --primary: red; --fallback: blue; }
    .btn { color: var(--primary, var(--fallback)); }
  `;
  
  manager.parseContent(css, "file:///test.css", "css");
  
  // --primary has 1 definition + 1 usage = 2 references
  const primaryRefs = manager.getReferences("--primary");
  assert.strictEqual(primaryRefs.length, 2);
  
  // --fallback has 1 definition + 1 nested usage = 2 references
  const fallbackRefs = manager.getReferences("--fallback");
  assert.strictEqual(fallbackRefs.length, 2);
});

test("rename references include nested var() usages", () => {
  const manager = new CssVariableManager();
  
  const css = `
    :root { --primary: red; --fallback: blue; }
    .btn { color: var(--primary, var(--fallback)); }
  `;
  
  manager.parseContent(css, "file:///test.css", "css");
  
  const refs = manager.getReferences("--fallback");
  
  assert.strictEqual(refs.length, 2);
  assert.ok(refs.some((reference) => "value" in reference));
  assert.ok(refs.some((reference) => !("value" in reference)));
});
