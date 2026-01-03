import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  formatColorAsHex,
  formatColorAsRgb,
  formatColorAsHsl,
} from "../src/colorService";
import { CssVariableManager } from "../src/cssVariableManager";
import { TextDocument } from "vscode-languageserver-textdocument";
import { Range } from "vscode-languageserver/node";

test("color formatting", () => {
  const red = { red: 1, green: 0, blue: 0, alpha: 1 };
  const semiTransparent = { red: 0, green: 1, blue: 0, alpha: 0.5 };

  assert.strictEqual(formatColorAsHex(red), "#ff0000");
  assert.strictEqual(formatColorAsHex(semiTransparent), "#00ff0080");

  assert.strictEqual(formatColorAsRgb(red), "rgb(255, 0, 0)");
  assert.strictEqual(formatColorAsRgb(semiTransparent), "rgba(0, 255, 0, 0.5)");

  assert.strictEqual(formatColorAsHsl(red), "hsl(0, 100%, 50%)");
  assert.strictEqual(
    formatColorAsHsl(semiTransparent),
    "hsla(120, 100%, 50%, 0.5)",
  );
});

test("value range calculation", () => {
  const manager = new CssVariableManager();
  const css = `
		:root {
			--simple: red;
			--spaced:   blue  ;
			--complex: rgb(0,0,0);
		}
	`;
  const document = TextDocument.create("file:///test.css", "css", 1, css);
  manager.parseDocument(document);

  const simple = manager.getVariables("--simple")[0];
  const spaced = manager.getVariables("--spaced")[0];
  const complex = manager.getVariables("--complex")[0];

  const getText = (range: Range) => {
    const start = document.offsetAt(range.start);
    const end = document.offsetAt(range.end);
    return css.substring(start, end);
  };

  if (!simple.valueRange) {
    throw new Error("Expected valueRange for --simple");
  }
  assert.strictEqual(getText(simple.valueRange), "red");

  if (!spaced.valueRange) {
    throw new Error("Expected valueRange for --spaced");
  }
  assert.strictEqual(getText(spaced.valueRange), "blue");

  if (!complex.valueRange) {
    throw new Error("Expected valueRange for --complex");
  }
  assert.strictEqual(getText(complex.valueRange), "rgb(0,0,0)");
});
