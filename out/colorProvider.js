"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectDocumentColors = collectDocumentColors;
exports.collectColorPresentations = collectColorPresentations;
const node_1 = require("vscode-languageserver/node");
const colorService_1 = require("./colorService");
function collectDocumentColors(document, cssVariableManager, options) {
    if (!options.enabled) {
        return [];
    }
    const colors = [];
    const text = document.getText();
    // 1. Check variable definitions: --my-color: #f00;
    // Only show color boxes on definitions if onlyVariables is false
    if (!options.onlyVariables) {
        const definitions = cssVariableManager.getDocumentDefinitions(document.uri);
        for (const def of definitions) {
            const color = (0, colorService_1.parseColor)(def.value);
            if (color) {
                // Use the stored valueRange if available (accurate from csstree parsing)
                if (def.valueRange) {
                    colors.push({
                        range: def.valueRange,
                        color: color,
                    });
                }
                else {
                    // Fallback: find the value within the declaration text
                    const defText = text.substring(document.offsetAt(def.range.start), document.offsetAt(def.range.end));
                    const colonIndex = defText.indexOf(":");
                    if (colonIndex !== -1) {
                        const afterColon = defText.substring(colonIndex + 1);
                        const valueIndex = afterColon.indexOf(def.value.trim());
                        if (valueIndex !== -1) {
                            const absoluteValueStart = document.offsetAt(def.range.start) +
                                colonIndex +
                                1 +
                                valueIndex;
                            const start = document.positionAt(absoluteValueStart);
                            const end = document.positionAt(absoluteValueStart + def.value.trim().length);
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
    const regex = /var\((--[\w-]+)\)/g;
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
    return colors;
}
function collectColorPresentations(range, color, enabled) {
    if (!enabled) {
        return [];
    }
    const presentations = [];
    // 1. Hex format (most common)
    const hexStr = (0, colorService_1.formatColorAsHex)(color);
    presentations.push(node_1.ColorPresentation.create(hexStr, node_1.TextEdit.replace(range, hexStr)));
    // 2. RGB format
    const rgbStr = (0, colorService_1.formatColorAsRgb)(color);
    presentations.push(node_1.ColorPresentation.create(rgbStr, node_1.TextEdit.replace(range, rgbStr)));
    // 3. HSL format
    const hslStr = (0, colorService_1.formatColorAsHsl)(color);
    presentations.push(node_1.ColorPresentation.create(hslStr, node_1.TextEdit.replace(range, hslStr)));
    return presentations;
}
//# sourceMappingURL=colorProvider.js.map