import {
  DocumentHighlightParams,
  DocumentHighlight,
  DocumentHighlightKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CssVariableManager } from "../cssVariableManager";
import { Range, Position } from "vscode-languageserver/node";

/**
 * Handle document highlight requests for CSS variables.
 * Highlights all occurrences of the variable at the cursor position.
 */
export function handleDocumentHighlight(
  params: DocumentHighlightParams,
  documents: { get(uri: string): TextDocument | undefined },
  cssVariableManager: CssVariableManager,
): DocumentHighlight[] | null {
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

  // Check if it's a CSS variable
  if (word.startsWith("--")) {
    const highlights: DocumentHighlight[] = [];
    
    // Get all references to this variable
    const references = cssVariableManager.getReferences(word);
    
    // Filter references to only those in the current document
    const currentDocRefs = references.filter(ref => ref.uri === document.uri);
    
    // Create highlights for each reference
    for (const ref of currentDocRefs) {
      // Check if it's a definition by checking if it has a selector property
      const isDefinition = 'selector' in ref;
      const highlight: DocumentHighlight = {
        range: ref.range,
        // Use Write kind for definitions, Text kind for usages
        kind: isDefinition ? DocumentHighlightKind.Write : DocumentHighlightKind.Text,
      };
      highlights.push(highlight);
    }
    
    return highlights;
  }

  return null;
}