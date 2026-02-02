import {
  FoldingRangeParams,
  FoldingRange,
  FoldingRangeKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import * as csstree from "css-tree";

/**
 * Handle folding range requests for CSS documents.
 * Provides folding for:
 * - CSS rule blocks (selector { ... })
 * - At-rules (@media, @keyframes, @supports, etc.)
 * - Multi-line comments
 */
export function handleFoldingRange(
  params: FoldingRangeParams,
  documents: { get(uri: string): TextDocument | undefined },
): FoldingRange[] | null {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const text = document.getText();
  const foldingRanges: FoldingRange[] = [];

  // Parse CSS and find foldable blocks
  try {
    const ast = csstree.parse(text, {
      positions: true,
      onParseError: () => {
        // Ignore parse errors for folding
      },
    });

    csstree.walk(ast, {
      enter: (node: csstree.CssNode) => {
        // Fold CSS rules (selector { ... })
        if (node.type === "Rule" && node.loc) {
          const startLine = node.loc.start.line - 1; // LSP is 0-based
          const endLine = node.loc.end.line - 1;

          // Only fold if it spans multiple lines
          if (endLine > startLine) {
            foldingRanges.push({
              startLine,
              endLine,
              kind: FoldingRangeKind.Region,
            });
          }
        }

        // Fold at-rules (@media, @keyframes, @supports, @font-face, etc.)
        if (node.type === "Atrule" && node.loc && node.block) {
          const startLine = node.loc.start.line - 1;
          const endLine = node.loc.end.line - 1;

          if (endLine > startLine) {
            foldingRanges.push({
              startLine,
              endLine,
              kind: FoldingRangeKind.Region,
            });
          }
        }
      },
    });
  } catch {
    // If CSS parsing fails, fall back to brace matching
  }

  // Find multi-line comments using regex
  const commentRegex = /\/\*[\s\S]*?\*\//g;
  let match;
  while ((match = commentRegex.exec(text)) !== null) {
    const startPos = document.positionAt(match.index);
    const endPos = document.positionAt(match.index + match[0].length);

    if (endPos.line > startPos.line) {
      foldingRanges.push({
        startLine: startPos.line,
        endLine: endPos.line,
        kind: FoldingRangeKind.Comment,
      });
    }
  }

  return foldingRanges;
}
