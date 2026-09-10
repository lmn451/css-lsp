import { test } from "node:test";
import { strict as assert } from "node:assert";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CssVariableManager } from "../src/cssVariableManager";
import { collectDocumentColors } from "../src/colorProvider";

test("URI identity preserves path case across definitions and usages", () => {
  const manager = new CssVariableManager();
  const upperUri = "file:///tmp/CaseSensitive.css";
  const lowerUri = "file:///tmp/casesensitive.css";

  manager.parseContent(
    ":root { --upper: red; color: var(--upper); }",
    upperUri,
    "css",
  );
  manager.parseContent(
    ":root { --lower: blue; color: var(--lower); }",
    lowerUri,
    "css",
  );

  assert.deepEqual(
    manager.getAllVariables().map((variable) => [variable.name, variable.uri]),
    [
      ["--upper", upperUri],
      ["--lower", lowerUri],
    ],
  );
  assert.equal(manager.getVariableUsages("--upper").length, 1);
  assert.equal(manager.getVariableUsages("--lower").length, 1);
  assert.equal(manager.getDocumentDefinitions(upperUri).length, 1);
  assert.equal(manager.getDocumentDefinitions(lowerUri).length, 1);

  manager.parseContent(
    ":root { --upper: green; color: var(--upper); }",
    upperUri,
    "css",
  );
  assert.equal(manager.getVariables("--upper")[0].value, "green");
  assert.equal(manager.getVariables("--lower")[0].value, "blue");
  assert.equal(manager.getVariableUsages("--lower").length, 1);

  manager.removeFile(upperUri);

  assert.equal(manager.getVariables("--upper").length, 0);
  assert.equal(manager.getVariableUsages("--upper").length, 0);
  assert.equal(manager.getVariables("--lower").length, 1);
  assert.equal(manager.getVariableUsages("--lower").length, 1);
});

test("equivalent URI syntax shares state without changing path case", () => {
  const manager = new CssVariableManager();
  const canonicalUri = "file:///tmp/UriSyntax.css";
  const equivalentUri = "file:/tmp/UriSyntax.css";

  manager.parseContent(":root { --same: red; }", canonicalUri, "css");
  manager.parseContent(":root { --same: blue; }", equivalentUri, "css");

  const definitions = manager.getVariables("--same");
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].value, "blue");
  assert.equal(manager.getDocumentDefinitions(canonicalUri).length, 1);

  const upperHtmlUri = "file:///tmp/UriSyntax.HTML";
  const lowerPathEquivalent = "FILE:///tmp/UriSyntax.HTML";
  manager.parseContent(
    '<body><div style="color: var(--same)"></div></body>',
    upperHtmlUri,
    "html",
  );
  assert.ok(manager.getDOMTree(lowerPathEquivalent));

  manager.removeFile(lowerPathEquivalent);
  assert.equal(manager.getDOMTree(upperHtmlUri), undefined);
});

test("case-distinct HTML documents keep independent DOM trees and colors", () => {
  const manager = new CssVariableManager();
  const upperUri = "file:///tmp/Colors.HTML";
  const lowerUri = "file:///tmp/colors.HTML";
  const upperText = "<style>:root { --case-color: red; }</style>";
  const lowerText = "<style>:root { --case-color: blue; }</style>";

  manager.parseContent(upperText, upperUri, "html");
  manager.parseContent(lowerText, lowerUri, "html");

  const upperTree = manager.getDOMTree(upperUri);
  const lowerTree = manager.getDOMTree(lowerUri);
  assert.ok(upperTree);
  assert.ok(lowerTree);
  assert.notEqual(upperTree, lowerTree);

  const upperDocument = TextDocument.create(upperUri, "html", 1, upperText);
  const lowerDocument = TextDocument.create(lowerUri, "html", 1, lowerText);
  const upperColors = collectDocumentColors(upperDocument, manager, {
    enabled: true,
    onlyVariables: false,
  });
  const lowerColors = collectDocumentColors(lowerDocument, manager, {
    enabled: true,
    onlyVariables: false,
  });
  assert.equal(upperColors.length, 1);
  assert.equal(lowerColors.length, 1);
  assert.equal(upperColors[0].color.red, 1);
  assert.equal(lowerColors[0].color.blue, 1);
});
