import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  calculateSpecificity,
  compareSpecificity,
  formatSpecificity,
  matchesContext,
} from "../src/specificity";

test("basic specificity calculation for :root", () => {
  const rootSpec = calculateSpecificity(":root");
  assert.strictEqual(rootSpec.ids, 0);
  assert.strictEqual(rootSpec.classes, 1);
  assert.strictEqual(rootSpec.elements, 0);
  assert.strictEqual(formatSpecificity(rootSpec), "(0,1,0)");
});

test("element selector specificity", () => {
  const divSpec = calculateSpecificity("div");
  assert.strictEqual(divSpec.ids, 0);
  assert.strictEqual(divSpec.classes, 0);
  assert.strictEqual(divSpec.elements, 1);
});

test("class selector specificity", () => {
  const classSpec = calculateSpecificity(".button");
  assert.strictEqual(classSpec.ids, 0);
  assert.strictEqual(classSpec.classes, 1);
  assert.strictEqual(classSpec.elements, 0);
});

test("ID selector specificity", () => {
  const idSpec = calculateSpecificity("#main");
  assert.strictEqual(idSpec.ids, 1);
  assert.strictEqual(idSpec.classes, 0);
  assert.strictEqual(idSpec.elements, 0);
});

test("complex selector specificity", () => {
  const complexSpec = calculateSpecificity("div.button#submit");
  assert.strictEqual(complexSpec.ids, 1);
  assert.strictEqual(complexSpec.classes, 1);
  assert.strictEqual(complexSpec.elements, 1);
});

test("specificity comparison", () => {
  const root = calculateSpecificity(":root");
  const div = calculateSpecificity("div");
  const cls = calculateSpecificity(".button");
  const id = calculateSpecificity("#main");

  assert.strictEqual(compareSpecificity(div, root), -1);
  assert.strictEqual(compareSpecificity(cls, div), 1);
  assert.strictEqual(compareSpecificity(id, cls), 1);
  assert.strictEqual(compareSpecificity(root, root), 0);
});

test("context matching basics", () => {
  assert.strictEqual(matchesContext(":root", "div"), true);
  assert.strictEqual(matchesContext("div", "div"), true);
  assert.strictEqual(matchesContext(":root", ".button"), true);
});
