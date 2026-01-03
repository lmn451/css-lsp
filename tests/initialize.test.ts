import { test } from "node:test";
import { strict as assert } from "node:assert";
import { TextDocumentSyncKind } from "vscode-languageserver/node";
import { buildInitializeResult } from "../src/initialize";

test("initialize result toggles color provider capability", () => {
  const enabled = buildInitializeResult(true, false);
  const disabled = buildInitializeResult(false, false);

  assert.equal(enabled.capabilities.colorProvider, true);
  assert.equal(disabled.capabilities.colorProvider, false);
});

test("initialize result includes workspace folders when supported", () => {
  const withWorkspace = buildInitializeResult(true, true);
  const withoutWorkspace = buildInitializeResult(true, false);

  assert.deepEqual(withWorkspace.capabilities.workspace, {
    workspaceFolders: { supported: true },
  });
  assert.equal(withoutWorkspace.capabilities.workspace, undefined);
});

test("initialize result keeps incremental sync", () => {
  const result = buildInitializeResult(true, false);

  assert.equal(result.capabilities.textDocumentSync, TextDocumentSyncKind.Incremental);
});
