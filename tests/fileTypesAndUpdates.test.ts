import { test } from "node:test";
import { strict as assert } from "node:assert";
import { CssVariableManager } from "../src/cssVariableManager";
import { TextDocument } from "vscode-languageserver-textdocument";

function createDoc(uri: string, content: string, languageId: string = "css") {
  return TextDocument.create(uri, languageId, 1, content);
}

test("SCSS support", () => {
  const manager = new CssVariableManager();
  const content = `
	$ignored-sass-var: 10px;
	:root {
		--scss-var: #f00;
	}
	.nested {
		--nested-scss-var: #0f0;
		color: var(--scss-var);
	}
	`;
  const doc = createDoc("file:///test.scss", content, "scss");
  manager.parseDocument(doc);

  const vars = manager.getAllVariables();
  const scssVar = vars.find((v) => v.name === "--scss-var");
  const nestedVar = vars.find((v) => v.name === "--nested-scss-var");

  assert.ok(scssVar);
  assert.strictEqual(scssVar?.value, "#f00");

  assert.ok(nestedVar);
  assert.strictEqual(nestedVar?.value, "#0f0");

  const usages = manager.getVariableUsages("--scss-var");
  assert.strictEqual(usages.length, 1);
});

test("LESS support", () => {
  const manager = new CssVariableManager();
  const content = `
	@ignored-less-var: 10px;
	:root {
		--less-var: #00f;
	}
	`;
  const doc = createDoc("file:///test.less", content, "less");
  manager.parseDocument(doc);

  const lessVar = manager.getVariables("--less-var")[0];
  assert.ok(lessVar);
  assert.strictEqual(lessVar.value, "#00f");
});

test("incremental updates remove file", () => {
  const manager = new CssVariableManager();
  const uri = "file:///incremental.css";
  const doc = createDoc(uri, ":root { --incremental: yes; }");

  manager.parseDocument(doc);
  assert.strictEqual(manager.getVariables("--incremental").length, 1);

  manager.removeFile(uri);
  assert.strictEqual(manager.getVariables("--incremental").length, 0);
});

test("incremental updates overwrite file", () => {
  const manager = new CssVariableManager();
  const uri = "file:///update.css";

  manager.parseDocument(createDoc(uri, ":root { --update-var: v1; }"));
  assert.strictEqual(manager.getVariables("--update-var")[0].value, "v1");

  manager.parseDocument(createDoc(uri, ":root { --update-var: v2; }"));
  const vars = manager.getVariables("--update-var");
  assert.strictEqual(vars.length, 1);
  assert.strictEqual(vars[0].value, "v2");
});
