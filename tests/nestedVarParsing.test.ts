import { test } from "node:test";
import { strict as assert } from "node:assert";
import { CssVariableManager } from "../src/cssVariableManager";
import { TextDocument } from "vscode-languageserver-textdocument";

function createDoc(uri: string, content: string, languageId: string = "css") {
  return TextDocument.create(uri, languageId, 1, content);
}

test("css-tree parses nested var() in fallback as Raw node", () => {
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
  
  // The nested --fallback in the fallback value is NOT tracked as a usage
  // because css-tree parses the fallback as a Raw node, not as a Function node
  const fallbackUsages = manager.getVariableUsages("--fallback");
  assert.strictEqual(fallbackUsages.length, 0);
  
  // Both variables ARE defined, though
  assert.strictEqual(manager.getVariables("--primary").length, 1);
  assert.strictEqual(manager.getVariables("--fallback").length, 1);
});

test("multiple levels of nesting also parsed as Raw", () => {
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
  
  // Only the outermost var() is tracked
  assert.strictEqual(manager.getVariableUsages("--a").length, 1);
  assert.strictEqual(manager.getVariableUsages("--b").length, 0);
  assert.strictEqual(manager.getVariableUsages("--c").length, 0);
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

test("understanding css-tree's Raw node behavior", () => {
  const manager = new CssVariableManager();
  
  // This documents WHY nested var() isn't tracked:
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
  
  // This behavior is a limitation of how css-tree parses var() functions
  // The fallback portion is kept as raw text for flexibility
  assert.strictEqual(manager.getVariableUsages("--outer").length, 1);
  assert.strictEqual(manager.getVariableUsages("--inner").length, 0);
});

test("references (definitions + usages) only includes tracked items", () => {
  const manager = new CssVariableManager();
  
  const css = `
    :root { --primary: red; --fallback: blue; }
    .btn { color: var(--primary, var(--fallback)); }
  `;
  
  manager.parseContent(css, "file:///test.css", "css");
  
  // --primary has 1 definition + 1 usage = 2 references
  const primaryRefs = manager.getReferences("--primary");
  assert.strictEqual(primaryRefs.length, 2);
  
  // --fallback has 1 definition + 0 usages = 1 reference
  // (usage in nested var is not tracked)
  const fallbackRefs = manager.getReferences("--fallback");
  assert.strictEqual(fallbackRefs.length, 1);
});

test("rename doesn't affect untracked nested var() usages", () => {
  const manager = new CssVariableManager();
  
  const css = `
    :root { --primary: red; --fallback: blue; }
    .btn { color: var(--primary, var(--fallback)); }
  `;
  
  manager.parseContent(css, "file:///test.css", "css");
  
  // If we renamed --fallback, only the definition would be renamed
  // The nested usage in the fallback wouldn't be found/renamed
  // because it's stored as raw text
  const refs = manager.getReferences("--fallback");
  
  // Only 1 reference (the definition), not 2 (definition + usage)
  assert.strictEqual(refs.length, 1);
  assert.ok("value" in refs[0]); // It's a definition, not a usage
});
