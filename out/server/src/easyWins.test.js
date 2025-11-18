"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cssVariableManager_1 = require("../src/cssVariableManager");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const assert = require("assert");
const manager = new cssVariableManager_1.CssVariableManager();
function createDoc(uri, content, languageId = 'css') {
    return vscode_languageserver_textdocument_1.TextDocument.create(uri, languageId, 1, content);
}
console.log('Running Easy Wins tests...');
// Test 1: !important Tracking
{
    const css = ':root { --color: red !important; } div { --color: blue; }';
    const doc = createDoc('file:///test.css', css);
    manager.parseDocument(doc);
    const vars = manager.getVariables('--color');
    assert.strictEqual(vars.length, 2, 'Should find 2 definitions');
    const importantVar = vars.find(v => v.important);
    const normalVar = vars.find(v => !v.important);
    assert.ok(importantVar, 'Should have !important variable');
    assert.strictEqual(importantVar?.value, 'red', '!important value should be red');
    assert.ok(normalVar, 'Should have normal variable');
    assert.strictEqual(normalVar?.value, 'blue', 'Normal value should be blue');
    console.log('Test 1 passed: !important tracking');
}
// Test 2: Source Order Tracking
{
    const css = ':root { --a: first; } :root { --a: second; }';
    const doc = createDoc('file:///test.css', css);
    manager.parseDocument(doc);
    const vars = manager.getVariables('--a');
    assert.strictEqual(vars.length, 2, 'Should find 2 definitions');
    // The second one should have higher source position
    assert.ok(vars[1].sourcePosition > vars[0].sourcePosition, 'Second definition should have higher position');
    console.log('Test 2 passed: Source order tracking');
}
// Test 3: Inline Style Parsing
{
    const html = '<div style="color: var(--primary); background: var(--bg);"></div>';
    const doc = createDoc('file:///test.html', html, 'html');
    manager.parseDocument(doc);
    const primaryUsages = manager.getVariableUsages('--primary');
    const bgUsages = manager.getVariableUsages('--bg');
    assert.strictEqual(primaryUsages.length, 1, 'Should find 1 usage of --primary');
    assert.strictEqual(bgUsages.length, 1, 'Should find 1 usage of --bg');
    assert.strictEqual(primaryUsages[0].usageContext, 'inline-style', 'Usage should be marked as inline-style');
    console.log('Test 3 passed: Inline style parsing');
}
// Test 4: Combined Cascade (important + specificity + source order)
{
    const css = `
		:root { --x: root; }
		div { --x: div; }
		.class { --x: class !important; }
		#id { --x: id; }
	`;
    const doc = createDoc('file:///test.css', css);
    manager.parseDocument(doc);
    const vars = manager.getVariables('--x');
    assert.strictEqual(vars.length, 4, 'Should find 4 definitions');
    const importantVar = vars.find(v => v.important);
    assert.ok(importantVar, 'Should have !important definition');
    assert.strictEqual(importantVar?.selector, '.class', '!important should be on .class');
    console.log('Test 4 passed: Combined cascade tracking');
}
console.log('All easy wins tests passed!');
//# sourceMappingURL=easyWins.test.js.map