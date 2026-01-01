import * as assert from 'assert';
import { parseColor, formatColor } from './colorService';
import { CssVariableManager } from './cssVariableManager';
import { TextDocument } from 'vscode-languageserver-textdocument';

console.log('Running Color Provider tests...');

// Test 1: Color Service Parsing
{
	// Hex
	const red = parseColor('#ff0000');
	assert.deepStrictEqual(red, { red: 1, green: 0, blue: 0, alpha: 1 });

	const blue = parseColor('#00f');
	assert.deepStrictEqual(blue, { red: 0, green: 0, blue: 1, alpha: 1 });

	const alpha = parseColor('#00000080');
	assert.strictEqual(alpha?.alpha.toFixed(1), '0.5');

	// RGB
	const green = parseColor('rgb(0, 255, 0)');
	assert.deepStrictEqual(green, { red: 0, green: 1, blue: 0, alpha: 1 });

	const rgba = parseColor('rgba(0, 0, 0, 0.5)');
	assert.strictEqual(rgba?.alpha, 0.5);

	// Named
	const white = parseColor('white');
	assert.deepStrictEqual(white, { red: 1, green: 1, blue: 1, alpha: 1 });

	// Format
	const redColor = { red: 1, green: 0, blue: 0, alpha: 1 };
	assert.strictEqual(formatColor(redColor), '#ff0000');

	const alphaColor = { red: 0, green: 0, blue: 0, alpha: 0.5 };
	assert.strictEqual(formatColor(alphaColor), 'rgba(0, 0, 0, 0.5)');

	console.log('Test 1 passed: Color Service Parsing');
}

// Test 2: CSS Variable Manager Color Resolution
{
	const manager = new CssVariableManager();
	const css = `
		:root {
			--red: #ff0000;
			--blue: blue;
			--alias: var(--red);
			--nested: var(--alias);
			--not-color: 10px;
		}
	`;
	const document = TextDocument.create('file:///test.css', 'css', 1, css);
	manager.parseDocument(document);

	const red = manager.resolveVariableColor('--red');
	assert.deepStrictEqual(red, { red: 1, green: 0, blue: 0, alpha: 1 });

	const blue = manager.resolveVariableColor('--blue');
	assert.deepStrictEqual(blue, { red: 0, green: 0, blue: 1, alpha: 1 });

	const alias = manager.resolveVariableColor('--alias');
	assert.deepStrictEqual(alias, { red: 1, green: 0, blue: 0, alpha: 1 });

	const nested = manager.resolveVariableColor('--nested');
	assert.deepStrictEqual(nested, { red: 1, green: 0, blue: 0, alpha: 1 });

	const notColor = manager.resolveVariableColor('--not-color');
	assert.strictEqual(notColor, null);

	console.log('Test 2 passed: Variable Color Resolution');
}

console.log('All Color Provider tests passed!');
