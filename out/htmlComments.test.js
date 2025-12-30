"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cssVariableManager_1 = require("./cssVariableManager");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const assert = require("assert");
const manager = new cssVariableManager_1.CssVariableManager();
function createDoc(uri, content, languageId = 'css') {
    return vscode_languageserver_textdocument_1.TextDocument.create(uri, languageId, 1, content);
}
console.log('Running HTML Comments tests...');
// Test 1: HTML comments with style blocks should be ignored
{
    const html = `
<!DOCTYPE html>
<html>
<head>
	<!-- Commented out style block
	<style>
		:root {
			--commented-color: blue;
			--another-commented: green;
		}
	</style>
	-->
	
	<style>
		:root {
			--active-color: red;
		}
	</style>
</head>
</html>
`;
    const doc = createDoc('file:///test1.html', html, 'html');
    manager.parseDocument(doc);
    const commentedVar = manager.getVariables('--commented-color');
    const anotherCommented = manager.getVariables('--another-commented');
    const activeVar = manager.getVariables('--active-color');
    assert.strictEqual(commentedVar.length, 0, 'Should NOT find --commented-color');
    assert.strictEqual(anotherCommented.length, 0, 'Should NOT find --another-commented');
    assert.strictEqual(activeVar.length, 1, 'Should find --active-color');
    assert.strictEqual(activeVar[0].value, 'red', 'Active color should be red');
    console.log('Test 1 passed: HTML comments with style blocks are ignored');
}
// Test 2: HTML comments with inline styles should be ignored
{
    const html = `
<!DOCTYPE html>
<html>
<body>
	<!-- <div style="color: var(--commented-inline); background: var(--bg-commented);"></div> -->
	<div style="color: var(--active-inline); background: var(--bg-active);"></div>
</body>
</html>
`;
    const doc = createDoc('file:///test2.html', html, 'html');
    manager.parseDocument(doc);
    const commentedUsage = manager.getVariableUsages('--commented-inline');
    const bgCommentedUsage = manager.getVariableUsages('--bg-commented');
    const activeUsage = manager.getVariableUsages('--active-inline');
    const bgActiveUsage = manager.getVariableUsages('--bg-active');
    assert.strictEqual(commentedUsage.length, 0, 'Should NOT find --commented-inline usage');
    assert.strictEqual(bgCommentedUsage.length, 0, 'Should NOT find --bg-commented usage');
    assert.strictEqual(activeUsage.length, 1, 'Should find --active-inline usage');
    assert.strictEqual(bgActiveUsage.length, 1, 'Should find --bg-active usage');
    console.log('Test 2 passed: HTML comments with inline styles are ignored');
}
// Test 3: Multi-line HTML comments
{
    const html = `
<!DOCTYPE html>
<html>
<head>
	<!--
		This is a multi-line comment
		<style>
			:root {
				--multi-line-commented: yellow;
			}
		</style>
		More comments here
	-->
	
	<style>
		:root {
			--multi-line-active: orange;
		}
	</style>
</head>
</html>
`;
    const doc = createDoc('file:///test3.html', html, 'html');
    manager.parseDocument(doc);
    const commentedVar = manager.getVariables('--multi-line-commented');
    const activeVar = manager.getVariables('--multi-line-active');
    assert.strictEqual(commentedVar.length, 0, 'Should NOT find --multi-line-commented');
    assert.strictEqual(activeVar.length, 1, 'Should find --multi-line-active');
    console.log('Test 3 passed: Multi-line HTML comments are ignored');
}
// Test 4: CSS comments within style blocks still work (not HTML comments)
{
    const html = `
<!DOCTYPE html>
<html>
<head>
	<style>
		/* CSS comment - this should still be ignored by csstree */
		:root {
			/* --css-commented: purple; */
			--css-active: pink;
		}
	</style>
</head>
</html>
`;
    const doc = createDoc('file:///test4.html', html, 'html');
    manager.parseDocument(doc);
    const cssCommented = manager.getVariables('--css-commented');
    const cssActive = manager.getVariables('--css-active');
    assert.strictEqual(cssCommented.length, 0, 'Should NOT find --css-commented (CSS comment)');
    assert.strictEqual(cssActive.length, 1, 'Should find --css-active');
    console.log('Test 4 passed: CSS comments within style blocks are still handled by csstree');
}
// Test 5: Nested HTML comments (edge case)
{
    const html = `
<!DOCTYPE html>
<html>
<head>
	<!-- Outer comment
		<style>:root { --outer: red; }</style>
		<!-- Inner comment (though technically invalid HTML)
			<style>:root { --inner: blue; }</style>
		-->
	-->
	
	<style>
		:root {
			--valid: green;
		}
	</style>
</head>
</html>
`;
    const doc = createDoc('file:///test5.html', html, 'html');
    manager.parseDocument(doc);
    const outerVar = manager.getVariables('--outer');
    const innerVar = manager.getVariables('--inner');
    const validVar = manager.getVariables('--valid');
    // Note: HTML spec says nested comments are invalid, but our regex should handle them
    assert.strictEqual(outerVar.length, 0, 'Should NOT find --outer');
    assert.strictEqual(innerVar.length, 0, 'Should NOT find --inner');
    assert.strictEqual(validVar.length, 1, 'Should find --valid');
    console.log('Test 5 passed: Nested HTML comments handled');
}
// Test 6: Position tracking should still work after comment removal
{
    const html = `
<!DOCTYPE html>
<html>
<head>
	<!-- This comment affects offsets -->
	<style>
		:root {
			--positioned: value;
		}
	</style>
</head>
</html>
`;
    const doc = createDoc('file:///test6.html', html, 'html');
    manager.parseDocument(doc);
    const positionedVar = manager.getVariables('--positioned');
    assert.strictEqual(positionedVar.length, 1, 'Should find --positioned');
    assert.ok(positionedVar[0].range, 'Should have range information');
    assert.ok(positionedVar[0].range.start.line >= 0, 'Should have valid line number');
    console.log('Test 6 passed: Position tracking works after comment removal');
}
console.log('All HTML Comments tests passed!');
//# sourceMappingURL=htmlComments.test.js.map