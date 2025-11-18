"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CssVariableManager = void 0;
const node_1 = require("vscode-languageserver/node");
class CssVariableManager {
    constructor() {
        this.variables = new Map();
    }
    parseDocument(document) {
        const text = document.getText();
        const uri = document.uri;
        // Clear existing variables for this document
        this.clearDocumentVariables(uri);
        if (document.languageId === 'html') {
            const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/g;
            let styleMatch;
            while ((styleMatch = styleRegex.exec(text)) !== null) {
                const styleContent = styleMatch[1];
                const styleStartOffset = styleMatch.index + styleMatch[0].indexOf(styleContent);
                this.parseCssText(styleContent, uri, document, styleStartOffset);
            }
        }
        else {
            this.parseCssText(text, uri, document, 0);
        }
    }
    parseCssText(text, uri, document, offset) {
        const regex = /(--[\w-]+)\s*:\s*([^;]+);/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const name = match[1];
            const value = match[2].trim();
            const startPos = document.positionAt(offset + match.index);
            const endPos = document.positionAt(offset + match.index + match[0].length);
            const variable = {
                name,
                value,
                uri,
                range: node_1.Range.create(startPos, endPos)
            };
            if (!this.variables.has(name)) {
                this.variables.set(name, []);
            }
            this.variables.get(name)?.push(variable);
        }
    }
    clearDocumentVariables(uri) {
        for (const [name, vars] of this.variables.entries()) {
            const filtered = vars.filter(v => v.uri !== uri);
            if (filtered.length === 0) {
                this.variables.delete(name);
            }
            else {
                this.variables.set(name, filtered);
            }
        }
    }
    getAllVariables() {
        const allVars = [];
        for (const vars of this.variables.values()) {
            allVars.push(...vars);
        }
        return allVars;
    }
    getVariables(name) {
        return this.variables.get(name) || [];
    }
}
exports.CssVariableManager = CssVariableManager;
//# sourceMappingURL=cssVariableManager.js.map