import { test } from "node:test";
import { strict as assert } from "node:assert";
import * as os from "node:os";
import * as path from "node:path";
import { URI } from "vscode-uri";
import { formatUriForDisplay } from "../src/pathDisplay";

test("relative mode prefers shortest workspace root", () => {
  const root = path.join(os.tmpdir(), "css-lsp-root");
  const nestedRoot = path.join(root, "nested");
  const filePath = path.join(nestedRoot, "file.css");
  const uri = URI.file(filePath).toString();

  const result = formatUriForDisplay(uri, {
    mode: "relative",
    abbrevLength: 1,
    workspaceFolderPaths: [root, nestedRoot],
    rootFolderPath: null,
  });

  assert.equal(result, "file.css");
});

test("absolute mode returns full path", () => {
  const root = path.join(os.tmpdir(), "css-lsp-abs");
  const filePath = path.join(root, "styles", "file.css");
  const uri = URI.file(filePath).toString();

  const result = formatUriForDisplay(uri, {
    mode: "absolute",
    abbrevLength: 1,
    workspaceFolderPaths: [root],
    rootFolderPath: null,
  });

  assert.equal(result, filePath);
});

test("abbreviated mode shortens intermediate segments", () => {
  const root = path.join(os.tmpdir(), "css-lsp-abbrev");
  const filePath = path.join(
    root,
    "src",
    "components",
    "button",
    "file.css",
  );
  const uri = URI.file(filePath).toString();

  const result = formatUriForDisplay(uri, {
    mode: "abbreviated",
    abbrevLength: 1,
    workspaceFolderPaths: [root],
    rootFolderPath: null,
  });

  const expected = ["s", "c", "b", "file.css"].join(path.sep);
  assert.equal(result, expected);
});

test("abbreviated mode length 0 leaves path intact", () => {
  const root = path.join(os.tmpdir(), "css-lsp-abbrev-zero");
  const filePath = path.join(root, "src", "styles", "file.css");
  const uri = URI.file(filePath).toString();

  const result = formatUriForDisplay(uri, {
    mode: "abbreviated",
    abbrevLength: 0,
    workspaceFolderPaths: [root],
    rootFolderPath: null,
  });

  const expected = path.join("src", "styles", "file.css");
  assert.equal(result, expected);
});
