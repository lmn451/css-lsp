"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cssVariableManager_1 = require("./cssVariableManager");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const assert = require("assert");
const manager = new cssVariableManager_1.CssVariableManager();
function createDoc(uri, content, languageId = 'css') {
    return vscode_languageserver_textdocument_1.TextDocument.create(uri, languageId, 1, content);
}
console.log('Running File Lifecycle tests...');
// Test 1: File open -> close -> reopen cycle
{
    const uri = 'file:///lifecycle1.css';
    const css = ':root { --lifecycle-var: green; }';
    const doc = createDoc(uri, css);
    // Step 1: File opened
    manager.parseDocument(doc);
    let vars = manager.getVariables('--lifecycle-var');
    assert.strictEqual(vars.length, 1, 'Should find 1 variable after open');
    assert.strictEqual(vars[0].value, 'green', 'Value should be green');
    // Step 2: File closed (variables should be removed)
    manager.removeFile(uri);
    vars = manager.getVariables('--lifecycle-var');
    assert.strictEqual(vars.length, 0, 'Should find 0 variables after close');
    // Step 3: File reopened (variables should be parsed again)
    manager.parseDocument(doc);
    vars = manager.getVariables('--lifecycle-var');
    assert.strictEqual(vars.length, 1, 'Should find 1 variable after reopen');
    assert.strictEqual(vars[0].value, 'green', 'Value should still be green');
    console.log('Test 1 passed: File open -> close -> reopen cycle');
}
// Test 2: No duplicate variables when file is in workspace and opened
{
    const uri = 'file:///workspace.css';
    const css = ':root { --workspace-var: purple; }';
    // Step 1: File scanned from workspace
    manager.parseContent(css, uri, 'css');
    let vars = manager.getVariables('--workspace-var');
    assert.strictEqual(vars.length, 1, 'Should find 1 variable after workspace scan');
    // Step 2: Same file opened in editor (should not duplicate)
    const doc = createDoc(uri, css);
    manager.parseDocument(doc);
    vars = manager.getVariables('--workspace-var');
    assert.strictEqual(vars.length, 1, 'Should still find only 1 variable (no duplicates)');
    console.log('Test 2 passed: No duplicates when workspace file is opened');
}
// Test 3: removeFile clears variables, usages, and DOM trees
{
    const uri = 'file:///complete.html';
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
    const doc = createDoc(uri, html, 'html');
    manager.parseDocument(doc);
    // Verify data exists
    const defVars = manager.getVariables('--def-var');
    const usages = manager.getVariableUsages('--usage-var');
    const domTree = manager.getDOMTree(uri);
    assert.strictEqual(defVars.length, 1, 'Should have 1 definition before removeFile');
    assert.strictEqual(usages.length, 1, 'Should have 1 usage before removeFile');
    assert.ok(domTree, 'Should have DOM tree before removeFile');
    // Remove file
    manager.removeFile(uri);
    // Verify all data is cleared
    const defVarsAfter = manager.getVariables('--def-var');
    const usagesAfter = manager.getVariableUsages('--usage-var');
    const domTreeAfter = manager.getDOMTree(uri);
    assert.strictEqual(defVarsAfter.length, 0, 'Should have 0 definitions after removeFile');
    assert.strictEqual(usagesAfter.length, 0, 'Should have 0 usages after removeFile');
    assert.strictEqual(domTreeAfter, undefined, 'Should have no DOM tree after removeFile');
    console.log('Test 3 passed: removeFile clears all data');
}
// Test 4: Multiple opens without close (simulating rapid file switching)
{
    const uri = 'file:///rapid.css';
    const css1 = ':root { --rapid-var: v1; }';
    const css2 = ':root { --rapid-var: v2; }';
    const css3 = ':root { --rapid-var: v3; }';
    // Parse same file multiple times with different content
    manager.parseDocument(createDoc(uri, css1));
    let vars = manager.getVariables('--rapid-var');
    assert.strictEqual(vars.length, 1, 'Should have 1 variable');
    assert.strictEqual(vars[0].value, 'v1', 'Value should be v1');
    manager.parseDocument(createDoc(uri, css2));
    vars = manager.getVariables('--rapid-var');
    assert.strictEqual(vars.length, 1, 'Should still have 1 variable (no duplicates)');
    assert.strictEqual(vars[0].value, 'v2', 'Value should be updated to v2');
    manager.parseDocument(createDoc(uri, css3));
    vars = manager.getVariables('--rapid-var');
    assert.strictEqual(vars.length, 1, 'Should still have 1 variable (no duplicates)');
    assert.strictEqual(vars[0].value, 'v3', 'Value should be updated to v3');
    console.log('Test 4 passed: Multiple parses without duplicates');
}
// Test 5: Close file that was never opened (edge case)
{
    const uri = 'file:///never-opened.css';
    // Try to remove a file that was never parsed
    // This should not throw an error
    try {
        manager.removeFile(uri);
        const vars = manager.getAllVariables();
        // Just verify it doesn't crash
        assert.ok(true, 'removeFile on non-existent file should not crash');
        console.log('Test 5 passed: removeFile on non-existent file is safe');
    }
    catch (error) {
        assert.fail('removeFile should not throw error for non-existent file');
    }
}
// Test 6: File with multiple variable definitions and usages
{
    const uri = 'file:///multi.css';
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
    // Parse
    manager.parseDocument(doc);
    const var1Defs = manager.getVariables('--var1');
    const var2Defs = manager.getVariables('--var2');
    const var3Defs = manager.getVariables('--var3');
    const var1Uses = manager.getVariableUsages('--var1');
    const var2Uses = manager.getVariableUsages('--var2');
    const var3Uses = manager.getVariableUsages('--var3');
    assert.strictEqual(var1Defs.length, 1, 'Should find --var1 definition');
    assert.strictEqual(var2Defs.length, 1, 'Should find --var2 definition');
    assert.strictEqual(var3Defs.length, 1, 'Should find --var3 definition');
    assert.strictEqual(var1Uses.length, 1, 'Should find --var1 usage');
    assert.strictEqual(var2Uses.length, 1, 'Should find --var2 usage');
    assert.strictEqual(var3Uses.length, 1, 'Should find --var3 usage');
    // Close file
    manager.removeFile(uri);
    // All should be cleared
    assert.strictEqual(manager.getVariables('--var1').length, 0, '--var1 should be cleared');
    assert.strictEqual(manager.getVariables('--var2').length, 0, '--var2 should be cleared');
    assert.strictEqual(manager.getVariables('--var3').length, 0, '--var3 should be cleared');
    assert.strictEqual(manager.getVariableUsages('--var1').length, 0, '--var1 usage should be cleared');
    assert.strictEqual(manager.getVariableUsages('--var2').length, 0, '--var2 usage should be cleared');
    assert.strictEqual(manager.getVariableUsages('--var3').length, 0, '--var3 usage should be cleared');
    console.log('Test 6 passed: Multiple variables and usages cleared correctly');
}
console.log('All File Lifecycle tests passed!');
//# sourceMappingURL=fileLifecycle.test.js.map