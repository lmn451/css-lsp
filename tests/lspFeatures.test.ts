import { test, describe } from "node:test";
import { strict as assert } from "node:assert";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  handleSemanticTokens,
  tokenTypes,
  tokenModifiers,
} from "../src/handlers/semanticTokens";
import { handleDocumentFormatting } from "../src/handlers/formatting";
import {
  handleCallHierarchyPrepare,
  handleCallHierarchyIncomingCalls,
} from "../src/handlers/callHierarchy";
import {
  SymbolKind,
  CallHierarchyItem,
  Range,
} from "vscode-languageserver/node";

function createDocument(content: string, uri = "file:///test.css") {
  return TextDocument.create(uri, "css", 1, content);
}

function mockDocuments(doc: TextDocument) {
  return {
    get: (uri: string) => (uri === doc.uri ? doc : undefined),
  };
}

// Mock CssVariableManager
const mockVariableManager = {
  getVariables: (name: string) => {
    if (name === "--color") {
      return [
        {
          name: "--color",
          value: "red",
          uri: "file:///test.css",
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 13 },
          },
          selector: ":root",
          important: false,
          sourcePosition: 0,
        },
      ];
    }
    return [];
  },
  getVariableUsages: (name: string) => {
    if (name === "--color") {
      return [
        {
          name: "--color",
          uri: "file:///test.css",
          range: {
            start: { line: 5, character: 10 },
            end: { line: 5, character: 17 },
          },
          usageContext: ".btn",
        },
      ];
    }
    return [];
  },
} as any;

describe("LSP Features", () => {
  describe("Semantic Tokens", () => {
    test("highlights variables and properties", () => {
      const doc = createDocument(
        `:root { --color: red; } .btn { color: var(--color); }`,
      );
      const result = handleSemanticTokens(
        { textDocument: { uri: doc.uri } },
        mockDocuments(doc),
        mockVariableManager,
      );

      assert.ok(result);
      assert.ok(result.data.length > 0);
      // We expect tokens for --color (decl), var (func), --color (usage)
      // Just verifying we get data back
    });
  });

  describe("Formatting", () => {
    test("formats CSS", () => {
      const doc = createDocument(`:root{--color:red;}`);
      const result = handleDocumentFormatting(
        {
          textDocument: { uri: doc.uri },
          options: { tabSize: 2, insertSpaces: true } as any,
        },
        mockDocuments(doc),
      );

      assert.ok(result);
      assert.equal(result.length, 1);
      const formatted = result[0].newText;
      assert.ok(formatted.includes(":root {"));
      assert.ok(formatted.includes("  --color:red;"));
    });
  });

  describe("Call Hierarchy", () => {
    test("prepare returns item for variable definition", () => {
      const doc = createDocument(`:root { --color: red; }`);
      // Cursor at --color
      const result = handleCallHierarchyPrepare(
        {
          textDocument: { uri: doc.uri },
          position: { line: 0, character: 10 },
        },
        mockDocuments(doc),
        mockVariableManager,
      );

      assert.ok(result);
      assert.equal(result.length, 1);
      assert.equal(result[0].name, "--color");
      assert.equal(result[0].kind, SymbolKind.Variable);
    });

    test("incoming calls finds usages", () => {
      const item: CallHierarchyItem = {
        name: "--color",
        kind: SymbolKind.Variable,
        uri: "file:///test.css",
        range: Range.create(0, 0, 0, 0),
        selectionRange: Range.create(0, 0, 0, 0),
        detail: "red",
      };

      const result = handleCallHierarchyIncomingCalls(
        { item },
        mockVariableManager,
      );

      assert.ok(result);
      assert.equal(result.length, 1);
      assert.equal(result[0].from.name, ".btn"); // The usage context
    });
  });
});
