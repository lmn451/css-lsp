import { DOMTree } from './domTree';
import * as assert from 'assert';

console.log('Running DOM Tree tests...');

// Test 1: Basic HTML Parsing
{
	const html = '<div class="parent"><span id="child">Text</span></div>';
	const tree = new DOMTree(html);

	const root = tree.getRoot();
	assert.ok(root, 'Should have root element');

	console.log('Test 1 passed: Basic HTML parsing');
}

// Test 2: querySelector - Find specific element
{
	const html = '<div class="container"><span class="text">Hello</span></div>';
	const tree = new DOMTree(html);

	// Use querySelector to find the span
	const matches = tree.querySelectorAll('span.text');
	assert.strictEqual(matches.length, 1, 'Should find 1 match');
	assert.strictEqual(matches[0].tagName.toLowerCase(), 'span', 'Should find span element');

	console.log('Test 2 passed: querySelector to find element');
}

// Test 3: querySelector - Simple Selector
{
	const html = '<div><span class="target">Test</span><span>Other</span></div>';
	const tree = new DOMTree(html);

	const matches = tree.querySelectorAll('.target');
	assert.strictEqual(matches.length, 1, 'Should find 1 match');
	assert.strictEqual(matches[0].tagName.toLowerCase(), 'span', 'Should be span element');

	console.log('Test 3 passed: querySelector with class selector');
}

// Test 4: Descendant Combinator
{
	const html = '<div><p><span class="inner">Text</span></p></div>';
	const tree = new DOMTree(html);

	// Descendant: div .inner (space means any descendant)
	const divSpan = tree.querySelectorAll('div .inner');
	assert.strictEqual(divSpan.length, 1, 'Should match div .inner');

	// Descendant: p .inner
	const pSpan = tree.querySelectorAll('p .inner');
	assert.strictEqual(pSpan.length, 1, 'Should match p .inner');

	console.log('Test 4 passed: Descendant combinator');
}

// Test 5: Child Combinator (>)
{
	const html = '<div><p class="direct"></p><section><p class="nested"></p></section></div>';
	const tree = new DOMTree(html);

	// div > p should match only direct children
	const directChildren = tree.querySelectorAll('div > p');
	assert.strictEqual(directChildren.length, 1, 'Should find 1 direct child');

	// div p (descendant) should match both
	const allP = tree.querySelectorAll('div p');
	assert.strictEqual(allP.length, 2, 'Should find 2 descendants');

	console.log('Test 5 passed: Child combinator (>)');
}

// Test 6: Complex CSS Selectors
{
	const html = `
<html>
<body>
  <div class="container">
    <span class="text">Test</span>
  </div>
</body>
</html>`;

	const tree = new DOMTree(html);

	// Find the span using different selectors
	assert.strictEqual(tree.querySelectorAll('span').length, 1, 'Should find span');
	assert.strictEqual(tree.querySelectorAll('div > span').length, 1, 'div > span should match');
	assert.strictEqual(tree.querySelectorAll('div span').length, 1, 'div span should match');
	assert.strictEqual(tree.querySelectorAll('.container span').length, 1, '.container span should match');
	assert.strictEqual(tree.querySelectorAll('.container > span').length, 1, '.container > span should match');

	console.log('Test 6 passed: Complex CSS selectors with combinators');
}

console.log('All DOM Tree tests passed!');
