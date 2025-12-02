import * as assert from 'assert';
import { formatColorAsHex, formatColorAsRgb, formatColorAsHsl } from './colorService';
import { CssVariableManager } from './cssVariableManager';
import { TextDocument } from 'vscode-languageserver-textdocument';

console.log('Running Color Formatting tests...');

// Test 1: Color Formatting
{
	const red = { red: 1, green: 0, blue: 0, alpha: 1 };
	const semiTransparent = { red: 0, green: 1, blue: 0, alpha: 0.5 };

	// Hex
	assert.strictEqual(formatColorAsHex(red), '#ff0000');
	assert.strictEqual(formatColorAsHex(semiTransparent), '#00ff0080');

	// RGB
	assert.strictEqual(formatColorAsRgb(red), 'rgb(255, 0, 0)');
	assert.strictEqual(formatColorAsRgb(semiTransparent), 'rgba(0, 255, 0, 0.5)');

	// HSL
	assert.strictEqual(formatColorAsHsl(red), 'hsl(0, 100%, 50%)');
	// Green is hsl(120, 100%, 50%)
	assert.strictEqual(formatColorAsHsl(semiTransparent), 'hsla(120, 100%, 50%, 0.5)');

	console.log('Test 1 passed: Color Formatting');
}

// Test 2: Value Range Calculation
{
	const manager = new CssVariableManager();
	const css = `
		:root {
			--simple: red;
			--spaced:   blue  ;
			--complex: rgb(0,0,0);
		}
	`;
	const document = TextDocument.create('file:///test.css', 'css', 1, css);
	manager.parseDocument(document);

	const simple = manager.getVariables('--simple')[0];
	const spaced = manager.getVariables('--spaced')[0];
	const complex = manager.getVariables('--complex')[0];

	// Helper to get text from range
	const getText = (range: any) => {
		const start = document.offsetAt(range.start);
		const end = document.offsetAt(range.end);
		return css.substring(start, end);
	};

	// Verify value ranges
	assert.ok(simple.valueRange, 'Simple variable should have valueRange');
	assert.strictEqual(getText(simple.valueRange), 'red', 'Simple value range should match "red"');

	assert.ok(spaced.valueRange, 'Spaced variable should have valueRange');
	assert.strictEqual(getText(spaced.valueRange), 'blue', 'Spaced value range should match "blue" (trimmed)');

	assert.ok(complex.valueRange, 'Complex variable should have valueRange');
	assert.strictEqual(getText(complex.valueRange), 'rgb(0,0,0)', 'Complex value range should match "rgb(0,0,0)"');

	console.log('Test 2 passed: Value Range Calculation');
}

console.log('All Color Formatting tests passed!');
