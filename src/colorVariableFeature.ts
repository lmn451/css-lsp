import {
  CodeAction,
  CodeActionKind,
  CompletionItem,
  CompletionItemKind,
  Diagnostic,
  DiagnosticSeverity,
  Position,
  Range,
  TextEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CssColorLiteral, CssVariable, CssVariableManager } from "./cssVariableManager";

export const COLOR_REPLACEMENT_DIAGNOSTIC_CODE = "replace-with-css-variable";

export interface ColorReplacementDiagnosticData {
  kind: typeof COLOR_REPLACEMENT_DIAGNOSTIC_CODE;
  variableNames: string[];
}

export interface CompletionDisplayOptions {
  formatLocation(uri: string): string;
}

export function collectColorReplacementDiagnostics(
  document: TextDocument,
  cssVariableManager: CssVariableManager
): Diagnostic[] {
  return cssVariableManager
    .getDocumentColorLiterals(document.uri)
    .flatMap((literal) => {
      const matches = getMatchingVariables(literal, cssVariableManager);
      if (matches.length === 0) {
        return [];
      }

      const variableNames = matches.map((match) => match.name);
      const message =
        variableNames.length === 1
          ? `Literal color can be replaced with matching CSS variable '${variableNames[0]}'`
          : `Literal color can be replaced with matching CSS variables: ${variableNames.map((n) => `'${n}'`).join(", ")}`;

      return [
        {
          severity: DiagnosticSeverity.Information,
          range: literal.range,
          message,
          source: "css-variable-lsp",
          code: COLOR_REPLACEMENT_DIAGNOSTIC_CODE,
          data: {
            kind: COLOR_REPLACEMENT_DIAGNOSTIC_CODE,
            variableNames,
          } satisfies ColorReplacementDiagnosticData,
        },
      ];
    });
}

export function getColorReplacementCompletionItems(
  document: TextDocument,
  position: Position,
  cssVariableManager: CssVariableManager,
  displayOptions: CompletionDisplayOptions
): CompletionItem[] {
  const literal = findColorLiteralAtPosition(document, position, cssVariableManager);
  if (!literal) {
    return [];
  }

  return getMatchingVariables(literal, cssVariableManager).map((match) =>
    createColorReplacementCompletionItem(document, literal.range, match, displayOptions)
  );
}

export function getColorReplacementCodeActions(
  document: TextDocument,
  diagnostics: Diagnostic[]
): CodeAction[] {
  const actions: CodeAction[] = [];

  for (const diagnostic of diagnostics) {
    if (diagnostic.code !== COLOR_REPLACEMENT_DIAGNOSTIC_CODE) {
      continue;
    }

    const data = diagnostic.data as ColorReplacementDiagnosticData | undefined;
    const variableNames = data?.variableNames || [];

    for (const variableName of variableNames) {
      actions.push({
        title: `Replace with var(${variableName})`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        edit: {
          changes: {
            [document.uri]: [
              TextEdit.replace(diagnostic.range, `var(${variableName})`),
            ],
          },
        },
      });
    }
  }

  return actions;
}

function findColorLiteralAtPosition(
  document: TextDocument,
  position: Position,
  cssVariableManager: CssVariableManager
): CssColorLiteral | null {
  const offset = document.offsetAt(position);

  for (const literal of cssVariableManager.getDocumentColorLiterals(document.uri)) {
    const start = document.offsetAt(literal.range.start);
    const end = document.offsetAt(literal.range.end);
    if (offset >= start && offset <= end) {
      return literal;
    }
  }

  return null;
}

function getMatchingVariables(
  literal: CssColorLiteral,
  cssVariableManager: CssVariableManager
): CssVariable[] {
  return cssVariableManager.getVariablesByColor(literal.color, {
    excludeName: literal.variableName,
  });
}

function createColorReplacementCompletionItem(
  document: TextDocument,
  range: Range,
  match: CssVariable,
  displayOptions: CompletionDisplayOptions
): CompletionItem {
  return {
    label: `var(${match.name})`,
    kind: CompletionItemKind.Variable,
    detail: match.value,
    documentation: `Defined in ${displayOptions.formatLocation(match.uri)}`,
    textEdit: TextEdit.replace(range, `var(${match.name})`),
    filterText: `var(${match.name})`,
    sortText: match.name,
  };
}
