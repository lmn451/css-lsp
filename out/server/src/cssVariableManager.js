"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CssVariableManager = void 0;
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const vscode_uri_1 = require("vscode-uri");
const glob_1 = require("glob");
const fs = require("fs");
class CssVariableManager {
    constructor() {
        this.variables = new Map();
        this.usages = new Map();
    }
    /**
     * Scan all CSS and HTML files in the workspace
     */
    async scanWorkspace(workspaceFolders) {
        for (const folder of workspaceFolders) {
            const folderUri = vscode_uri_1.URI.parse(folder);
            const folderPath = folderUri.fsPath;
            // Find all CSS and HTML files
            const files = await (0, glob_1.glob)('**/*.{css,html}', {
                cwd: folderPath,
                ignore: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/.git/**'],
                absolute: true
            });
            // Parse each file
            for (const filePath of files) {
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const fileUri = vscode_uri_1.URI.file(filePath).toString();
                    const languageId = filePath.endsWith('.html') ? 'html' : 'css';
                    // Create a TextDocument for parsing
                    const document = vscode_languageserver_textdocument_1.TextDocument.create(fileUri, languageId, 1, content);
                    this.parseDocument(document);
                }
                catch (error) {
                    console.error(`Error scanning file ${filePath}:`, error);
                }
            }
        }
    }
    parseDocument(document) {
        const text = document.getText();
        const uri = document.uri;
        // Clear existing variables and usages for this document
        this.clearDocumentVariables(uri);
        this.clearDocumentUsages(uri);
        if (document.languageId === 'html') {
            // Parse <style> blocks
            const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/g;
            let styleMatch;
            while ((styleMatch = styleRegex.exec(text)) !== null) {
                const styleContent = styleMatch[1];
                const styleStartOffset = styleMatch.index + styleMatch[0].indexOf(styleContent);
                this.parseCssText(styleContent, uri, document, styleStartOffset);
            }
            // Parse inline style attributes
            const inlineStyleRegex = /style\s*=\s*["']([^"']+)["']/g;
            let inlineMatch;
            while ((inlineMatch = inlineStyleRegex.exec(text)) !== null) {
                const styleContent = inlineMatch[1];
                const styleStartOffset = inlineMatch.index + inlineMatch[0].indexOf(styleContent);
                this.parseInlineStyle(styleContent, uri, document, styleStartOffset);
            }
        }
        else {
            this.parseCssText(text, uri, document, 0);
        }
    }
    parseCssText(text, uri, document, offset) {
        // Parse variable definitions with their selectors
        const defRegex = /(--[\w-]+)\s*:\s*([^;]+);/g;
        let match;
        while ((match = defRegex.exec(text)) !== null) {
            const name = match[1];
            let value = match[2].trim();
            // Check for !important
            const important = value.endsWith('!important');
            if (important) {
                value = value.replace(/\s*!important\s*$/, '').trim();
            }
            // Extract the selector for this variable definition
            const selector = this.extractSelectorAtPosition(text, match.index);
            const startPos = document.positionAt(offset + match.index);
            const endPos = document.positionAt(offset + match.index + match[0].length);
            const variable = {
                name,
                value,
                uri,
                range: node_1.Range.create(startPos, endPos),
                selector: selector,
                important: important,
                sourcePosition: offset + match.index
            };
            if (!this.variables.has(name)) {
                this.variables.set(name, []);
            }
            this.variables.get(name)?.push(variable);
        }
        // Parse variable usages: var(--variable-name) or var(--variable-name, fallback)
        const usageRegex = /var\((--[\w-]+)(?:\s*,\s*[^)]+)?\)/g;
        while ((match = usageRegex.exec(text)) !== null) {
            const name = match[1];
            const startPos = document.positionAt(offset + match.index);
            const endPos = document.positionAt(offset + match.index + match[0].length);
            // Extract the selector context for this usage
            const usageContext = this.extractSelectorAtPosition(text, match.index);
            const usage = {
                name,
                uri,
                range: node_1.Range.create(startPos, endPos),
                usageContext: usageContext
            };
            if (!this.usages.has(name)) {
                this.usages.set(name, []);
            }
            this.usages.get(name)?.push(usage);
        }
    }
    /**
     * Parse inline style attributes for variable usages.
     * Inline styles don't have selectors, they apply directly to elements (highest specificity).
     */
    parseInlineStyle(text, uri, document, offset) {
        // Parse variable usages: var(--variable-name)
        const usageRegex = /var\((--[\w-]+)(?:\s*,\s*[^)]+)?\)/g;
        let match;
        while ((match = usageRegex.exec(text)) !== null) {
            const name = match[1];
            const startPos = document.positionAt(offset + match.index);
            const endPos = document.positionAt(offset + match.index + match[0].length);
            const usage = {
                name,
                uri,
                range: node_1.Range.create(startPos, endPos),
                usageContext: 'inline-style' // Special marker for inline styles
            };
            if (!this.usages.has(name)) {
                this.usages.set(name, []);
            }
            this.usages.get(name)?.push(usage);
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
    clearDocumentUsages(uri) {
        for (const [name, usgs] of this.usages.entries()) {
            const filtered = usgs.filter(u => u.uri !== uri);
            if (filtered.length === 0) {
                this.usages.delete(name);
            }
            else {
                this.usages.set(name, filtered);
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
    getVariableUsages(name) {
        return this.usages.get(name) || [];
    }
    /**
     * Get all references (definitions + usages) for a variable
     */
    getReferences(name) {
        const definitions = this.getVariables(name);
        const usages = this.getVariableUsages(name);
        return [...definitions, ...usages];
    }
    /**
     * Get all variable definitions across the workspace (for workspace symbols)
     */
    getAllDefinitions() {
        return this.getAllVariables();
    }
    /**
     * Get all variable definitions in a specific document (for document symbols)
     */
    getDocumentDefinitions(uri) {
        const allVars = this.getAllVariables();
        return allVars.filter(v => v.uri === uri);
    }
    /**
     * Extract the CSS selector at a given position in the text.
     * This finds the selector of the CSS rule containing the position.
     *
     * Example: For ":root { --color: red; }", returns ":root"
     */
    extractSelectorAtPosition(text, position) {
        // Find the opening brace before this position
        let bracePos = text.lastIndexOf('{', position);
        if (bracePos === -1) {
            return ''; // No selector found
        }
        // Find the start of the selector (after previous closing brace or start of text)
        let prevCloseBrace = text.lastIndexOf('}', bracePos);
        let selectorStart = prevCloseBrace === -1 ? 0 : prevCloseBrace + 1;
        // Extract and clean the selector
        let selector = text.substring(selectorStart, bracePos).trim();
        // Remove CSS at-rules (@media, @keyframes, etc.) - keep searching backwards
        if (selector.startsWith('@')) {
            // Try to find the actual selector inside the at-rule
            const nestedBrace = text.lastIndexOf('{', bracePos - 1);
            if (nestedBrace > selectorStart) {
                const nestedPrevBrace = text.lastIndexOf('}', nestedBrace);
                const nestedStart = nestedPrevBrace === -1 ? prevCloseBrace + 1 : nestedPrevBrace + 1;
                selector = text.substring(nestedStart, nestedBrace).trim();
                // If still an at-rule, default to empty
                if (selector.startsWith('@')) {
                    selector = '';
                }
            }
        }
        // Clean up comments
        selector = selector.replace(/\/\*.*?\*\//g, '').trim();
        // For multiple selectors (comma-separated), take the first one
        if (selector.includes(',')) {
            selector = selector.split(',')[0].trim();
        }
        return selector || '';
    }
}
exports.CssVariableManager = CssVariableManager;
//# sourceMappingURL=cssVariableManager.js.map