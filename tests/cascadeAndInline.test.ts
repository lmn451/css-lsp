import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { CssVariableManager } from '../src/cssVariableManager';
import { TextDocument } from 'vscode-languageserver-textdocument';

function createDoc(uri: string, content: string, languageId: string = 'css') {
	return TextDocument.create(uri, languageId, 1, content);
}

test('!important tracking', () => {
	const manager = new CssVariableManager();
	const css = ':root { --color: red !important; } div { --color: blue; }';
	const doc = createDoc('file:///test.css', css);
	manager.parseDocument(doc);

	const vars = manager.getVariables('--color');
	assert.strictEqual(vars.length, 2);

	const importantVar = vars.find(v => v.important);
	const normalVar = vars.find(v => !v.important);

	assert.ok(importantVar);
	assert.strictEqual(importantVar?.value, 'red');
	assert.ok(normalVar);
	assert.strictEqual(normalVar?.value, 'blue');
});

test('source order tracking', () => {
	const manager = new CssVariableManager();
	const css = ':root { --a: first; } :root { --a: second; }';
	const doc = createDoc('file:///test.css', css);
	manager.parseDocument(doc);

	const vars = manager.getVariables('--a');
	assert.strictEqual(vars.length, 2);
	assert.ok(vars[1].sourcePosition > vars[0].sourcePosition);
});

test('inline style parsing', () => {
	const manager = new CssVariableManager();
	const html = '<div style="color: var(--primary); background: var(--bg);"></div>';
	const doc = createDoc('file:///test.html', html, 'html');
	manager.parseDocument(doc);

	const primaryUsages = manager.getVariableUsages('--primary');
	const bgUsages = manager.getVariableUsages('--bg');

	assert.strictEqual(primaryUsages.length, 1);
	assert.strictEqual(bgUsages.length, 1);
	assert.strictEqual(primaryUsages[0].usageContext, 'inline-style');
});

test('combined cascade tracking', () => {
	const manager = new CssVariableManager();
	const css = `
		:root { --x: root; }
		div { --x: div; }
		.class { --x: class !important; }
		#id { --x: id; }
	`;
	const doc = createDoc('file:///test.css', css);
	manager.parseDocument(doc);

	const vars = manager.getVariables('--x');
	assert.strictEqual(vars.length, 4);

	const importantVar = vars.find(v => v.important);
	assert.ok(importantVar);
	assert.strictEqual(importantVar?.selector, '.class');
});
