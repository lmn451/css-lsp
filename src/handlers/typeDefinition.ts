import {
  TypeDefinitionParams,
  Definition,
  TextDocumentPositionParams,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CssVariableManager } from "../cssVariableManager";
import { Location } from "vscode-languageserver/node";

/**
 * Handle type definition requests for CSS variables.
 * For CSS variables, type definition is similar to definition - 
 * it refers to where the variable type/value is defined.
 */
export function handleTypeDefinition(
  params: TextDocumentPositionParams,
  documents: { get(uri: string): TextDocument | undefined },
  cssVariableManager: CssVariableManager,
): Definition | null {
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
    const variables = cssVariableManager.getVariables(word);
    if (variables.length > 0) {
      // For CSS variables, type definition points to where the variable is defined
      // This could be enhanced to include type information (color, size, etc.)
      return Location.create(variables[0].uri, variables[0].range);
    }
  }

  return null;
}