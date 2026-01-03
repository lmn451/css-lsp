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
const node_html_parser_1 = require("node-html-parser");
const colorService_1 = require("./colorService");
const specificity_1 = require("./specificity");
const path = require("path");
const DEFAULT_LOOKUP_FILES = [
    "**/*.css",
    "**/*.scss",
    "**/*.sass",
    "**/*.less",
    "**/*.html",
    "**/*.vue",
    "**/*.svelte",
    "**/*.astro",
    "**/*.ripple",
];
const DEFAULT_IGNORE_GLOBS = [
    "**/node_modules/**",
    "**/dist/**",
    "**/out/**",
    "**/.git/**",
];
const EXTENSION_LANGUAGE_MAP = new Map([
    [".css", "css"],
    [".scss", "scss"],
    [".sass", "sass"],
    [".less", "less"],
    [".html", "html"],
    [".vue", "html"],
    [".svelte", "html"],
    [".astro", "html"],
    [".ripple", "html"],
]);
function extractExtensions(pattern) {
    const braceMatch = pattern.match(/\{([^}]+)\}/);
    if (braceMatch) {
        return braceMatch[1]
            .split(",")
            .map((ext) => ext.trim())
            .filter(Boolean)
            .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`));
    }
    const ext = path.extname(pattern);
    return ext ? [ext] : [];
}
class CssVariableManager {
    variables = new Map();
    usages = new Map();
    domTrees = new Map(); // URI -> DOM tree
    logger;
    lookupFiles;
    ignoreGlobs;
    lookupExtensions;
    constructor(logger, lookupFiles) {
        this.logger = logger || {
            log: (message) => {
                // Only log to console in debug mode
                if (process.env.CSS_LSP_DEBUG) {
                    console.log(message);
                }
            },
            error: (message) => {
                // Always log errors
                console.error(message);
            },
        };
        this.lookupFiles =
            lookupFiles && lookupFiles.length > 0 ? lookupFiles : DEFAULT_LOOKUP_FILES;
        this.ignoreGlobs = DEFAULT_IGNORE_GLOBS;
        this.lookupExtensions = this.buildLookupExtensions(this.lookupFiles);
    }
    buildLookupExtensions(lookupFiles) {
        const extensions = new Map();
        for (const pattern of lookupFiles) {
            for (const ext of extractExtensions(pattern)) {
                const languageId = EXTENSION_LANGUAGE_MAP.get(ext) ?? "css";
                extensions.set(ext, languageId);
            }
        }
        return extensions;
    }
    resolveLanguageId(filePath) {
        const ext = path.extname(filePath);
        if (!ext) {
            return null;
        }
        return this.lookupExtensions.get(ext) ?? null;
    }
    /**
     * Scan all CSS and HTML files in the workspace
     * @param workspaceFolders Array of workspace folder URIs
     * @param onProgress Optional callback for progress updates (current, total)
     */
    async scanWorkspace(workspaceFolders, onProgress) {
        // First, collect all files from all folders
        const allFiles = [];
        for (const folder of workspaceFolders) {
            const folderUri = vscode_uri_1.URI.parse(folder);
            const folderPath = folderUri.fsPath;
            // Find all CSS and HTML-like files based on lookup globs
            const files = await (0, glob_1.glob)(this.lookupFiles, {
                cwd: folderPath,
                ignore: this.ignoreGlobs,
                absolute: true,
            });
            this.logger.log(`[css-lsp] Scanned ${folder}: found ${files.length} files`);
            allFiles.push(...files);
        }
        const totalFiles = allFiles.length;
        let processedFiles = 0;
        // Parse each file with progress reporting
        for (const filePath of allFiles) {
            try {
                const content = fs.readFileSync(filePath, "utf-8");
                const fileUri = vscode_uri_1.URI.file(filePath).toString();
                const languageId = this.resolveLanguageId(filePath);
                if (!languageId) {
                    continue;
                }
                this.parseContent(content, fileUri, languageId);
            }
            catch (error) {
                this.logger.error(`[css-lsp] Error scanning file ${filePath}: ${error}`);
            }
            processedFiles++;
            // Report progress every 10 files or at the end
            if (onProgress &&
                (processedFiles % 10 === 0 || processedFiles === totalFiles)) {
                onProgress(processedFiles, totalFiles);
            }
        }
        this.logger.log(`[css-lsp] Workspace scan complete. Processed ${totalFiles} files.`);
    }
    parseDocument(document) {
        this.parseContent(document.getText(), document.uri, document.languageId);
    }
    parseContent(text, uri, languageId) {
        // Clear existing variables and usages for this document
        this.removeFile(uri);
        if (languageId === "html") {
            // Build DOM tree for HTML documents
            try {
                const domTree = new domTree_1.DOMTree(text);
                this.domTrees.set(uri, domTree);
            }
            catch (error) {
                this.logger.error(`Error parsing HTML for ${uri}: ${error}`);
            }
            // Use node-html-parser to extract style blocks and inline styles
            try {
                const root = (0, node_html_parser_1.parse)(text, {
                    lowerCaseTagName: true,
                    comment: false, // Automatically ignores comments
                    blockTextElements: {
                        script: true,
                        noscript: true,
                        style: true, // Keep style as block text so we can extract content
                    },
                });
                const document = vscode_languageserver_textdocument_1.TextDocument.create(uri, languageId, 1, text);
                // Parse <style> blocks
                const styleElements = root.querySelectorAll("style");
                for (const styleEl of styleElements) {
                    const styleContent = styleEl.textContent;
                    if (styleContent && styleEl.range) {
                        // Calculate the offset where the CSS content starts
                        // styleEl.range gives us the full element from '<style>' to '</style>'
                        // We need to find where the content starts (after the opening tag)
                        const elementText = text.substring(styleEl.range[0], styleEl.range[1]);
                        const openingTagEnd = elementText.indexOf(">") + 1;
                        const styleStartOffset = styleEl.range[0] + openingTagEnd;
                        this.parseCssText(styleContent, uri, document, styleStartOffset);
                    }
                }
                // Parse inline style attributes
                const elementsWithStyle = root.querySelectorAll("[style]");
                for (const el of elementsWithStyle) {
                    const styleAttr = el.getAttribute("style");
                    if (styleAttr && el.range) {
                        // Find the position of the style attribute value in the original text
                        const elementText = text.substring(el.range[0], el.range[1]);
                        const styleAttrStart = elementText.indexOf("style");
                        if (styleAttrStart !== -1) {
                            // Find where the attribute value starts (after the opening quote)
                            const valueStart = elementText.indexOf(styleAttr, styleAttrStart);
                            if (valueStart !== -1) {
                                const styleStartOffset = el.range[0] + valueStart;
                                const attributeOffset = el.range[0] + styleAttrStart;
                                this.parseInlineStyle(styleAttr, uri, document, styleStartOffset, attributeOffset);
                            }
                        }
                    }
                }
            }
            catch (error) {
                this.logger.error(`Error parsing HTML content for ${uri}: ${error}`);
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
                onParseError: (error) => {
                    this.logger.log(`[css-lsp] CSS Parse Error in ${uri}: ${error.message}`);
                },
            });
            const selectorStack = [];
            csstree.walk(ast, {
                enter: (node) => {
                    if (node.type === "Rule") {
                        let selector = "";
                        if (node.prelude && node.prelude.type === "Raw") {
                            // Clean up raw selector if possible, or just take it
                            selector = node.prelude.value;
                        }
                        else if (node.prelude) {
                            selector = csstree.generate(node.prelude);
                        }
                        selectorStack.push(selector);
                    }
                    if (node.type === "Declaration" && node.property.startsWith("--")) {
                        const name = node.property;
                        const value = csstree.generate(node.value).trim();
                        const important = node.important === true || node.important === "important";
                        const selector = selectorStack.length > 0
                            ? selectorStack[selectorStack.length - 1]
                            : ":root";
                        if (node.loc) {
                            const startPos = document.positionAt(offset + node.loc.start.offset);
                            const endPos = document.positionAt(offset + node.loc.end.offset);
                            // Capture valueRange from node.value location
                            let valueRange;
                            if (node.value && node.value.loc) {
                                // Get the raw text from the value node
                                const valueStartOffset = offset + node.value.loc.start.offset;
                                const valueEndOffset = offset + node.value.loc.end.offset;
                                const rawValueText = text.substring(valueStartOffset, valueEndOffset);
                                // Trim leading/trailing whitespace to get the actual value position
                                const leadingWhitespace = rawValueText.length - rawValueText.trimStart().length;
                                const trailingWhitespace = rawValueText.length - rawValueText.trimEnd().length;
                                const valueStartPos = document.positionAt(valueStartOffset + leadingWhitespace);
                                const valueEndPos = document.positionAt(valueEndOffset - trailingWhitespace);
                                valueRange = node_1.Range.create(valueStartPos, valueEndPos);
                            }
                            const variable = {
                                name,
                                value,
                                uri,
                                range: node_1.Range.create(startPos, endPos),
                                valueRange,
                                selector,
                                important,
                                sourcePosition: offset + node.loc.start.offset,
                            };
                            if (!this.variables.has(name)) {
                                this.variables.set(name, []);
                            }
                            this.variables.get(name)?.push(variable);
                        }
                    }
                    if (node.type === "Function" && node.name === "var") {
                        const children = node.children;
                        if (children && children.first) {
                            const firstChild = children.first;
                            // Handle var(--name) or var(--name, fallback)
                            // In csstree, --name is an Identifier
                            if (firstChild.type === "Identifier" &&
                                firstChild.name.startsWith("--")) {
                                const name = firstChild.name;
                                const usageContext = selectorStack.length > 0
                                    ? selectorStack[selectorStack.length - 1]
                                    : "";
                                if (node.loc) {
                                    const startPos = document.positionAt(offset + node.loc.start.offset);
                                    const endPos = document.positionAt(offset + node.loc.end.offset);
                                    const usage = {
                                        name,
                                        uri,
                                        range: node_1.Range.create(startPos, endPos),
                                        usageContext,
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
                    if (node.type === "Rule") {
                        selectorStack.pop();
                    }
                },
            });
        }
        catch (e) {
            this.logger.error(`Error parsing CSS in ${uri}: ${e}`);
        }
    }
    /**
     * Parse inline style attributes for variable usages.
     * Inline styles don't have selectors, they apply directly to elements (highest specificity).
     */
    parseInlineStyle(text, uri, document, offset, attributeOffset) {
        try {
            const ast = csstree.parse(text, {
                context: "declarationList",
                positions: true,
                onParseError: (error) => {
                    this.logger.log(`[css-lsp] Inline Style Parse Error in ${uri}: ${error.message}`);
                },
            });
            csstree.walk(ast, {
                enter: (node) => {
                    if (node.type === "Function" && node.name === "var") {
                        const children = node.children;
                        if (children && children.first) {
                            const firstChild = children.first;
                            if (firstChild.type === "Identifier" &&
                                firstChild.name.startsWith("--")) {
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
                                        usageContext: "inline-style",
                                        domNode: domNode,
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
            });
        }
        catch (e) {
            this.logger.error(`Error parsing inline style in ${uri}: ${e}`);
        }
    }
    async updateFile(uri) {
        try {
            const filePath = vscode_uri_1.URI.parse(uri).fsPath;
            if (!fs.existsSync(filePath)) {
                this.logger.log(`[css-lsp] File ${uri} does not exist on disk, removing from manager.`);
                this.removeFile(uri);
                return;
            }
            const stat = fs.statSync(filePath);
            if (!stat.isFile()) {
                return;
            }
            const content = fs.readFileSync(filePath, "utf-8");
            const languageId = this.resolveLanguageId(filePath);
            if (!languageId) {
                // Skip unsupported file types
                return;
            }
            this.parseContent(content, uri, languageId);
            this.logger.log(`[css-lsp] Updated file ${uri} from disk.`);
        }
        catch (error) {
            this.logger.error(`[css-lsp] Error updating file ${uri}: ${error}`);
        }
    }
    removeFile(uri) {
        this.clearDocumentVariables(uri);
        this.clearDocumentUsages(uri);
        this.clearDocumentDOMTree(uri);
    }
    clearDocumentVariables(uri) {
        for (const [name, vars] of this.variables.entries()) {
            const filtered = vars.filter((v) => v.uri !== uri);
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
            const filtered = usgs.filter((u) => u.uri !== uri);
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
        return allVars.filter((v) => v.uri === uri);
    }
    /**
     * Get the DOM tree for a document (if it's HTML)
     */
    getDOMTree(uri) {
        return this.domTrees.get(uri);
    }
    /**
     * Resolve a variable name to a Color if possible.
     * Handles recursive variable references: var(--a) -> var(--b) -> #fff
     * Uses CSS cascade rules: !important > specificity > source order
     */
    resolveVariableColor(name, context, seen = new Set()) {
        if (seen.has(name)) {
            return null; // Cycle detected
        }
        seen.add(name);
        const variables = this.getVariables(name);
        if (variables.length === 0) {
            return null;
        }
        // Apply CSS cascade rules to find the winning definition
        // Sort by cascade rules: !important > specificity > source order
        const sortedVars = [...variables].sort((a, b) => {
            // !important always wins (unless both are !important)
            if (a.important !== b.important) {
                return a.important ? -1 : 1;
            }
            // After !important, check specificity
            const specA = (0, specificity_1.calculateSpecificity)(a.selector);
            const specB = (0, specificity_1.calculateSpecificity)(b.selector);
            const specCompare = (0, specificity_1.compareSpecificity)(specA, specB);
            if (specCompare !== 0) {
                return -specCompare; // Negative for descending order
            }
            // Equal specificity - later in source wins
            return b.sourcePosition - a.sourcePosition;
        });
        // Use the winning definition (first after sort)
        const variable = sortedVars[0];
        let value = variable.value;
        // Check if it's a reference to another variable
        const match = value.match(/^var\((--[\w-]+)\)$/);
        if (match) {
            return this.resolveVariableColor(match[1], context, seen);
        }
        return (0, colorService_1.parseColor)(value);
    }
}
exports.CssVariableManager = CssVariableManager;
//# sourceMappingURL=cssVariableManager.js.map