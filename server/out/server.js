#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_1 = require("vscode-languageserver/node");
const fs = require("fs");
const vscode_languageserver_textdocument_1 = require("vscode-languageserver-textdocument");
const cssVariableManager_1 = require("./cssVariableManager");
const specificity_1 = require("./specificity");
const colorService_1 = require("./colorService");
// Write startup log immediately
try {
    const startupMsg = `[STARTUP] ${new Date().toISOString()} CSS LSP Server starting\n`;
    fs.appendFileSync('/tmp/css.log', startupMsg);
}
catch (e) {
    // Ignore
}
// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
fs.writeFile('/tmp/css2.log', 'asdf', { encoding: 'utf-8' }, () => { });
function logDebug(label, payload) {
    // eslint-disable-next-line no-console
    const message = `[css-lsp] ${label} ${JSON.stringify(payload)}`;
    console.error(message);
    try {
        fs.appendFileSync('/tmp/css.log', `[DEBUG] ${new Date().toISOString()} ${message}\n`);
    }
    catch (e) {
        // Ignore file write errors
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
            colorProvider: true
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
    // Scan workspace for CSS variables on initialization
    const workspaceFolders = await connection.workspace.getWorkspaceFolders();
    if (workspaceFolders) {
        connection.console.log('Scanning workspace for CSS variables...');
        const folderUris = workspaceFolders.map(f => f.uri);
        await cssVariableManager.scanWorkspace(folderUris);
        connection.console.log(`Workspace scan complete. Found ${cssVariableManager.getAllVariables().length} variables.`);
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
// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
// Note: We don't need a separate onDidOpen handler because onDidChangeContent
// already fires when a document is first opened, avoiding double-parsing.
documents.onDidChangeContent(change => {
    cssVariableManager.parseDocument(change.document);
    validateTextDocument(change.document);
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
// This handler provides the initial list of the completion items.
connection.onCompletion((_textDocumentPosition) => {
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
                newText: 'uri' in ref && 'value' in ref
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
    // We want to show the color of the variable being used.
    // But we can't easily edit it (color picker on usage).
    // VS Code allows read-only color information.
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
    return colors;
});
// Color Provider: Color Presentation
connection.onColorPresentation((params) => {
    const color = params.color;
    const range = params.range;
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }
    const text = document.getText(range);
    const newColorStr = (0, colorService_1.formatColor)(color);
    // If we are editing a variable usage var(--foo), we probably shouldn't replace it with a hex code.
    // Unless the user explicitly wants to inline it.
    // But standard behavior for color picker is to replace the text.
    // If it's a variable definition (e.g. #f00), we just replace it.
    return [
        node_1.ColorPresentation.create(newColorStr, node_1.TextEdit.replace(range, newColorStr))
    ];
});
// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);
// Listen on the connection
connection.listen();
//# sourceMappingURL=server.js.map