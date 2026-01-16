import {
  Color,
  ColorInformation,
  ColorPresentation,
  Range,
  TextEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CssVariableManager } from "./cssVariableManager";
import {
  formatColorAsHex,
  formatColorAsHsl,
  formatColorAsRgb,
  parseColor,
} from "./colorService";

export interface ColorProviderOptions {
  enabled: boolean;
  onlyVariables: boolean;
}

export function collectDocumentColors(
  document: TextDocument,
  cssVariableManager: CssVariableManager,
  options: ColorProviderOptions
): ColorInformation[] {
  if (!options.enabled) {
    return [];
  }

  const colors: ColorInformation[] = [];
  const text = document.getText();

  // 1. Check variable definitions: --my-color: #f00;
  // Only show color boxes on definitions if onlyVariables is false
  if (!options.onlyVariables) {
    const definitions = cssVariableManager.getDocumentDefinitions(document.uri);
    for (const def of definitions) {
      const color = parseColor(def.value, { allowNamedColors: true });
      if (color) {
        // Use the stored valueRange if available (accurate from csstree parsing)
        if (def.valueRange) {
          colors.push({
            range: def.valueRange,
            color: color,
          });
        } else {
          // Fallback: find the value within the declaration text
          const defText = text.substring(
            document.offsetAt(def.range.start),
            document.offsetAt(def.range.end)
          );
          const colonIndex = defText.indexOf(":");
          if (colonIndex !== -1) {
            const afterColon = defText.substring(colonIndex + 1);
            const valueIndex = afterColon.indexOf(def.value.trim());

            if (valueIndex !== -1) {
              const absoluteValueStart =
                document.offsetAt(def.range.start) +
                colonIndex +
                1 +
                valueIndex;
              const start = document.positionAt(absoluteValueStart);
              const end = document.positionAt(
                absoluteValueStart + def.value.trim().length
              );
              colors.push({
                range: { start, end },
                color: color,
              });
            }
          }
        }
      }
    }
  }

  // 2. Check variable usages: var(--my-color)
  // Always show color boxes on var() usages (resolved CSS variable color)
  const regex = /var\(\s*(--[\w-]+)\s*(?:,\s*[^)]+)?\s*\)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const varName = match[1];
    const color = cssVariableManager.resolveVariableColor(varName);

    if (color) {
      const start = document.positionAt(match.index);
      const end = document.positionAt(match.index + match[0].length);
      colors.push({
        range: { start, end },
        color: color,
      });
    }
  }

  // 3. Deduplicate overlapping same-color ranges to avoid double boxes.
  const uniqueColors: ColorInformation[] = [];
  const uniqueOffsets: Array<{
    start: number;
    end: number;
    color: Color;
  }> = [];

  for (const colorInfo of colors) {
    const start = document.offsetAt(colorInfo.range.start);
    const end = document.offsetAt(colorInfo.range.end);

    let isDuplicate = false;
    for (let i = 0; i < uniqueOffsets.length; i++) {
      const existing = uniqueOffsets[i];
      if (
        colorsEqual(existing.color, colorInfo.color) &&
        rangesOverlap(existing.start, existing.end, start, end)
      ) {
        const existingLen = existing.end - existing.start;
        const currentLen = end - start;
        if (currentLen < existingLen) {
          uniqueOffsets[i] = { start, end, color: colorInfo.color };
          uniqueColors[i] = colorInfo;
        }
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      uniqueOffsets.push({ start, end, color: colorInfo.color });
      uniqueColors.push(colorInfo);
    }
  }

  return uniqueColors;
}

function colorsEqual(a: Color, b: Color): boolean {
  return (
    a.red === b.red &&
    a.green === b.green &&
    a.blue === b.blue &&
    a.alpha === b.alpha
  );
}

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function collectColorPresentations(
  range: Range,
  color: Color,
  enabled: boolean
): ColorPresentation[] {
  if (!enabled) {
    return [];
  }

  const presentations: ColorPresentation[] = [];

  // 1. Hex format (most common)
  const hexStr = formatColorAsHex(color);
  presentations.push(
    ColorPresentation.create(hexStr, TextEdit.replace(range, hexStr))
  );

  // 2. RGB format
  const rgbStr = formatColorAsRgb(color);
  presentations.push(
    ColorPresentation.create(rgbStr, TextEdit.replace(range, rgbStr))
  );

  // 3. HSL format
  const hslStr = formatColorAsHsl(color);
  presentations.push(
    ColorPresentation.create(hslStr, TextEdit.replace(range, hslStr))
  );

  return presentations;
}
