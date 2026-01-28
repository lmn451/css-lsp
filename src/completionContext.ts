import { TextDocument } from "vscode-languageserver-textdocument";
import { Position } from "vscode-languageserver/node";
import { CSS_LANGUAGE_IDS, HTML_LIKE_LANGUAGE_IDS } from "./cssVariableManager";

const CONTEXT_WINDOW = 400;

type RawCompletionContext = {
  beforeCursor: string;
  allowWithoutBraces: boolean;
};

export type CssCompletionContext = {
  propertyName: string | null;
  isVarContext: boolean;
};

export function getCssCompletionContext(
  document: TextDocument,
  position: Position,
): CssCompletionContext | null {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const genericBeforeCursor = sliceBeforeCursor(text, offset);
  const hasVarCall = hasVarFunctionContext(genericBeforeCursor);

  const rawContext = getRawCompletionContext(document, position);
  if (!rawContext) {
    return hasVarCall ? { propertyName: null, isVarContext: true } : null;
  }

  const isVarContext = hasVarFunctionContext(rawContext.beforeCursor);

  if (
    !isInCssValueContext(rawContext.beforeCursor, rawContext.allowWithoutBraces)
  ) {
    return hasVarCall ? { propertyName: null, isVarContext: true } : null;
  }

  return {
    propertyName: getPropertyNameFromContext(
      rawContext.beforeCursor,
      rawContext.allowWithoutBraces,
    ),
    isVarContext,
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

  if (!HTML_LIKE_LANGUAGE_IDS.has(languageId)) {
    return null;
  }

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

function hasVarFunctionContext(beforeCursor: string): boolean {
  return /var\(\s*(?:--[\w-]*)?$/.test(beforeCursor);
}

function isInCssValueContext(
  beforeCursor: string,
  allowWithoutBraces: boolean,
): boolean {
  if (hasVarFunctionContext(beforeCursor)) {
    return true;
  }

  return getPropertyNameFromContext(beforeCursor, allowWithoutBraces) !== null;
}

function getPropertyNameFromContext(
  beforeCursor: string,
  allowWithoutBraces: boolean,
): string | null {
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
      if (inParens < 0) break;
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
    return null;
  }

  if (lastColonPos > lastSemicolonPos && lastColonPos > lastBracePos) {
    const beforeColon = beforeCursor.slice(0, lastColonPos).trim();
    const propertyMatch = beforeColon.match(/([\w-]+)$/);
    if (propertyMatch) {
      return propertyMatch[1].toLowerCase();
    }
  }

  return null;
}
