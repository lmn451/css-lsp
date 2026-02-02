import {
  SemanticTokensParams,
  SemanticTokens,
  SemanticTokensBuilder,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CssVariableManager } from "../cssVariableManager";

// Define token types and modifiers
export const tokenTypes = [
  "variable",
  "property",
  "value",
  "string",
  "comment",
];
export const tokenModifiers = ["declaration", "readonly", "static"];

export const semanticTokensLegend = {
  tokenTypes,
  tokenModifiers,
};

/**
 * Handle semantic tokens requests.
 * Provides syntax highlighting for CSS variables and properties.
 */
export function handleSemanticTokens(
  params: SemanticTokensParams,
  documents: { get(uri: string): TextDocument | undefined },
  cssVariableManager: CssVariableManager,
): SemanticTokens | null {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const text = document.getText();
  const builder = new SemanticTokensBuilder();

  // Highlight CSS variables --var-name
  const variableRegex = /--[\w-]+/g;
  let match;

  while ((match = variableRegex.exec(text)) !== null) {
    const startPos = document.positionAt(match.index);
    const length = match[0].length;

    // Determine if it's a declaration or usage
    // Heuristic: check if followed by ":"
    const afterMatch = text.slice(match.index + length);
    const isDeclaration = /^\s*:/.test(afterMatch);

    let variableType = 0; // "variable"
    let modifiers = 0;

    if (isDeclaration) {
      modifiers |= 1 << 0; // "declaration"
    }

    builder.push(
      startPos.line,
      startPos.character,
      length,
      variableType,
      modifiers,
    );
  }

  // Highlight var() functions
  const varFuncRegex = /var\(/g;
  while ((match = varFuncRegex.exec(text)) !== null) {
    const startPos = document.positionAt(match.index);
    // Highlight "var"
    builder.push(
      startPos.line,
      startPos.character,
      3,
      1, // "property" (misusing property for function keyword here for distinction)
      0,
    );
  }

  return builder.build();
}
