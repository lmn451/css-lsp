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
	InitializeResult
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';
import { CssVariable } from './cssVariableManager';

import { CssVariableManager } from './cssVariableManager';

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
			hoverProvider: true
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

connection.onInitialized(() => {
	if (hasConfigurationCapability) {
		// Register for all configuration changes.
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}
	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log('Workspace folder change event received.');
		});
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
	// In this simple example we get the settings for every validate run.
	const settings = await getDocumentSettings(textDocument.uri);
	// Validation logic could go here (e.g. finding undefined variables)
}

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received an file change event');
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
		if (variables.length > 0) {
			// Show the value of the first match (or all of them)
			const value = variables[0].value;
			return {
				contents: {
					kind: 'markdown',
					value: `**${word}**: ${value}`
				}
			};
		}
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

// Listen on the connection
connection.listen();
