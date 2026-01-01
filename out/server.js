#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_1 = require("vscode-languageserver/node");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const cssVariableManager_1 = require("./cssVariableManager");
const specificity_1 = require("./specificity");
const colorService_1 = require("./colorService");
// Parse command-line arguments
const args = process.argv.slice(2);
const ENABLE_COLOR_PROVIDER = !args.includes('--no-color-preview');
const COLOR_ONLY_ON_VARIABLES = args.includes('--color-only-variables') || process.env.CSS_LSP_COLOR_ONLY_VARIABLES === '1';
// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
function logDebug(label, payload) {
    // Only log in debug mode (set CSS_LSP_DEBUG=1 environment variable)
    if (process.env.CSS_LSP_DEBUG) {
        const message = `[css-lsp] ${label} ${JSON.stringify(payload)}`;
        connection.console.log(message);
    }
}
// Create a simple text document manager.
const documents = new node_1.TextDocuments(vscode_languageserver_textdocument_1.TextDocument);
const cssVariableManager = new cssVariableManager_1.CssVariableManager(connection.console);
let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;
connection.onInitialize((params) => {
    logDebug('initialize', {
        rootUri: params.rootUri,
        // rootPath is deprecated and optional in InitializeParams
        rootPath: params.rootPath,
        workspaceFolders: params.workspaceFolders,
        capabilities: params.capabilities,
    });
    const capabilities = params.capabilities;
    // Does the client support the `workspace/configuration` request?
    // If not, we fall back using global settings.
    hasConfigurationCapability = !!(capabilities.workspace && !!capabilities.workspace.configuration);
    hasWorkspaceFolderCapability = !!(capabilities.workspace && !!capabilities.workspace.workspaceFolders);
    hasDiagnosticRelatedInformationCapability = !!(capabilities.textDocument &&
        capabilities.textDocument.publishDiagnostics &&
        capabilities.textDocument.publishDiagnostics.relatedInformation);
    const result = {
        capabilities: {
            textDocumentSync: node_1.TextDocumentSyncKind.Incremental,
            // Tell the client that this server supports code completion.
            completionProvider: {
                resolveProvider: true,
                triggerCharacters: ['-']
            },
            definitionProvider: true,
            hoverProvider: true,
            referencesProvider: true,
            renameProvider: true,
            documentSymbolProvider: true,
            workspaceSymbolProvider: true,
            colorProvider: ENABLE_COLOR_PROVIDER
        }
    };
    if (hasWorkspaceFolderCapability) {
        result.capabilities.workspace = {
            workspaceFolders: {
                supported: true
            }
        };
    }
    return result;
});
connection.onInitialized(async () => {
    if (hasConfigurationCapability) {
        // Register for all configuration changes.
        connection.client.register(node_1.DidChangeConfigurationNotification.type, undefined);
    }
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders(_event => {
            connection.console.log('Workspace folder change event received.');
        });
    }
    // Scan workspace for CSS variables on initialization with progress reporting
    const workspaceFolders = await connection.workspace.getWorkspaceFolders();
    if (workspaceFolders) {
        connection.console.log('Scanning workspace for CSS variables...');
        const folderUris = workspaceFolders.map(f => f.uri);
        // Scan with progress callback that logs to console
        let lastLoggedPercentage = 0;
        await cssVariableManager.scanWorkspace(folderUris, (current, total) => {
            const percentage = Math.round((current / total) * 100);
            // Log progress every 20% to avoid spam
            if (percentage - lastLoggedPercentage >= 20 || current === total) {
                connection.console.log(`Scanning CSS files: ${current}/${total} (${percentage}%)`);
                lastLoggedPercentage = percentage;
            }
        });
        const totalVars = cssVariableManager.getAllVariables().length;
        connection.console.log(`Workspace scan complete. Found ${totalVars} CSS variables.`);
        // Validate all open documents after workspace scan
        documents.all().forEach(validateTextDocument);
    }
});
const defaultSettings = { maxNumberOfProblems: 1000 };
let globalSettings = defaultSettings;
// Cache the settings of all open documents
const documentSettings = new Map();
connection.onDidChangeConfiguration(change => {
    if (hasConfigurationCapability) {
        // Reset all cached document settings
        documentSettings.clear();
    }
    else {
        globalSettings = ((change.settings.cssVariableLsp || defaultSettings));
    }
    // Revalidate all open text documents
    documents.all().forEach(validateTextDocument);
});
function getDocumentSettings(resource) {
    if (!hasConfigurationCapability) {
        return Promise.resolve(globalSettings);
    }
    let result = documentSettings.get(resource);
    if (!result) {
        result = connection.workspace.getConfiguration({
            scopeUri: resource,
            section: 'cssVariableLsp'
        });
        documentSettings.set(resource, result);
    }
    return result;
}
// Only keep settings for open documents
documents.onDidClose(async (e) => {
    connection.console.log(`[css-lsp] Document closed: ${e.document.uri}`);
    documentSettings.delete(e.document.uri);
    // When a document is closed, we need to revert to the file system version
    // instead of removing it completely (which would break workspace files).
    // This handles cases where the editor had unsaved changes.
    await cssVariableManager.updateFile(e.document.uri);
});
// Debounce map for validation (per document URI)
const validationTimeouts = new Map();
// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
// Note: We don't need a separate onDidOpen handler because onDidChangeContent
// already fires when a document is first opened, avoiding double-parsing.
documents.onDidChangeContent(change => {
    // Parse immediately (needed for completion/hover)
    cssVariableManager.parseDocument(change.document);
    // Debounce validation to avoid excessive diagnostic updates while typing
    const uri = change.document.uri;
    // Clear existing timeout for this document
    const existingTimeout = validationTimeouts.get(uri);
    if (existingTimeout) {
        clearTimeout(existingTimeout);
    }
    // Schedule validation after 300ms of inactivity
    const timeout = setTimeout(() => {
        validateTextDocument(change.document);
        validationTimeouts.delete(uri);
    }, 300);
    validationTimeouts.set(uri, timeout);
});
async function validateTextDocument(textDocument) {
    const settings = await getDocumentSettings(textDocument.uri);
    const text = textDocument.getText();
    const diagnostics = [];
    // Find all var(--variable) usages
    const usageRegex = /var\((--[\w-]+)(?:\s*,\s*[^)]+)?\)/g;
    let match;
    while ((match = usageRegex.exec(text)) !== null) {
        const variableName = match[1];
        const definitions = cssVariableManager.getVariables(variableName);
        if (definitions.length === 0) {
            // Variable is used but not defined
            const startPos = textDocument.positionAt(match.index);
            const endPos = textDocument.positionAt(match.index + match[0].length);
            const diagnostic = {
                severity: node_1.DiagnosticSeverity.Warning,
                range: {
                    start: startPos,
                    end: endPos
                },
                message: `CSS variable '${variableName}' is not defined in the workspace`,
                source: 'css-variable-lsp'
            };
            if (hasDiagnosticRelatedInformationCapability) {
                diagnostic.relatedInformation = [];
            }
            diagnostics.push(diagnostic);
        }
    }
    // Send diagnostics to the client
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}
connection.onDidChangeWatchedFiles(async (change) => {
    // Monitored files have changed in the client
    connection.console.log('Received file change event');
    logDebug('didChangeWatchedFiles', change);
    for (const fileEvent of change.changes) {
        if (fileEvent.type === node_1.FileChangeType.Deleted) {
            cssVariableManager.removeFile(fileEvent.uri);
        }
        else {
            // Created or Changed
            // If the document is open, we skip because onDidChangeContent handles it.
            if (!documents.get(fileEvent.uri)) {
                await cssVariableManager.updateFile(fileEvent.uri);
            }
        }
    }
    // Revalidate all open documents
    documents.all().forEach(validateTextDocument);
});
/**
 * Check if the cursor position is in a context where CSS variable completion is relevant.
 * Returns true if we're in a CSS property value or inside var().
 */
