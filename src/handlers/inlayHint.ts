import {
  InlayHintParams,
  InlayHint,
  InlayHintKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CssVariableManager } from "../cssVariableManager";

/**
 * Handle inlay hint requests for CSS documents.
 * Shows resolved variable values inline after var() usages.
 */
export function handleInlayHints(
  params: InlayHintParams,
  documents: { get(uri: string): TextDocument | undefined },
  cssVariableManager: CssVariableManager,
): InlayHint[] | null {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const text = document.getText();
  const hints: InlayHint[] = [];

  // Find all var(--name) usages
  const varRegex = /var\((--[\w-]+)(?:\s*,\s*[^)]+)?\)/g;
  let match;

  while ((match = varRegex.exec(text)) !== null) {
    const variableName = match[1];
    const matchEnd = match.index + match[0].length;

    // Check if this match is within the requested range
    const endPos = document.positionAt(matchEnd);
    if (
      endPos.line < params.range.start.line ||
      endPos.line > params.range.end.line
    ) {
      continue;
    }

    // Get the variable value
    const variables = cssVariableManager.getVariables(variableName);
    if (variables.length === 0) {
      continue;
    }

    // Use the first (highest priority) definition
    const value = variables[0].value;

    // Truncate long values
    const displayValue = value.length > 30 ? value.slice(0, 27) + "..." : value;

    hints.push({
      position: endPos,
      label: ` → ${displayValue}`,
      kind: InlayHintKind.Type,
      paddingLeft: true,
    });
  }

  return hints;
}
