"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cssVariableManager_1 = require("../src/cssVariableManager");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const assert = require("assert");
const manager = new cssVariableManager_1.CssVariableManager();
function createDoc(uri, content, languageId = 'css') {
    return vscode_languageserver_textdocument_1.TextDocument.create(uri, languageId, 1, content);
}
console.log('Running CssVariableManager tests...');
// Test 1: Basic CSS Extraction
{
    const doc = createDoc('file:///test.css', ':root { --main-color: red; }');
    manager.parseDocument(doc);
    const vars = manager.getAllVariables();
    assert.strictEqual(vars.length, 1, 'Should find 1 variable');
    assert.strictEqual(vars[0].name, '--main-color');
    assert.strictEqual(vars[0].value, 'red');
    console.log('Test 1 passed: Basic CSS Extraction');
}
// Test 2: HTML Style Extraction
{
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
    assert.strictEqual(vars.length, 1, 'Should find HTML variable');
    assert.strictEqual(vars[0].value, 'blue');
    console.log('Test 2 passed: HTML Style Extraction');
}
// Test 3: Multiple Variables and Updates
{
    const doc = createDoc('file:///test.css', ':root { --v1: 10px; --v2: 20px; }');
    manager.parseDocument(doc);
    assert.strictEqual(manager.getAllVariables().length, 3); // 1 from Test 1 + 2 here (Test 2 is different file)
    // Update file
    const docUpdated = createDoc('file:///test.css', ':root { --v1: 15px; }');
    manager.parseDocument(docUpdated);
    const v1 = manager.getVariables('--v1');
    assert.strictEqual(v1[0].value, '15px', 'Should update value');
    assert.strictEqual(manager.getVariables('--v2').length, 0, 'Should remove deleted variable');
    console.log('Test 3 passed: Updates');
}
console.log('All tests passed!');
//# sourceMappingURL=test.js.map