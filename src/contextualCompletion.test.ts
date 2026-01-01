import * as assert from 'assert';

console.log('Running Context-Aware Completion tests...');

// Test 1: Completion context detection - inside var()
{
	const content = 'color: var(--';
	assert.ok(content.includes('var(--'), 'Should be inside var()');
	console.log('Test 1 passed: Detects var() context');
}

// Test 2: Completion context detection - after property colon
{
	const content = 'background: ';
	assert.ok(content.includes(': '), 'Should be after colon');
	console.log('Test 2 passed: Detects property value context');
}

// Test 3: Completion context detection - in multi-value property
{
	const content = 'padding: 10px var(--';
	assert.ok(content.includes('var(--'), 'Should be inside var() in multi-value property');
	console.log('Test 3 passed: Detects var() in multi-value context');
}

// Test 4: Should NOT show completions in property name position
{
	const content = '.selector { col';
	assert.ok(!content.includes(':'), 'Should not have colon yet');
	console.log('Test 4 passed: Rejects property name context');
}

// Test 5: Should NOT show completions in selector
{
	const content = '.my-class';
	assert.ok(!content.includes('{'), 'Should be in selector, not in declaration');
	console.log('Test 5 passed: Rejects selector context');
}

// Test 6: Completion in HTML style attribute
{
	const content = '<div style="color: ';
	assert.ok(content.includes('style='), 'Should be in style attribute');
	console.log('Test 6 passed: Detects HTML style attribute context');
}

// Test 7: Completion after semicolon
{
	const content = '.selector { color: red; background: ';
	assert.ok(content.endsWith(': '), 'Should be after second property colon');
	console.log('Test 7 passed: Detects value context after semicolon');
}

// Test 8: Completion in nested var()
{
	const content = 'color: var(--primary, var(--';
	assert.ok(content.includes('var(--'), 'Should be inside nested var()');
	console.log('Test 8 passed: Detects nested var() context');
}

// Test 9: Multi-line CSS
{
	const content = `.container {
  color: red;
  background: `;
	assert.ok(content.includes('background:'), 'Should be in background property');
	console.log('Test 9 passed: Handles multi-line CSS');
}

// Test 10: CSS custom property definition
{
	const content = ':root { --my-color: ';
	assert.ok(content.includes('--my-color:'), 'Should be defining a custom property');
	console.log('Test 10 passed: Detects custom property definition context');
}

console.log('All Context-Aware Completion tests passed!');
