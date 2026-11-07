import { test } from "node:test";
import { strict as assert } from "node:assert";
import { DOMTree } from "../src/domTree";

test("basic HTML parsing", () => {
  const html = '<div class="parent"><span id="child">Text</span></div>';
  const tree = new DOMTree(html);

  const root = tree.getRoot();
  assert.ok(root);
});

test("querySelector to find specific element", () => {
  const html = '<div class="container"><span class="text">Hello</span></div>';
  const tree = new DOMTree(html);

  const matches = tree.querySelectorAll("span.text");
  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].tagName.toLowerCase(), "span");
});

test("querySelector with class selector", () => {
  const html = '<div><span class="target">Test</span><span>Other</span></div>';
  const tree = new DOMTree(html);

  const matches = tree.querySelectorAll(".target");
  assert.strictEqual(matches.length, 1);
  assert.strictEqual(matches[0].tagName.toLowerCase(), "span");
});

test("descendant combinator", () => {
  const html = '<div><p><span class="inner">Text</span></p></div>';
  const tree = new DOMTree(html);

  const divSpan = tree.querySelectorAll("div .inner");
  assert.strictEqual(divSpan.length, 1);

  const pSpan = tree.querySelectorAll("p .inner");
  assert.strictEqual(pSpan.length, 1);
});

test("child combinator", () => {
  const html =
    '<div><p class="direct"></p><section><p class="nested"></p></section></div>';
  const tree = new DOMTree(html);

  const directChildren = tree.querySelectorAll("div > p");
  assert.strictEqual(directChildren.length, 1);

  const allP = tree.querySelectorAll("div p");
  assert.strictEqual(allP.length, 2);
});

test("complex selectors with combinators", () => {
  const html = `
<html>
<body>
  <div class="container">
    <span class="text">Test</span>
  </div>
</body>
</html>`;

  const tree = new DOMTree(html);

  assert.strictEqual(tree.querySelectorAll("span").length, 1);
  assert.strictEqual(tree.querySelectorAll("div > span").length, 1);
  assert.strictEqual(tree.querySelectorAll("div span").length, 1);
  assert.strictEqual(tree.querySelectorAll(".container span").length, 1);
  assert.strictEqual(tree.querySelectorAll(".container > span").length, 1);
});

test("HTML attribute entities preserve selector matching and source ranges", () => {
  const html = '<div id="a&amp;b" title="&copycat"><span>Text</span></div>';
  const tree = new DOMTree(html);
  const [node] = tree.querySelectorAll('[id="a&b"]');
  assert.ok(node);
  assert.equal(node.element.getAttribute("title"), "&copycat");
  assert.deepEqual(node.element.range, [0, html.length]);
  assert.equal(tree.matchesSelector(node, '[id="a&b"]'), true);
});

test("selector queries handle deeply nested HTML", () => {
  const depth = 12000;
  const tree = new DOMTree(
    "<div>".repeat(depth) + '<span id="deep"></span>' + "</div>".repeat(depth),
  );
  assert.equal(tree.querySelectorAll("span").length, 1);
  assert.equal(tree.querySelectorAll("div").length, depth);
});
