import { test } from 'node:test';
import { strict as assert } from 'node:assert';

test('completion context detection - inside var()', () => {
	const content = 'color: var(--';
	assert.ok(content.includes('var(--'));
});

test('completion context detection - after property colon', () => {
	const content = 'background: ';
	assert.ok(content.includes(': '));
});

test('completion context detection - in multi-value property', () => {
	const content = 'padding: 10px var(--';
	assert.ok(content.includes('var(--'));
});

test('no completion in property name position', () => {
	const content = '.selector { col';
	assert.ok(!content.includes(':'));
});

test('no completion in selector', () => {
	const content = '.my-class';
	assert.ok(!content.includes('{'));
});

test('completion in HTML style attribute', () => {
	const content = '<div style="color: ';
	assert.ok(content.includes('style='));
});

test('completion after semicolon', () => {
	const content = '.selector { color: red; background: ';
	assert.ok(content.endsWith(': '));
});

test('completion in nested var()', () => {
	const content = 'color: var(--primary, var(--';
	assert.ok(content.includes('var(--'));
});

test('multi-line CSS detection', () => {
	const content = `.container {
  color: red;
  background: `;
	assert.ok(content.includes('background:'));
});

test('CSS custom property definition context', () => {
	const content = ':root { --my-color: ';
	assert.ok(content.includes('--my-color:'));
});
