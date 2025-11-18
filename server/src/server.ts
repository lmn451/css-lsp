import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	CompletionItem,
	CompletionItemKind,
	TextDocumentPositionParams,
	TextDocumentSyncKind,
	InitializeResult,
	Location,
	SymbolKind,
	DocumentSymbol,
	WorkspaceSymbol,
	WorkspaceEdit,
	TextEdit
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';
import { CssVariable } from './cssVariableManager';

import { CssVariableManager } from './cssVariableManager';
import { calculateSpecificity, compareSpecificity, formatSpecificity, matchesContext } from './specificity';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);
const cssVariableManager = new CssVariableManager();

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

connection.onInitialize((params: InitializeParams) => {
	const capabilities = params.capabilities;

	// Does the client support the `workspace/configuration` request?
	// If not, we fall back using global settings.
	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);
	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
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
			workspaceSymbolProvider: true
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
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
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

// The example settings
interface ExampleSettings {
	maxNumberOfProblems: number;
}

const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 };
let globalSettings: ExampleSettings = defaultSettings;

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<ExampleSettings>> = new Map();

connection.onDidChangeConfiguration(change => {
	if (hasConfigurationCapability) {
		// Reset all cached document settings
		documentSettings.clear();
	} else {
		globalSettings = <ExampleSettings>(
			(change.settings.cssVariableLsp || defaultSettings)
		);
	}

	// Revalidate all open text documents
	documents.all().forEach(validateTextDocument);
});

function getDocumentSettings(resource: string): Thenable<ExampleSettings> {
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
documents.onDidClose(e => {
	documentSettings.delete(e.document.uri);
	cssVariableManager.clearDocumentVariables(e.document.uri);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
	cssVariableManager.parseDocument(change.document);
	// We could validate here if we wanted to check for undefined variables
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
	const settings = await getDocumentSettings(textDocument.uri);
	const text = textDocument.getText();
	const diagnostics: Diagnostic[] = [];

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

			const diagnostic: Diagnostic = {
				severity: DiagnosticSeverity.Warning,
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
	// Monitored files have changed in VSCode
	connection.console.log('Received file change event');

	// Re-scan workspace to pick up any new/changed/deleted files
	const workspaceFolders = await connection.workspace.getWorkspaceFolders();
	if (workspaceFolders) {
		const folderUris = workspaceFolders.map(f => f.uri);
		await cssVariableManager.scanWorkspace(folderUris);

		// Revalidate all open documents
		documents.all().forEach(validateTextDocument);
	}
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
	(_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
		const variables = cssVariableManager.getAllVariables();
		// Deduplicate by name
		const uniqueVars = new Map<string, CssVariable>();
		variables.forEach(v => {
			if (!uniqueVars.has(v.name)) {
				uniqueVars.set(v.name, v);
			}
		});

		return Array.from(uniqueVars.values()).map(v => ({
			label: v.name,
			kind: CompletionItemKind.Variable,
			detail: v.value,
			documentation: `Defined in ${v.uri}`
		}));
	}
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve(
	(item: CompletionItem): CompletionItem => {
		return item;
	}
);

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
		const hoverUsage = usages.find(u =>
			document.positionAt(document.offsetAt(u.range.start)) === params.position ||
			(offset >= document.offsetAt(u.range.start) && offset <= document.offsetAt(u.range.end))
		);

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
			const specA = calculateSpecificity(a.selector);
			const specB = calculateSpecificity(b.selector);
			const specCompare = compareSpecificity(specA, specB);

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
				hoverText += `**Specificity:** ${formatSpecificity(calculateSpecificity(v.selector))}\n`;
			}
		} else {
			// Multiple definitions - show full cascade
			hoverText += '**Definitions** (CSS cascade order):\n\n';

			sortedVars.forEach((v, index) => {
				const spec = calculateSpecificity(v.selector);
				// Use DOM-aware matching if available, otherwise fall back to simple matching
				const isApplicable = usageContext ?
					matchesContext(v.selector, usageContext, domTree, domNode) : true;
				const isWinner = index === 0 && (isApplicable || isInlineStyle);

				let line = `${index + 1}. \`${v.value}\``;

				if (v.important) {
					line += ` **!important**`;
				}

				if (v.selector) {
					line += ` from \`${v.selector}\``;
					line += ` ${formatSpecificity(spec)}`;
				}

				if (isWinner && usageContext) {
					if (v.important) {
						line += ' ✓ **Wins (!important)**';
					} else if (isInlineStyle) {
						line += ' ✓ **Would apply (inline style)**';
					} else if (domTree && domNode) {
						line += ' ✓ **Applies (DOM match)**';
					} else {
						line += ' ✓ **Applies here**';
					}
				} else if (!isApplicable && usageContext && !isInlineStyle) {
					line += ' _(selector doesn\'t match)_';
				} else if (index > 0 && usageContext) {
					// Explain why it doesn't win
					const winner = sortedVars[0];
					if (winner.important && !v.important) {
						line += ' _(overridden by !important)_';
					} else {
						const winnerSpec = calculateSpecificity(winner.selector);
						const cmp = compareSpecificity(winnerSpec, spec);
						if (cmp > 0) {
							line += ' _(lower specificity)_';
						} else if (cmp === 0) {
							line += ' _(earlier in source)_';
						}
					}
				}

				hoverText += line + '\n';
			});

			if (usageContext) {
				if (isInlineStyle) {
					hoverText += `\n_Context: Inline style (highest priority)_`;
				} else if (domTree && domNode) {
					hoverText += `\n_Context: \`${usageContext}\` (DOM-aware matching)_`;
				} else {
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

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

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
		return references.map(ref => Location.create(ref.uri, ref.range));
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
		const changes: { [uri: string]: TextEdit[] } = {};

		for (const ref of references) {
			if (!changes[ref.uri]) {
				changes[ref.uri] = [];
			}

			// For definitions, just replace the variable name
			// For usages in var(), replace just the variable name part
			const edit: TextEdit = {
				range: ref.range,
				newText: 'uri' in ref && 'value' in ref
					? `${params.newName}: ${(ref as any).value};`  // Definition
					: `var(${params.newName})`  // Usage
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
	return variables.map(v => DocumentSymbol.create(
		v.name,
		v.value,
		SymbolKind.Variable,
		v.range,
		v.range
	));
});

// Workspace symbols handler
connection.onWorkspaceSymbol((params) => {
	const query = params.query.toLowerCase();
	const allVariables = cssVariableManager.getAllDefinitions();

	const filtered = query
		? allVariables.filter(v => v.name.toLowerCase().includes(query))
		: allVariables;

	return filtered.map(v => WorkspaceSymbol.create(
		v.name,
		SymbolKind.Variable,
		v.uri,
		v.range
	));
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
