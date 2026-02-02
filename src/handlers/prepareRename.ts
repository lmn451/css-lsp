import { PrepareRenameParams, Range } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CssVariableManager } from "../cssVariableManager";

/**
 * Handle prepare rename requests for CSS variables.
 * Validates that the rename target is a valid CSS variable and returns its range.
 */
export function handlePrepareRename(
  params: PrepareRenameParams,
  documents: { get(uri: string): TextDocument | undefined },
  cssVariableManager: CssVariableManager,
): { range: Range; placeholder: string } | null {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const text = document.getText();
  const offset = document.offsetAt(params.position);

  // Find the word at the cursor position
  const left = text.slice(0, offset).match(/[\w-]*$/);
  const right = text.slice(offset).match(/^[\w-]*/);

  if (!left || !right) {
    return null;
  }

  const word = left[0] + right[0];

  // Only allow renaming CSS variables
  if (!word.startsWith("--")) {
    return null;
  }

  // Check if this variable exists (either as definition or usage)
  const definitions = cssVariableManager.getVariables(word);
  const usages = cssVariableManager.getVariableUsages(word);

  if (definitions.length === 0 && usages.length === 0) {
    // Variable doesn't exist in the workspace
    return null;
  }

  // Calculate the range of the variable name
  const startOffset = offset - left[0].length;
  const endOffset = offset + right[0].length;

  return {
    range: {
      start: document.positionAt(startOffset),
      end: document.positionAt(endOffset),
    },
    placeholder: word,
  };
}
