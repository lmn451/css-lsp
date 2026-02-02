import {
  SelectionRangeParams,
  SelectionRange,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import * as csstree from "css-tree";
import { Range, Position } from "vscode-languageserver/node";

/**
 * Handle selection range requests for CSS documents.
 * Returns nested selection ranges for smart "expand selection" functionality.
 * Selection hierarchy: value → declaration → rule block → at-rule → stylesheet
 */
export function handleSelectionRanges(
  params: SelectionRangeParams,
  documents: { get(uri: string): TextDocument | undefined },
): SelectionRange[] | null {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const text = document.getText();
  const results: SelectionRange[] = [];

  // Parse CSS once
  let ast: csstree.CssNode | null = null;
  try {
    ast = csstree.parse(text, {
      positions: true,
      parseCustomProperty: true,
      onParseError: () => {},
    });
  } catch {
    // If parsing fails, return null
    return null;
  }

  for (const position of params.positions) {
    const offset = document.offsetAt(position);
    const ranges = findContainingRanges(ast, offset, document);

    if (ranges.length === 0) {
      // Fallback: return the whole document
      results.push({
        range: {
          start: { line: 0, character: 0 },
          end: document.positionAt(text.length),
        },
      });
    } else {
      // Build nested SelectionRange from innermost to outermost
      let selectionRange: SelectionRange | undefined;
      for (let i = ranges.length - 1; i >= 0; i--) {
        selectionRange = {
          range: ranges[i],
          parent: selectionRange,
        };
      }
      results.push(selectionRange!);
    }
  }

  return results;
}

interface NodeWithLocation {
  type: string;
  loc: csstree.CssLocation;
}

/**
 * Find all AST nodes that contain the given offset, from innermost to outermost.
 */
function findContainingRanges(
  ast: csstree.CssNode,
  offset: number,
  document: TextDocument,
): Range[] {
  const containers: NodeWithLocation[] = [];

  csstree.walk(ast, {
    enter(node: csstree.CssNode) {
      if (!node.loc) return;

      const startOffset = document.offsetAt({
        line: node.loc.start.line - 1,
        character: node.loc.start.column - 1,
      });
      const endOffset = document.offsetAt({
        line: node.loc.end.line - 1,
        character: node.loc.end.column - 1,
      });

      if (offset >= startOffset && offset <= endOffset) {
        // Include useful node types for selection
        if (
          node.type === "StyleSheet" ||
          node.type === "Rule" ||
          node.type === "Atrule" ||
          node.type === "Block" ||
          node.type === "Declaration" ||
          node.type === "Value" ||
          node.type === "SelectorList" ||
          node.type === "Selector"
        ) {
          containers.push({ type: node.type, loc: node.loc });
        }
      }
    },
  });

  // Convert to Range objects, outermost first (StyleSheet → ... → Value)
  return containers.map((c) => ({
    start: {
      line: c.loc.start.line - 1,
      character: c.loc.start.column - 1,
    },
    end: {
      line: c.loc.end.line - 1,
      character: c.loc.end.column - 1,
    },
  }));
}
