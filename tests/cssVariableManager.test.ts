import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { CssVariableManager } from '../src/cssVariableManager';
import { TextDocument } from 'vscode-languageserver-textdocument';

function createDoc(uri: string, content: string, languageId: string = 'css') {
	return TextDocument.create(uri, languageId, 1, content);
}

test('basic CSS extraction', () => {
	const manager = new CssVariableManager();
	const doc = createDoc('file:///test.css', ':root { --main-color: red; }');
	manager.parseDocument(doc);
	const vars = manager.getAllVariables();
	assert.strictEqual(vars.length, 1);
	assert.strictEqual(vars[0].name, '--main-color');
	assert.strictEqual(vars[0].value, 'red');
});

test('HTML style extraction', () => {
	const manager = new CssVariableManager();
	const htmlContent = `
<html>
<style>
  :root { --html-color: blue; }
</style>
<body></body>
</html>`;
	const doc = createDoc('file:///test.html', htmlContent, 'html');
	manager.parseDocument(doc);
	const vars = manager.getVariables('--html-color');
	assert.strictEqual(vars.length, 1);
	assert.strictEqual(vars[0].value, 'blue');
});

test('multiple variables and updates', () => {
	const manager = new CssVariableManager();
	const doc = createDoc('file:///test.css', ':root { --v1: 10px; --v2: 20px; }');
	manager.parseDocument(doc);
	assert.strictEqual(manager.getAllVariables().length, 2);

	const docUpdated = createDoc('file:///test.css', ':root { --v1: 15px; }');
	manager.parseDocument(docUpdated);
	const v1 = manager.getVariables('--v1');
	assert.strictEqual(v1[0].value, '15px');
	assert.strictEqual(manager.getVariables('--v2').length, 0);
});

test('usage tracking and references', () => {
	const manager = new CssVariableManager();
	const doc = createDoc('file:///test.css', ':root { --color: red; } .box { color: var(--color); }');
	manager.parseDocument(doc);

	const usages = manager.getVariableUsages('--color');
	assert.strictEqual(usages.length, 1);

	const references = manager.getReferences('--color');
	assert.strictEqual(references.length, 2);
});

test('rename support collects defs and usages', () => {
	const manager = new CssVariableManager();
	const doc = createDoc('file:///test.css', ':root { --old: red; } .box { color: var(--old); }');
	manager.parseDocument(doc);

	const references = manager.getReferences('--old');
	assert.strictEqual(references.length, 2);

	const def = references.find(r => 'value' in r);
	const usage = references.find(r => !('value' in r));

	assert.ok(def);
	assert.ok(usage);
});

test('selector tracking for scoped overrides', () => {
	const manager = new CssVariableManager();
	const htmlContent = `
<html>
<style>
  :root { --primary-color: red; }
  div { --primary-color: blue; color: var(--primary-color); }
</style>
<body>
  <div>Test</div>
</body>
</html>`;

	const doc = createDoc('file:///test.html', htmlContent, 'html');
	manager.parseDocument(doc);

	const definitions = manager.getVariables('--primary-color');
	assert.strictEqual(definitions.length, 2);

	const rootDef = definitions.find(d => d.value === 'red');
	const divDef = definitions.find(d => d.value === 'blue');

	assert.ok(rootDef);
	assert.ok(divDef);
	assert.strictEqual(rootDef?.selector, ':root');
	assert.strictEqual(divDef?.selector, 'div');

	const usages = manager.getVariableUsages('--primary-color');
	assert.strictEqual(usages.length, 1);
	assert.strictEqual(usages[0].usageContext, 'div');
	const activeDefinition = definitions.find(d => d.selector === usages[0].usageContext);
	assert.strictEqual(activeDefinition?.value, 'blue');
});
