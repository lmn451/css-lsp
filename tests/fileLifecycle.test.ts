import { test } from "node:test";
import { strict as assert } from "node:assert";
import { CssVariableManager } from "../src/cssVariableManager";
import { TextDocument } from "vscode-languageserver-textdocument";

function createDoc(uri: string, content: string, languageId: string = "css") {
  return TextDocument.create(uri, languageId, 1, content);
}

test("file open -> close -> reopen cycle", () => {
  const manager = new CssVariableManager();
  const uri = "file:///lifecycle1.css";
  const css = ":root { --lifecycle-var: green; }";
  const doc = createDoc(uri, css);

  manager.parseDocument(doc);
  let vars = manager.getVariables("--lifecycle-var");
  assert.strictEqual(vars.length, 1);
  assert.strictEqual(vars[0].value, "green");

  manager.removeFile(uri);
  vars = manager.getVariables("--lifecycle-var");
  assert.strictEqual(vars.length, 0);

  manager.parseDocument(doc);
  vars = manager.getVariables("--lifecycle-var");
  assert.strictEqual(vars.length, 1);
  assert.strictEqual(vars[0].value, "green");
});

test("no duplicates when workspace file is opened", () => {
  const manager = new CssVariableManager();
  const uri = "file:///workspace.css";
  const css = ":root { --workspace-var: purple; }";

  manager.parseContent(css, uri, "css");
  let vars = manager.getVariables("--workspace-var");
  assert.strictEqual(vars.length, 1);

  const doc = createDoc(uri, css);
  manager.parseDocument(doc);
  vars = manager.getVariables("--workspace-var");
  assert.strictEqual(vars.length, 1);
});

test("removeFile clears variables, usages, and DOM trees", () => {
  const manager = new CssVariableManager();
  const uri = "file:///complete.html";
  const html = `
<html>
<head>
	<style>
		:root {
			--def-var: orange;
		}
	</style>
</head>
<body>
	<div style="color: var(--usage-var);"></div>
</body>
</html>
`;
  const doc = createDoc(uri, html, "html");
  manager.parseDocument(doc);

  const defVars = manager.getVariables("--def-var");
  const usages = manager.getVariableUsages("--usage-var");
  const domTree = manager.getDOMTree(uri);

  assert.strictEqual(defVars.length, 1);
  assert.strictEqual(usages.length, 1);
  assert.ok(domTree);

  manager.removeFile(uri);

  const defVarsAfter = manager.getVariables("--def-var");
  const usagesAfter = manager.getVariableUsages("--usage-var");
  const domTreeAfter = manager.getDOMTree(uri);

  assert.strictEqual(defVarsAfter.length, 0);
  assert.strictEqual(usagesAfter.length, 0);
  assert.strictEqual(domTreeAfter, undefined);
});

test("multiple parses without duplicates", () => {
  const manager = new CssVariableManager();
  const uri = "file:///rapid.css";
  const css1 = ":root { --rapid-var: v1; }";
  const css2 = ":root { --rapid-var: v2; }";
  const css3 = ":root { --rapid-var: v3; }";

  manager.parseDocument(createDoc(uri, css1));
  let vars = manager.getVariables("--rapid-var");
  assert.strictEqual(vars.length, 1);
  assert.strictEqual(vars[0].value, "v1");

  manager.parseDocument(createDoc(uri, css2));
  vars = manager.getVariables("--rapid-var");
  assert.strictEqual(vars.length, 1);
  assert.strictEqual(vars[0].value, "v2");

  manager.parseDocument(createDoc(uri, css3));
  vars = manager.getVariables("--rapid-var");
  assert.strictEqual(vars.length, 1);
  assert.strictEqual(vars[0].value, "v3");
});

test("removeFile on non-existent file is safe", () => {
  const manager = new CssVariableManager();
  const uri = "file:///never-opened.css";
  manager.removeFile(uri);
  const vars = manager.getAllVariables();
  assert.ok(Array.isArray(vars));
});

test("multiple variable definitions and usages cleared", () => {
  const manager = new CssVariableManager();
  const uri = "file:///multi.css";
  const css = `
		:root {
			--var1: red;
			--var2: blue;
			--var3: green;
		}
		.class {
			color: var(--var1);
			background: var(--var2);
			border: var(--var3);
		}
	`;
  const doc = createDoc(uri, css);

  manager.parseDocument(doc);

  const var1Defs = manager.getVariables("--var1");
  const var2Defs = manager.getVariables("--var2");
  const var3Defs = manager.getVariables("--var3");
  const var1Uses = manager.getVariableUsages("--var1");
  const var2Uses = manager.getVariableUsages("--var2");
  const var3Uses = manager.getVariableUsages("--var3");

  assert.strictEqual(var1Defs.length, 1);
  assert.strictEqual(var2Defs.length, 1);
  assert.strictEqual(var3Defs.length, 1);
  assert.strictEqual(var1Uses.length, 1);
  assert.strictEqual(var2Uses.length, 1);
  assert.strictEqual(var3Uses.length, 1);

  manager.removeFile(uri);

  assert.strictEqual(manager.getVariables("--var1").length, 0);
  assert.strictEqual(manager.getVariables("--var2").length, 0);
  assert.strictEqual(manager.getVariables("--var3").length, 0);
  assert.strictEqual(manager.getVariableUsages("--var1").length, 0);
  assert.strictEqual(manager.getVariableUsages("--var2").length, 0);
  assert.strictEqual(manager.getVariableUsages("--var3").length, 0);
});
