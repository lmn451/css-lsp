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
// Test 4: Usage Tracking and References
{
    const doc = createDoc('file:///test.css', ':root { --color: red; } .box { color: var(--color); }');
    manager.parseDocument(doc);
    const usages = manager.getVariableUsages('--color');
    assert.strictEqual(usages.length, 1, 'Should find 1 usage');
    const references = manager.getReferences('--color');
    assert.strictEqual(references.length, 2, 'Should find 2 references (1 def + 1 usage)');
    console.log('Test 4 passed: Usage Tracking');
}
// Test 5: Rename Support
{
    const doc = createDoc('file:///test.css', ':root { --old: red; } .box { color: var(--old); }');
    manager.parseDocument(doc);
    const references = manager.getReferences('--old');
    assert.strictEqual(references.length, 2, 'Should find all references for rename');
    // Verify ranges are correct (simplified check)
    const def = references.find(r => 'value' in r);
    const usage = references.find(r => !('value' in r));
    assert.ok(def, 'Should have definition');
    assert.ok(usage, 'Should have usage');
    console.log('Test 5 passed: Rename Support');
}
// Test 6: CSS Variable Scoping/Override
{
    const htmlContent = `
<html>
<style>
  :root { --primary-color: red; }
  div { --primary-color: blue; }
</style>
<body>
  <div style="color: var(--primary-color);">Test</div>
</body>
</html>`;
    const doc = createDoc('file:///test.html', htmlContent, 'html');
    manager.parseDocument(doc);
    // The LSP should find both definitions
    const definitions = manager.getVariables('--primary-color');
    assert.strictEqual(definitions.length, 2, 'Should find 2 definitions (root and div)');
    // Check the values
    const rootDef = definitions.find(d => d.value === 'red');
    const divDef = definitions.find(d => d.value === 'blue');
    assert.ok(rootDef, 'Should have definition with red');
    assert.ok(divDef, 'Should have definition with blue');
    // The LSP tracks both definitions but doesn't resolve which one applies in context
    // In a real browser, the div styling would use blue (more specific)
    // But the LSP currently shows all definitions, not context-specific resolution
    console.log('Test 6 passed: CSS Variable Scoping');
    console.log('  Note: LSP tracks both values (red and blue)');
    console.log('  Context-aware resolution would require CSS specificity analysis');
}
console.log('All tests passed!');
//# sourceMappingURL=test.js.map