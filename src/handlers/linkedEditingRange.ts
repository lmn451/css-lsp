import {
  LinkedEditingRangeParams,
  LinkedEditingRanges,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CssVariableManager } from "../cssVariableManager";
import { Range } from "vscode-languageserver/node";

/**
 * Handle linked editing range requests for CSS variables.
 * Returns ranges that should be edited simultaneously (variable name in definition and usages).
 */
export function handleLinkedEditingRange(
  params: LinkedEditingRangeParams,
  documents: { get(uri: string): TextDocument | undefined },
  cssVariableManager: CssVariableManager,
): LinkedEditingRanges | null {
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

  // Only for CSS variables
  if (!word.startsWith("--")) {
    return null;
  }

  // Get all references to this variable in the current document
  const references = cssVariableManager.getReferences(word);
  const documentRefs = references.filter((ref) => ref.uri === document.uri);

  if (documentRefs.length === 0) {
    return null;
  }

  // Return all ranges that contain just the variable name
  const ranges: Range[] = documentRefs
    .map((ref) => ref.nameRange || ref.range)
    .filter((range) => range !== undefined) as Range[];

  if (ranges.length === 0) {
    return null;
  }

  return {
    ranges,
    // CSS variable names follow this pattern
    wordPattern: "--[\\w-]+",
  };
}
