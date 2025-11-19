"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CssVariableManager = void 0;
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const vscode_uri_1 = require("vscode-uri");
const glob_1 = require("glob");
const fs = require("fs");
const csstree = require("css-tree");
const domTree_1 = require("./domTree");
class CssVariableManager {
    constructor() {
        this.variables = new Map();
        this.usages = new Map();
        this.domTrees = new Map(); // URI -> DOM tree
    }
    /**
     * Scan all CSS and HTML files in the workspace
     */
    async scanWorkspace(workspaceFolders) {
        for (const folder of workspaceFolders) {
            const folderUri = vscode_uri_1.URI.parse(folder);
            const folderPath = folderUri.fsPath;
            // Find all CSS, SCSS, SASS, LESS and HTML files
            const files = await (0, glob_1.glob)('**/*.{css,scss,sass,less,html}', {
                cwd: folderPath,
                ignore: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/.git/**'],
                absolute: true
            });
            // Parse each file
            for (const filePath of files) {
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const fileUri = vscode_uri_1.URI.file(filePath).toString();
                    let languageId = 'css';
                    if (filePath.endsWith('.html')) {
                        languageId = 'html';
                    }
                    else if (filePath.endsWith('.scss')) {
                        languageId = 'scss';
                    }
                    else if (filePath.endsWith('.sass')) {
                        languageId = 'sass';
                    }
                    else if (filePath.endsWith('.less')) {
                        languageId = 'less';
                    }
                    this.parseContent(content, fileUri, languageId);
                }
                catch (error) {
                    console.error(`Error scanning file ${filePath}:`, error);
                }
            }
        }
    }
    parseDocument(document) {
        this.parseContent(document.getText(), document.uri, document.languageId);
    }
    parseContent(text, uri, languageId) {
        // Clear existing variables and usages for this document
        this.removeFile(uri);
        if (languageId === 'html') {
            // ... rest of the logic
            // Build DOM tree for HTML documents
            try {
                const domTree = new domTree_1.DOMTree(text);
                this.domTrees.set(uri, domTree);
            }
            catch (error) {
                console.error(`Error parsing HTML for ${uri}:`, error);
            }
            // Parse <style> blocks
            const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/g;
            let styleMatch;
            while ((styleMatch = styleRegex.exec(text)) !== null) {
                const styleContent = styleMatch[1];
                const styleStartOffset = styleMatch.index + styleMatch[0].indexOf(styleContent);
                // Create a dummy document for position matching if needed, or we need to refactor parseCssText to take direct text/uri
                // parseCssText uses 'document.positionAt' which requires a TextDocument object.
                // We should create a temporary TextDocument here.
                const document = vscode_languageserver_textdocument_1.TextDocument.create(uri, languageId, 1, text);
                this.parseCssText(styleContent, uri, document, styleStartOffset);
            }
            // Parse inline style attributes
            const inlineStyleRegex = /style\s*=\s*["']([^"']+)["']/g;
            let inlineMatch;
            while ((inlineMatch = inlineStyleRegex.exec(text)) !== null) {
                const styleContent = inlineMatch[1];
                const styleStartOffset = inlineMatch.index + inlineMatch[0].indexOf(styleContent);
                const document = vscode_languageserver_textdocument_1.TextDocument.create(uri, languageId, 1, text);
                this.parseInlineStyle(styleContent, uri, document, styleStartOffset, inlineMatch.index);
            }
        }
        else {
            // CSS, SCSS, SASS, LESS
            const document = vscode_languageserver_textdocument_1.TextDocument.create(uri, languageId, 1, text);
            this.parseCssText(text, uri, document, 0);
        }
    }
    parseCssText(text, uri, document, offset) {
        try {
            const ast = csstree.parse(text, {
                positions: true,
                onParseError: () => { } // Ignore errors to be tolerant
            });
            const selectorStack = [];
            csstree.walk(ast, {
                enter: (node) => {
                    if (node.type === 'Rule') {
                        let selector = '';
                        if (node.prelude && node.prelude.type === 'Raw') {
                            // Clean up raw selector if possible, or just take it
                            selector = node.prelude.value;
                        }
                        else {
                            selector = csstree.generate(node.prelude);
                        }
                        selectorStack.push(selector);
                    }
                    if (node.type === 'Declaration' && node.property.startsWith('--')) {
                        const name = node.property;
                        const value = csstree.generate(node.value).trim();
                        const important = node.important === true || node.important === 'important';
                        const selector = selectorStack.length > 0 ? selectorStack[selectorStack.length - 1] : ':root';
                        if (node.loc) {
                            const startPos = document.positionAt(offset + node.loc.start.offset);
                            const endPos = document.positionAt(offset + node.loc.end.offset);
                            const variable = {
                                name,
                                value,
                                uri,
                                range: node_1.Range.create(startPos, endPos),
                                selector,
                                important,
                                sourcePosition: offset + node.loc.start.offset
                            };
                            if (!this.variables.has(name)) {
                                this.variables.set(name, []);
                            }
                            this.variables.get(name)?.push(variable);
                        }
                    }
                    if (node.type === 'Function' && node.name === 'var') {
                        const children = node.children;
                        if (children && children.head) {
                            const firstChild = children.head.data;
                            // Handle var(--name) or var(--name, fallback)
                            // In csstree, --name is an Identifier
                            if (firstChild.type === 'Identifier' && firstChild.name.startsWith('--')) {
                                const name = firstChild.name;
                                const usageContext = selectorStack.length > 0 ? selectorStack[selectorStack.length - 1] : '';
                                if (node.loc) {
                                    const startPos = document.positionAt(offset + node.loc.start.offset);
                                    const endPos = document.positionAt(offset + node.loc.end.offset);
                                    const usage = {
                                        name,
                                        uri,
                                        range: node_1.Range.create(startPos, endPos),
                                        usageContext
                                    };
                                    if (!this.usages.has(name)) {
                                        this.usages.set(name, []);
                                    }
                                    this.usages.get(name)?.push(usage);
                                }
                            }
                        }
                    }
                },
                leave: (node) => {
                    if (node.type === 'Rule') {
                        selectorStack.pop();
                    }
                }
            });
        }
        catch (e) {
            console.error(`Error parsing CSS in ${uri}:`, e);
        }
    }
    /**
     * Parse inline style attributes for variable usages.
     * Inline styles don't have selectors, they apply directly to elements (highest specificity).
     */
    parseInlineStyle(text, uri, document, offset, attributeOffset) {
        try {
            const ast = csstree.parse(text, {
                context: 'declarationList',
                positions: true,
                onParseError: () => { }
            });
            csstree.walk(ast, {
                enter: (node) => {
                    if (node.type === 'Function' && node.name === 'var') {
                        const children = node.children;
                        if (children && children.head) {
                            const firstChild = children.head.data;
                            if (firstChild.type === 'Identifier' && firstChild.name.startsWith('--')) {
                                const name = firstChild.name;
                                if (node.loc) {
                                    const startPos = document.positionAt(offset + node.loc.start.offset);
                                    const endPos = document.positionAt(offset + node.loc.end.offset);
                                    // Try to find the DOM node for this inline style
                                    const domTree = this.domTrees.get(uri);
                                    // Use the attributeOffset (start of 'style="...') to find the correct DOM node
                                    const domNode = domTree?.findNodeAtPosition(attributeOffset);
                                    const usage = {
                                        name,
                                        uri,
                                        range: node_1.Range.create(startPos, endPos),
                                        usageContext: 'inline-style',
                                        domNode: domNode
                                    };
                                    if (!this.usages.has(name)) {
                                        this.usages.set(name, []);
                                    }
                                    this.usages.get(name)?.push(usage);
                                }
                            }
                        }
                    }
                }
            });
        }
        catch (e) {
            console.error(`Error parsing inline style in ${uri}:`, e);
        }
    }
    async updateFile(uri) {
        try {
            const filePath = vscode_uri_1.URI.parse(uri).fsPath;
            if (!fs.existsSync(filePath)) {
                this.removeFile(uri);
                return;
            }
            const stat = fs.statSync(filePath);
            if (!stat.isFile()) {
                return;
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            let languageId = 'css';
            if (filePath.endsWith('.html')) {
                languageId = 'html';
            }
            else if (filePath.endsWith('.scss')) {
                languageId = 'scss';
            }
            else if (filePath.endsWith('.sass')) {
                languageId = 'sass';
            }
            else if (filePath.endsWith('.less')) {
                languageId = 'less';
            }
            else if (!filePath.endsWith('.css')) {
                // Skip unsupported file types
                return;
            }
            this.parseContent(content, uri, languageId);
        }
        catch (error) {
            console.error(`Error updating file ${uri}:`, error);
        }
    }
    removeFile(uri) {
        this.clearDocumentVariables(uri);
        this.clearDocumentUsages(uri);
        this.clearDocumentDOMTree(uri);
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
    clearDocumentDOMTree(uri) {
        this.domTrees.delete(uri);
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
     * Get the DOM tree for a document (if it's HTML)
     */
    getDOMTree(uri) {
        return this.domTrees.get(uri);
    }
}
exports.CssVariableManager = CssVariableManager;
//# sourceMappingURL=cssVariableManager.js.map