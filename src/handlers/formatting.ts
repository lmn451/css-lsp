import {
  DocumentFormattingParams,
  DocumentRangeFormattingParams,
  TextEdit,
  Range,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

/**
 * Handle document formatting requests.
 * Basic CSS formatting implementation.
 */
export function handleDocumentFormatting(
  params: DocumentFormattingParams,
  documents: { get(uri: string): TextDocument | undefined },
): TextEdit[] | null {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const text = document.getText();
  const formatted = formatCss(text, params.options);

  // Replace entire document
  const fullRange: Range = {
    start: document.positionAt(0),
    end: document.positionAt(text.length),
  };

  return [TextEdit.replace(fullRange, formatted)];
}

/**
 * Handle document range formatting requests.
 */
export function handleDocumentRangeFormatting(
  params: DocumentRangeFormattingParams,
  documents: { get(uri: string): TextDocument | undefined },
): TextEdit[] | null {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const startOffset = document.offsetAt(params.range.start);
  const endOffset = document.offsetAt(params.range.end);
  const text = document.getText();

  // Format the selected text (basic implementation)
  const selectedText = text.slice(startOffset, endOffset);
  const formatted = formatCss(selectedText, params.options);

  return [TextEdit.replace(params.range, formatted)];
}

/**
 * Simple CSS formatter.
 * TODO: Integrate a proper parser/formatter like prettier or css-tree's generator if needed.
 * This is a basic rule-based formatter.
 */
function formatCss(
  text: string,
  options: { tabSize: number; insertSpaces: boolean },
): string {
  const indentChar = options.insertSpaces ? " ".repeat(options.tabSize) : "\t";
  let depth = 0;
  let output = "";
  let insideString: string | null = null;

  // Normalize newlines
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const joined = lines.join(" ");

  // Simple tokenizing
  let i = 0;
  while (i < joined.length) {
    const char = joined[i];

    if (insideString) {
      output += char;
      if (char === insideString && joined[i - 1] !== "\\") {
        insideString = null;
      }
      i++;
      continue;
    }

    if (char === '"' || char === "'") {
      insideString = char;
      output += char;
      i++;
      continue;
    }

    if (char === "{") {
      depth++;
      output += " {\n" + indentChar.repeat(depth);
      i++;
    } else if (char === "}") {
      depth = Math.max(0, depth - 1);
      output = output.trimEnd() + "\n" + indentChar.repeat(depth) + "}";
      // If next char is not a closing brace, add newline
      if (i + 1 < joined.length && joined[i + 1] !== "}") {
        output += "\n" + indentChar.repeat(depth);
      }
      i++;
    } else if (char === ";") {
      output += ";\n" + indentChar.repeat(depth);
      i++;
    } else {
      output += char;
      i++;
    }
  }

  return output.trim() + "\n";
}
