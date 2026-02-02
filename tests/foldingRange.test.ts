import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { handleFoldingRange } from "../src/handlers/foldingRange";
import { TextDocument } from "vscode-languageserver-textdocument";
import { FoldingRangeKind } from "vscode-languageserver/node";

function createDocument(content: string, uri = "file:///test.css") {
  return TextDocument.create(uri, "css", 1, content);
}

function mockDocuments(doc: TextDocument) {
  return {
    get: (uri: string) => (uri === doc.uri ? doc : undefined),
  };
}

describe("handleFoldingRange", () => {
  test("returns null for unknown document", () => {
    const result = handleFoldingRange(
      { textDocument: { uri: "file:///unknown.css" } },
      { get: () => undefined },
    );
    assert.equal(result, null);
  });

  test("returns empty array for single-line CSS", () => {
    const doc = createDocument(":root { --color: red; }");
    const result = handleFoldingRange(
      { textDocument: { uri: doc.uri } },
      mockDocuments(doc),
    );
    assert.deepEqual(result, []);
  });

  test("folds multi-line CSS rule", () => {
    const doc = createDocument(`:root {
  --color: red;
  --bg: blue;
}`);
    const result = handleFoldingRange(
      { textDocument: { uri: doc.uri } },
      mockDocuments(doc),
    );
    assert.ok(result);
    assert.equal(result.length, 1);
    assert.equal(result[0].startLine, 0);
    assert.equal(result[0].endLine, 3);
    assert.equal(result[0].kind, FoldingRangeKind.Region);
  });

  test("folds @media at-rule", () => {
    const doc = createDocument(`@media (min-width: 768px) {
  .container {
    width: 100%;
  }
}`);
    const result = handleFoldingRange(
      { textDocument: { uri: doc.uri } },
      mockDocuments(doc),
    );
    assert.ok(result);
    // Should have 2 folds: @media block and .container rule
    assert.equal(result.length, 2);
  });

  test("folds @keyframes at-rule", () => {
    const doc = createDocument(`@keyframes fade {
  from { opacity: 0; }
  to { opacity: 1; }
}`);
    const result = handleFoldingRange(
      { textDocument: { uri: doc.uri } },
      mockDocuments(doc),
    );
    assert.ok(result);
    assert.ok(result.length >= 1);
    // First fold should be the @keyframes block
    assert.equal(result[0].startLine, 0);
    assert.equal(result[0].endLine, 3);
  });

  test("folds multi-line comments", () => {
    const doc = createDocument(`/*
 * This is a multi-line comment
 * describing the CSS file
 */
:root { --color: red; }`);
    const result = handleFoldingRange(
      { textDocument: { uri: doc.uri } },
      mockDocuments(doc),
    );
    assert.ok(result);
    const commentFold = result.find((r) => r.kind === FoldingRangeKind.Comment);
    assert.ok(commentFold);
    assert.equal(commentFold.startLine, 0);
    assert.equal(commentFold.endLine, 3);
  });

  test("does not fold single-line comments", () => {
    const doc = createDocument(`/* single line comment */
:root { --color: red; }`);
    const result = handleFoldingRange(
      { textDocument: { uri: doc.uri } },
      mockDocuments(doc),
    );
    assert.ok(result);
    const commentFolds = result.filter(
      (r) => r.kind === FoldingRangeKind.Comment,
    );
    assert.equal(commentFolds.length, 0);
  });

  test("handles multiple rules", () => {
    const doc = createDocument(`:root {
  --primary: blue;
}

.button {
  color: var(--primary);
}`);
    const result = handleFoldingRange(
      { textDocument: { uri: doc.uri } },
      mockDocuments(doc),
    );
    assert.ok(result);
    assert.equal(result.length, 2);
  });

  test("handles nested @media and rules", () => {
    const doc = createDocument(`@media screen {
  :root {
    --color: red;
  }
  .btn {
    background: blue;
  }
}`);
    const result = handleFoldingRange(
      { textDocument: { uri: doc.uri } },
      mockDocuments(doc),
    );
    assert.ok(result);
    // Should have 3 folds: @media, :root, .btn
    assert.equal(result.length, 3);
  });
});
