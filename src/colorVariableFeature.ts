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
import { Logger } from "./logger";

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
  cssVariableManager: CssVariableManager,
  logger: Logger
): Diagnostic[] {
  try {
    return cssVariableManager
      .getDocumentColorLiterals(document.uri)
      .flatMap((literal) => {
        if (literal.variableName) {
          return [];
        }

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
  } catch (error) {
    logger.error("collectColorReplacementDiagnostics", { error });
    return [];
  }
}
export function getColorReplacementCompletionItems(
  document: TextDocument,
  position: Position,
  cssVariableManager: CssVariableManager,
  displayOptions: CompletionDisplayOptions,
  logger: Logger
): CompletionItem[] {
  try {
    const literal = findColorLiteralAtPosition(document, position, cssVariableManager);
    if (!literal) {
      return [];
    }

    return getMatchingVariables(literal, cssVariableManager).map((match) =>
      createColorReplacementCompletionItem(document, literal.range, match, displayOptions)
    );
  } catch (error) {
    logger.error("getColorReplacementCompletionItems", { error });
    return [];
  }
}
export function getColorReplacementCodeActions(
  document: TextDocument,
  diagnostics: Diagnostic[],
  logger: Logger
): CodeAction[] {
  try {
    const actions: CodeAction[] = [];

    for (const diagnostic of diagnostics) {
      if (diagnostic.code !== COLOR_REPLACEMENT_DIAGNOSTIC_CODE) {
        continue;
      }

      const data = diagnostic.data as ColorReplacementDiagnosticData | undefined;
      if (!isValidDiagnosticData(data)) {
        logger.error("getColorReplacementCodeActions", { diagnostic: diagnostic.data });
        continue;
      }

      const variableNames = data.variableNames;

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
  } catch (error) {
    logger.error("getColorReplacementCodeActions", { error });
    return [];
  }
}
function findColorLiteralAtPosition(
  document: TextDocument,
  position: Position,
  cssVariableManager: CssVariableManager
): CssColorLiteral | null {
  const offset = document.offsetAt(position);
  const targetLine = position.line;

  const lineLiterals = cssVariableManager.getDocumentColorLiteralsByLine(
    document.uri,
    targetLine
  );

  for (const literal of lineLiterals) {
    const start = document.offsetAt(literal.range.start);
    const end = document.offsetAt(literal.range.end);
    if (!isRangeValid(literal.range) || start > end) {
      continue;
    }
    if (offset >= start && offset <= end) {
      return literal;
    }
  }

  return null;
}

function isValidDiagnosticData(data: unknown): data is ColorReplacementDiagnosticData {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  return (
    obj.kind === COLOR_REPLACEMENT_DIAGNOSTIC_CODE &&
    Array.isArray(obj.variableNames) &&
    obj.variableNames.every((v) => typeof v === "string")
  );
}

function isRangeValid(range: Range): boolean {
  if (range.start.line < 0 || range.start.character < 0) {
    return false;
  }
  if (range.end.line < 0 || range.end.character < 0) {
    return false;
  }
  if (range.start.line > range.end.line) {
    return false;
  }
  if (range.start.line === range.end.line && range.start.character > range.end.character) {
    return false;
  }
  return true;
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
  _document: TextDocument,
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

// Check if cursor position is on a CSS variable definition
export function isPositionOnDefinition(
  document: TextDocument,
  definitions: CssVariable[],
  position: Position,
): boolean {
  const cursorOffset = document.offsetAt(position);
  return definitions.some((def) => {
    const start = document.offsetAt(def.range.start);
    const end = document.offsetAt(def.range.end);
    return cursorOffset >= start && cursorOffset <= end;
  });
}
