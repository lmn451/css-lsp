import { TextDocument } from "vscode-languageserver-textdocument";
import { Position } from "vscode-languageserver/node";
import { CSS_LANGUAGE_IDS, HTML_LIKE_LANGUAGE_IDS } from "./cssVariableManager";

const CONTEXT_WINDOW = 400;

const JS_LANGUAGE_IDS = new Set([
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
  "js",
  "jsx",
  "ts",
  "tsx",
]);

type RawCompletionContext = {
  beforeCursor: string;
  allowWithoutBraces: boolean;
};

export type CssCompletionContext = {
  propertyName: string | null;
  inVarFunction: boolean;
};

type ValueContext = {
  isValueContext: boolean;
  propertyName: string | null;
};

export function getCssCompletionContext(
  document: TextDocument,
  position: Position,
): CssCompletionContext | null {
  const rawContext = getRawCompletionContext(document, position);
  if (!rawContext) {
    return null;
  }

  const valueContext = getValueContext(
    rawContext.beforeCursor,
    rawContext.allowWithoutBraces,
  );
  if (!valueContext.isValueContext) {
    return null;
  }

  return {
    propertyName: valueContext.propertyName,
    inVarFunction: isVarFunctionContext(rawContext.beforeCursor),
  };
}

function getRawCompletionContext(
  document: TextDocument,
  position: Position,
): RawCompletionContext | null {
  const languageId = document.languageId.toLowerCase();
  const text = document.getText();
  const offset = document.offsetAt(position);

  if (CSS_LANGUAGE_IDS.has(languageId)) {
    return {
      beforeCursor: sliceBeforeCursor(text, offset),
      allowWithoutBraces: false,
    };
  }

  if (HTML_LIKE_LANGUAGE_IDS.has(languageId)) {
    const inlineStyle = extractInlineStyleContext(text, offset);
    if (inlineStyle) {
      return {
        beforeCursor: inlineStyle,
        allowWithoutBraces: true,
      };
    }

    const styleBlock = extractStyleBlockContext(text, offset);
    if (styleBlock) {
      return {
        beforeCursor: styleBlock,
        allowWithoutBraces: false,
      };
    }

    return null;
  }

  if (JS_LANGUAGE_IDS.has(languageId)) {
    const beforeCursor = sliceBeforeCursor(text, offset);
    const jsString = extractJsStringContext(beforeCursor);
    if (!jsString) {
      return null;
    }
    return {
      beforeCursor: jsString,
      allowWithoutBraces: true,
    };
  }

  return null;
}

