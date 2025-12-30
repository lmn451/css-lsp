import { calculateSpecificity, compareSpecificity, formatSpecificity, matchesContext } from './specificity';
import * as assert from 'assert';

console.log('Running Specificity Calculator tests...');

// Test 1: Basic Specificity Calculation
{
	const rootSpec = calculateSpecificity(':root');
	assert.strictEqual(rootSpec.ids, 0, ':root should have 0 IDs');
	assert.strictEqual(rootSpec.classes, 1, ':root should have 1 class (pseudo-class)');
	assert.strictEqual(rootSpec.elements, 0, ':root should have 0 elements');
	console.log('Test 1 passed: :root specificity ' + formatSpecificity(rootSpec));
}

// Test 2: Element Selector
{
	const divSpec = calculateSpecificity('div');
	assert.strictEqual(divSpec.ids, 0, 'div should have 0 IDs');
	assert.strictEqual(divSpec.classes, 0, 'div should have 0 classes');
	assert.strictEqual(divSpec.elements, 1, 'div should have 1 element');
	console.log('Test 2 passed: div specificity ' + formatSpecificity(divSpec));
}

// Test 3: Class Selector
{
	const classSpec = calculateSpecificity('.button');
	assert.strictEqual(classSpec.ids, 0, '.button should have 0 IDs');
	assert.strictEqual(classSpec.classes, 1, '.button should have 1 class');
	assert.strictEqual(classSpec.elements, 0, '.button should have 0 elements');
	console.log('Test 3 passed: .button specificity ' + formatSpecificity(classSpec));
}

// Test 4: ID Selector
{
	const idSpec = calculateSpecificity('#main');
	assert.strictEqual(idSpec.ids, 1, '#main should have 1 ID');
	assert.strictEqual(idSpec.classes, 0, '#main should have 0 classes');
	assert.strictEqual(idSpec.elements, 0, '#main should have 0 elements');
	console.log('Test 4 passed: #main specificity ' + formatSpecificity(idSpec));
}

// Test 5: Complex Selector
{
	const complexSpec = calculateSpecificity('div.button#submit');
	assert.strictEqual(complexSpec.ids, 1, 'should have 1 ID');
	assert.strictEqual(complexSpec.classes, 1, 'should have 1 class');
	assert.strictEqual(complexSpec.elements, 1, 'should have 1 element');
	console.log('Test 5 passed: div.button#submit specificity ' + formatSpecificity(complexSpec));
}

// Test 6: Specificity Comparison
{
	const root = calculateSpecificity(':root');
	const div = calculateSpecificity('div');
	const cls = calculateSpecificity('.button');
	const id = calculateSpecificity('#main');

	assert.strictEqual(compareSpecificity(div, root), 1, 'div should be more specific than :root for element selectors');
	assert.strictEqual(compareSpecificity(cls, div), 1, '.button should be more specific than div');
	assert.strictEqual(compareSpecificity(id, cls), 1, '#main should be more specific than .button');
	assert.strictEqual(compareSpecificity(root, root), 0, 'Equal specificity should return 0');

	console.log('Test 6 passed: Specificity comparisons');
}

// Test 7: Context Matching
{
	assert.strictEqual(matchesContext(':root', 'div'), true, ':root should match any context');
	assert.strictEqual(matchesContext('div', 'div'), true, 'Same selector should match');
	assert.strictEqual(matchesContext(':root', '.button'), true, ':root is universal');

	console.log('Test 7 passed: Context matching');
}

console.log('All specificity tests passed!');
