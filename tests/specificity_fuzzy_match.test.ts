/**
 * Tests for the matchesContext function's selector matching behavior.
 *
 * These tests verify that CSS selector matching works correctly,
 * with proper handling of :root, exact matches, and compound selectors.
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { matchesContext } from "../src/specificity";

test("matchesContext: exact selector matches", () => {
  // These should all return true - exact matches
  assert.strictEqual(matchesContext("div", "div"), true);
  assert.strictEqual(matchesContext(".button", ".button"), true);
  assert.strictEqual(matchesContext("#main", "#main"), true);
  assert.strictEqual(matchesContext("div.button", "div.button"), true);
});

test("matchesContext: :root applies universally", () => {
  // :root is a special pseudo-class that applies to the root element
  assert.strictEqual(matchesContext(":root", ".button"), true);
  assert.strictEqual(matchesContext(":root", "div"), true);
  assert.strictEqual(matchesContext(":root", "body"), true);
});

test("matchesContext: partial name matching should NOT match", () => {
  // Substring matching should NOT occur - these are different selectors
  assert.strictEqual(matchesContext(".button", ".butt"), false);
  assert.strictEqual(matchesContext(".button", ".buttons"), false);
  assert.strictEqual(matchesContext(".container", ".contain"), false);
  assert.strictEqual(matchesContext(".foo", ".foobar"), false);
  assert.strictEqual(matchesContext(".my-class", ".my"), false);
});

test("matchesContext: element selector vs class should NOT match", () => {
  // Element selectors should not match class selectors, even with similar names
  assert.strictEqual(matchesContext("span", ".spanish"), false);
  assert.strictEqual(matchesContext("div", ".d"), false);
  assert.strictEqual(matchesContext("span", ".span"), false);
  assert.strictEqual(matchesContext("button", ".button"), false);
});

test("matchesContext: different selector types should not match", () => {
  // ID selectors should not match class selectors
  assert.strictEqual(matchesContext("#id", ".id"), false);
  assert.strictEqual(matchesContext(".class", "#class"), false);

  // Element selectors should not match ID selectors
  assert.strictEqual(matchesContext("div", "#div"), false);
  assert.strictEqual(matchesContext("#main", "main"), false);
});
