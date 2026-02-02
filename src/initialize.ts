import {
  InitializeResult,
  TextDocumentSyncKind,
  TextDocumentSyncOptions,
} from "vscode-languageserver/node";

export function buildInitializeResult(
  enableColorProvider: boolean,
  supportsWorkspaceFolders: boolean,
): InitializeResult {
  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: {
        // Open and close notifications are sent to the server
        openClose: true,
        // Change notifications are sent to the server
        change: TextDocumentSyncKind.Incremental,
        // Will save notifications are sent to the server
        willSave: true,
        // Will save wait until requests are sent to the server
        willSaveWaitUntil: true,
        // Save notifications are sent to the server
        save: {
          // Include the content on save
          includeText: false,
        },
      } as TextDocumentSyncOptions,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ["-", "(", ":"],
      },
      definitionProvider: true,
      hoverProvider: true,
      referencesProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      colorProvider: enableColorProvider,
      declarationProvider: true,
      typeDefinitionProvider: true,
      implementationProvider: true,
      documentHighlightProvider: true,
      foldingRangeProvider: true,
      selectionRangeProvider: true,
      documentLinkProvider: {
        resolveProvider: false,
      },
      codeLensProvider: {
        resolveProvider: false,
      },
      inlayHintProvider: true,
      signatureHelpProvider: {
        triggerCharacters: ["(", ","],
      },
      renameProvider: {
        prepareProvider: true,
      },
      codeActionProvider: {
        codeActionKinds: ["quickfix"],
      },
      linkedEditingRangeProvider: true,
      semanticTokensProvider: {
        legend: {
          tokenTypes: ["variable", "property", "value", "string", "comment"],
          tokenModifiers: ["declaration", "readonly", "static"],
        },
        full: true,
      },
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      callHierarchyProvider: true,
    },
  };

  if (supportsWorkspaceFolders) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
        changeNotifications: "kind",
      },
    };
  }

  return result;
}