function isVarFunctionContext(beforeCursor: string): boolean {
  return /(?:^|[^\w-])var\(\s*(?:--[\w-]*)?$/i.test(beforeCursor);
}

function sliceBeforeCursor(text: string, offset: number): string {
  const start = Math.max(0, offset - CONTEXT_WINDOW);
  return text.slice(start, offset);
}

function trimContext(value: string): string {
  if (value.length <= CONTEXT_WINDOW) {
    return value;
  }
  return value.slice(value.length - CONTEXT_WINDOW);
}

function extractInlineStyleContext(text: string, offset: number): string | null {
  const lastTagClose = text.lastIndexOf(">", offset);
  const tagStart = text.lastIndexOf("<", offset);
  if (tagStart === -1 || tagStart < lastTagClose) {
    return null;
  }

  const tagText = text.slice(tagStart, offset);
  const match = tagText.match(/style\s*=\s*(["'])([^"']*)$/i);
  if (!match) {
    return null;
  }

  return trimContext(match[2]);
}

function extractStyleBlockContext(text: string, offset: number): string | null {
  const beforeCursor = text.slice(0, offset);
  const beforeLower = beforeCursor.toLowerCase();

  const openIndex = beforeLower.lastIndexOf("<style");
  if (openIndex === -1) {
    return null;
  }

  const closeIndex = beforeLower.lastIndexOf("</style");
  if (closeIndex > openIndex) {
    return null;
  }

  const tagEnd = beforeLower.indexOf(">", openIndex);
  if (tagEnd === -1 || tagEnd >= beforeCursor.length) {
    return null;
  }

  const cssBeforeCursor = beforeCursor.slice(tagEnd + 1);
  return trimContext(cssBeforeCursor);
}

function extractJsStringContext(beforeCursor: string): string | null {
  let inQuote: "'" | '"' | null = null;
  let inTemplate = false;
  let templateExprDepth = 0;
  let exprQuote: "'" | '"' | "`" | null = null;
  let segmentStart: number | null = null;

  for (let i = 0; i < beforeCursor.length; i++) {
    const char = beforeCursor[i];

    if (inQuote) {
      if (char === "\\") {
        i++;
        continue;
      }
      if (char === inQuote) {
        inQuote = null;
        segmentStart = null;
      }
      continue;
    }

    if (inTemplate) {
      if (templateExprDepth > 0) {
        if (exprQuote) {
          if (char === "\\") {
            i++;
            continue;
          }
          if (char === exprQuote) {
            exprQuote = null;
          }
          continue;
        }

        if (char === "'" || char === '"' || char === "`") {
          exprQuote = char as "'" | '"' | "`";
          continue;
        }
        if (char === "{") {
          templateExprDepth++;
          continue;
        }
        if (char === "}") {
          templateExprDepth--;
          if (templateExprDepth === 0) {
            segmentStart = i + 1;
          }
          continue;
        }
        continue;
      }

      if (char === "\\") {
        i++;
        continue;
      }
      if (char === "`") {
        inTemplate = false;
        segmentStart = null;
        continue;
      }
      if (char === "$" && beforeCursor[i + 1] === "{") {
        templateExprDepth = 1;
        segmentStart = null;
        i++;
        continue;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      inQuote = char as "'" | '"';
      segmentStart = i + 1;
      continue;
    }

    if (char === "`") {
      inTemplate = true;
      segmentStart = i + 1;
    }
  }

  if (inQuote && segmentStart !== null) {
    return beforeCursor.slice(segmentStart);
  }

  if (inTemplate && templateExprDepth === 0 && segmentStart !== null) {
    return beforeCursor.slice(segmentStart);
  }

  return null;
}

function getValueContext(
  beforeCursor: string,
  allowWithoutBraces: boolean,
): ValueContext {
  let inBraces = 0;
  let inParens = 0;
  let lastColonPos = -1;
  let lastSemicolonPos = -1;
  let lastBracePos = -1;

  for (let i = beforeCursor.length - 1; i >= 0; i--) {
    const char = beforeCursor[i];

    if (char === ")") inParens++;
    else if (char === "(") {
      inParens--;
      if (inParens < 0) {
        inParens = 0;
      }
    } else if (char === "}") inBraces++;
    else if (char === "{") {
      inBraces--;
      if (inBraces < 0) {
        lastBracePos = i;
        break;
      }
    } else if (
      char === ":" &&
      inParens === 0 &&
      inBraces === 0 &&
      lastColonPos === -1
    ) {
      lastColonPos = i;
    } else if (
      char === ";" &&
      inParens === 0 &&
      inBraces === 0 &&
      lastSemicolonPos === -1
    ) {
      lastSemicolonPos = i;
    }
  }

  if (!allowWithoutBraces && lastBracePos === -1) {
    return { isValueContext: false, propertyName: null };
  }

  if (lastColonPos > lastSemicolonPos && lastColonPos > lastBracePos) {
    const beforeColon = beforeCursor.slice(0, lastColonPos).trim();
    const propertyMatch = beforeColon.match(/([\w-]+)$/);
    return {
      isValueContext: true,
      propertyName: propertyMatch ? propertyMatch[1].toLowerCase() : null,
    };
  }

  return { isValueContext: false, propertyName: null };
}
