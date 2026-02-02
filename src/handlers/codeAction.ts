import {
  CodeActionParams,
  CodeAction,
  CodeActionKind,
  Diagnostic,
  TextEdit,
  WorkspaceEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CssVariableManager } from "../cssVariableManager";

/**
 * Handle code action requests for CSS documents.
 * Provides quick fixes for undefined CSS variables.
 */
export function handleCodeActions(
  params: CodeActionParams,
  documents: { get(uri: string): TextDocument | undefined },
  cssVariableManager: CssVariableManager,
): CodeAction[] | null {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const codeActions: CodeAction[] = [];

  // Process diagnostics for undefined variables
  for (const diagnostic of params.context.diagnostics) {
    if (diagnostic.source !== "css-variable-lsp") {
      continue;
    }

    // Extract variable name from the diagnostic message
    const match = diagnostic.message.match(
      /CSS variable '(--[\w-]+)' is not defined/,
    );
    if (!match) {
      continue;
    }

    const variableName = match[1];

    // Code action: Create variable in :root
    const createInRootAction = createVariableInRoot(
      document,
      variableName,
      diagnostic,
    );
    if (createInRootAction) {
      codeActions.push(createInRootAction);
    }

    // Code action: Suggest similar existing variables
    const suggestions = getSimilarVariables(variableName, cssVariableManager);
    for (const suggestion of suggestions) {
      codeActions.push(
        createReplacementAction(document, diagnostic, variableName, suggestion),
      );
    }
  }

  return codeActions;
}

/**
 * Create a code action to define the variable in :root
 */
function createVariableInRoot(
  document: TextDocument,
  variableName: string,
  diagnostic: Diagnostic,
): CodeAction | null {
  const text = document.getText();

  // Find :root selector
  const rootMatch = text.match(/:root\s*\{/);

  let edit: WorkspaceEdit;

  if (rootMatch) {
    // Add variable after :root {
    const insertPosition = document.positionAt(
      rootMatch.index! + rootMatch[0].length,
    );
    edit = {
      changes: {
        [document.uri]: [
          {
            range: { start: insertPosition, end: insertPosition },
            newText: `\n  ${variableName}: /* TODO: add value */;`,
          },
        ],
      },
    };
  } else {
    // Add :root at the start of the file
    const startPos = { line: 0, character: 0 };
    edit = {
      changes: {
        [document.uri]: [
          {
            range: { start: startPos, end: startPos },
            newText: `:root {\n  ${variableName}: /* TODO: add value */;\n}\n\n`,
          },
        ],
      },
    };
  }

  return {
    title: `Create '${variableName}' in :root`,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    edit,
  };
}

/**
 * Find similar variable names that might be typos
 */
function getSimilarVariables(
  variableName: string,
  cssVariableManager: CssVariableManager,
): string[] {
  const allVariables = cssVariableManager.getAllVariables();
  const uniqueNames = new Set(allVariables.map((v) => v.name));

  const similar: string[] = [];
  const varNameLower = variableName.toLowerCase();

  for (const name of uniqueNames) {
    const nameLower = name.toLowerCase();

    // Simple similarity check: same prefix or few character difference
    if (
      nameLower.startsWith(varNameLower.slice(0, 5)) ||
      varNameLower.startsWith(nameLower.slice(0, 5)) ||
      levenshteinDistance(varNameLower, nameLower) <= 3
    ) {
      similar.push(name);
      if (similar.length >= 3) break; // Limit suggestions
    }
  }

  return similar;
}

/**
 * Create a code action to replace variable with a suggestion
 */
function createReplacementAction(
  document: TextDocument,
  diagnostic: Diagnostic,
  original: string,
  replacement: string,
): CodeAction {
  return {
    title: `Replace with '${replacement}'`,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    edit: {
      changes: {
        [document.uri]: [
          {
            range: diagnostic.range,
            newText: `var(${replacement})`,
          },
        ],
      },
    },
  };
}

/**
 * Simple Levenshtein distance for typo detection
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}
