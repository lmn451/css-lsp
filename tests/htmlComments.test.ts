import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { CssVariableManager } from '../src/cssVariableManager';
import { TextDocument } from 'vscode-languageserver-textdocument';

function createDoc(uri: string, content: string, languageId: string = 'css') {
	return TextDocument.create(uri, languageId, 1, content);
}

test('HTML comments with style blocks are ignored', () => {
	const manager = new CssVariableManager();
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

	assert.strictEqual(commentedVar.length, 0);
	assert.strictEqual(anotherCommented.length, 0);
	assert.strictEqual(activeVar.length, 1);
	assert.strictEqual(activeVar[0].value, 'red');
});

test('HTML comments with inline styles are ignored', () => {
	const manager = new CssVariableManager();
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

	assert.strictEqual(commentedUsage.length, 0);
	assert.strictEqual(bgCommentedUsage.length, 0);
	assert.strictEqual(activeUsage.length, 1);
	assert.strictEqual(bgActiveUsage.length, 1);
});

test('multi-line HTML comments are ignored', () => {
	const manager = new CssVariableManager();
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

	assert.strictEqual(commentedVar.length, 0);
	assert.strictEqual(activeVar.length, 1);
});

test('CSS comments within style blocks still work', () => {
	const manager = new CssVariableManager();
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

	assert.strictEqual(cssCommented.length, 0);
	assert.strictEqual(cssActive.length, 1);
});

test('nested HTML comments are ignored', () => {
	const manager = new CssVariableManager();
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

	assert.strictEqual(outerVar.length, 0);
	assert.strictEqual(innerVar.length, 0);
	assert.strictEqual(validVar.length, 1);
});

test('position tracking works after comment removal', () => {
	const manager = new CssVariableManager();
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

	assert.strictEqual(positionedVar.length, 1);
	assert.ok(positionedVar[0].range);
	assert.ok(positionedVar[0].range.start.line >= 0);
});