function isInCssValueContext(document, position) {
    const text = document.getText();
    const offset = document.offsetAt(position);
    // Get text before cursor (up to 200 chars to analyze context)
    const beforeCursor = text.slice(Math.max(0, offset - 200), offset);
    // Check if we're inside var( ) - most relevant context
    const varMatch = beforeCursor.match(/var\(\s*(--[\w-]*)$/);
    if (varMatch) {
        return true;
    }
    // Check if we're in a CSS property value position
    // Look for patterns like "property: |" or "property: value |"
    // We need to find the last : that isn't inside a {} block or ()
    let inBraces = 0;
    let inParens = 0;
    let lastColonPos = -1;
    let lastSemicolonPos = -1;
    let lastBracePos = -1;
    for (let i = beforeCursor.length - 1; i >= 0; i--) {
        const char = beforeCursor[i];
        // Track nesting (scanning backwards)
        if (char === ')')
            inParens++;
        else if (char === '(') {
            inParens--;
            if (inParens < 0)
                break; // We've left the current context
        }
        else if (char === '}')
            inBraces++;
        else if (char === '{') {
            inBraces--;
            if (inBraces < 0) {
                lastBracePos = i;
                break; // Found the opening brace of our block
            }
        }
        else if (char === ':' && inParens === 0 && inBraces === 0 && lastColonPos === -1) {
            lastColonPos = i;
        }
        else if (char === ';' && inParens === 0 && inBraces === 0 && lastSemicolonPos === -1) {
            lastSemicolonPos = i;
        }
    }
    // If we found a colon after the last semicolon or opening brace, we're in a value
    if (lastColonPos > lastSemicolonPos && lastColonPos > lastBracePos) {
        // Make sure there's a property name before the colon
        const beforeColon = beforeCursor.slice(0, lastColonPos).trim();
        const propertyMatch = beforeColon.match(/[\w-]+$/);
        if (propertyMatch) {
            return true;
        }
    }
    // Check for HTML style attribute: style="property: |"
    const styleAttrMatch = beforeCursor.match(/style\s*=\s*["'][^"']*:\s*[^"';]*$/i);
    if (styleAttrMatch) {
        return true;
    }
    return false;
}
// This handler provides the initial list of the completion items.
connection.onCompletion((textDocumentPosition) => {
    const document = documents.get(textDocumentPosition.textDocument.uri);
    if (!document) {
        return [];
    }
    // Only show CSS variable completions in relevant contexts
    if (!isInCssValueContext(document, textDocumentPosition.position)) {
        return [];
    }
    const variables = cssVariableManager.getAllVariables();
    // Deduplicate by name
    const uniqueVars = new Map();
    variables.forEach(v => {
        if (!uniqueVars.has(v.name)) {
            uniqueVars.set(v.name, v);
        }
    });
    return Array.from(uniqueVars.values()).map(v => ({
        label: v.name,
        kind: node_1.CompletionItemKind.Variable,
        detail: v.value,
        documentation: `Defined in ${v.uri}`
    }));
});
// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item) => {
    return item;
});
connection.onHover((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return undefined;
    }
    const text = document.getText();
    const offset = document.offsetAt(params.position);
    // Simple regex to find the word at the cursor
    // We look backwards and forwards for valid variable characters
    const left = text.slice(0, offset).match(/[\w-]*$/);
    const right = text.slice(offset).match(/^[\w-]*/);
    if (!left || !right) {
        return undefined;
    }
    const word = left[0] + right[0];
    if (word.startsWith('--')) {
        const variables = cssVariableManager.getVariables(word);
        if (variables.length === 0) {
            return undefined;
        }
        // Get all usages to find context if hovering over a usage
        const usages = cssVariableManager.getVariableUsages(word);
        const hoverUsage = usages.find(u => document.positionAt(document.offsetAt(u.range.start)) === params.position ||
            (offset >= document.offsetAt(u.range.start) && offset <= document.offsetAt(u.range.end)));
        const usageContext = hoverUsage?.usageContext || '';
        const isInlineStyle = usageContext === 'inline-style';
        // Get DOM tree and node if available (for HTML documents)
        const domTree = cssVariableManager.getDOMTree(document.uri);
        const domNode = hoverUsage?.domNode;
        // Sort variables by CSS cascade rules:
        // 1. !important declarations win
        // 2. Inline styles beat everything (except !important)
        // 3. Then by specificity
        // 4. Then by source order (later wins)
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
        // Build hover message with full cascade information
        let hoverText = `### CSS Variable: \`${word}\`\n\n`;
        if (sortedVars.length === 1) {
            // Single definition - simple display
            const v = sortedVars[0];
            hoverText += `**Value:** \`${v.value}\``;
            if (v.important) {
                hoverText += ` **!important**`;
            }
            hoverText += `\n\n`;
            if (v.selector) {
                hoverText += `**Defined in:** \`${v.selector}\`\n`;
                hoverText += `**Specificity:** ${(0, specificity_1.formatSpecificity)((0, specificity_1.calculateSpecificity)(v.selector))}\n`;
            }
        }
        else {
            // Multiple definitions - show full cascade
            hoverText += '**Definitions** (CSS cascade order):\n\n';
            sortedVars.forEach((v, index) => {
                const spec = (0, specificity_1.calculateSpecificity)(v.selector);
                // Use DOM-aware matching if available, otherwise fall back to simple matching
                const isApplicable = usageContext ?
                    (0, specificity_1.matchesContext)(v.selector, usageContext, domTree, domNode) : true;
                const isWinner = index === 0 && (isApplicable || isInlineStyle);
                let line = `${index + 1}. \`${v.value}\``;
                if (v.important) {
                    line += ` **!important**`;
                }
                if (v.selector) {
                    line += ` from \`${v.selector}\``;
                    line += ` ${(0, specificity_1.formatSpecificity)(spec)}`;
                }
                if (isWinner && usageContext) {
                    if (v.important) {
                        line += ' ✓ **Wins (!important)**';
                    }
                    else if (isInlineStyle) {
                        line += ' ✓ **Would apply (inline style)**';
                    }
                    else if (domTree && domNode) {
                        line += ' ✓ **Applies (DOM match)**';
                    }
                    else {
                        line += ' ✓ **Applies here**';
                    }
                }
                else if (!isApplicable && usageContext && !isInlineStyle) {
                    line += ' _(selector doesn\'t match)_';
                }
                else if (index > 0 && usageContext) {
                    // Explain why it doesn't win
                    const winner = sortedVars[0];
                    if (winner.important && !v.important) {
                        line += ' _(overridden by !important)_';
                    }
                    else {
                        const winnerSpec = (0, specificity_1.calculateSpecificity)(winner.selector);
                        const cmp = (0, specificity_1.compareSpecificity)(winnerSpec, spec);
                        if (cmp > 0) {
                            line += ' _(lower specificity)_';
                        }
                        else if (cmp === 0) {
                            line += ' _(earlier in source)_';
                        }
                    }
                }
                hoverText += line + '\n';
            });
            if (usageContext) {
                if (isInlineStyle) {
                    hoverText += `\n_Context: Inline style (highest priority)_`;
                }
                else if (domTree && domNode) {
                    hoverText += `\n_Context: \`${usageContext}\` (DOM-aware matching)_`;
                }
                else {
                    hoverText += `\n_Context: \`${usageContext}\`_`;
                }
            }
        }
        return {
            contents: {
                kind: 'markdown',
                value: hoverText
            }
        };
    }
    return undefined;
});
connection.onDefinition((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return undefined;
    }
    const text = document.getText();
    const offset = document.offsetAt(params.position);
    const left = text.slice(0, offset).match(/[\w-]*$/);
    const right = text.slice(offset).match(/^[\w-]*/);
    if (!left || !right) {
        return undefined;
    }
    const word = left[0] + right[0];
    if (word.startsWith('--')) {
        const variables = cssVariableManager.getVariables(word);
        if (variables.length > 0) {
            return {
                uri: variables[0].uri,
                range: variables[0].range
            };
        }
    }
    return undefined;
});
// Find all references handler
connection.onReferences((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    const text = document.getText();
    const offset = document.offsetAt(params.position);
    const left = text.slice(0, offset).match(/[\w-]*$/);
    const right = text.slice(offset).match(/^[\w-]*/);
    if (!left || !right) {
        return [];
    }
    const word = left[0] + right[0];
    if (word.startsWith('--')) {
        const references = cssVariableManager.getReferences(word);
        return references.map(ref => node_1.Location.create(ref.uri, ref.range));
    }
    return [];
});
// Rename handler
connection.onRenameRequest((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return null;
    }
    const text = document.getText();
    const offset = document.offsetAt(params.position);
    const left = text.slice(0, offset).match(/[\w-]*$/);
    const right = text.slice(offset).match(/^[\w-]*/);
    if (!left || !right) {
        return null;
    }
    const word = left[0] + right[0];
    if (word.startsWith('--')) {
        const references = cssVariableManager.getReferences(word);
        const changes = {};
        for (const ref of references) {
            if (!changes[ref.uri]) {
                changes[ref.uri] = [];
            }
            // For definitions, just replace the variable name
            // For usages in var(), replace just the variable name part
            const edit = {
                range: ref.range,
                newText: 'value' in ref
                    ? `${params.newName}: ${ref.value};` // Definition
                    : `var(${params.newName})` // Usage
            };
            changes[ref.uri].push(edit);
        }
        return { changes };
    }
    return null;
});
// Document symbols handler
connection.onDocumentSymbol((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    const variables = cssVariableManager.getDocumentDefinitions(document.uri);
    return variables.map(v => node_1.DocumentSymbol.create(v.name, v.value, node_1.SymbolKind.Variable, v.range, v.range));
});
// Workspace symbols handler
connection.onWorkspaceSymbol((params) => {
    const query = params.query.toLowerCase();
    const allVariables = cssVariableManager.getAllDefinitions();
    const filtered = query
        ? allVariables.filter(v => v.name.toLowerCase().includes(query))
        : allVariables;
    return filtered.map(v => node_1.WorkspaceSymbol.create(v.name, node_1.SymbolKind.Variable, v.uri, v.range));
});
// Color Provider: Document Colors
connection.onDocumentColor((params) => {
    // Skip if color provider is disabled
    if (!ENABLE_COLOR_PROVIDER) {
        return [];
    }
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    const colors = [];
    const text = document.getText();
    // 1. Check variable definitions: --my-color: #f00;
    const definitions = cssVariableManager.getDocumentDefinitions(document.uri);
    for (const def of definitions) {
        const color = (0, colorService_1.parseColor)(def.value);
        if (color) {
            // Use the stored valueRange if available (accurate from csstree parsing)
            if (def.valueRange) {
                colors.push({
                    range: def.valueRange,
                    color: color
                });
            }
            else {
                // Fallback: find the value within the declaration text
                // This handles cases where valueRange wasn't captured (shouldn't happen normally)
                const defText = text.substring(document.offsetAt(def.range.start), document.offsetAt(def.range.end));
                const colonIndex = defText.indexOf(':');
                if (colonIndex !== -1) {
                    const afterColon = defText.substring(colonIndex + 1);
                    const valueIndex = afterColon.indexOf(def.value.trim());
                    if (valueIndex !== -1) {
                        const absoluteValueStart = document.offsetAt(def.range.start) + colonIndex + 1 + valueIndex;
                        const start = document.positionAt(absoluteValueStart);
                        const end = document.positionAt(absoluteValueStart + def.value.trim().length);
                        colors.push({
                            range: { start, end },
                            color: color
                        });
                    }
                }
            }
        }
    }
    // 2. Check variable usages: var(--my-color)
    // Only show color boxes on usages if COLOR_ONLY_ON_VARIABLES is false
    if (!COLOR_ONLY_ON_VARIABLES) {
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
                    color: color
                });
            }
        }
    }
    return colors;
});
// Color Provider: Color Presentation
connection.onColorPresentation((params) => {
    // Skip if color provider is disabled
    if (!ENABLE_COLOR_PROVIDER) {
        return [];
    }
    const color = params.color;
    const range = params.range;
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    // Offer multiple format options for the color picker
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
});
// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);
// Listen on the connection
connection.listen();
//# sourceMappingURL=server.js.map