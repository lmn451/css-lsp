import {
  InitializeResult,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";

export function buildInitializeResult(
  enableColorProvider: boolean,
  supportsWorkspaceFolders: boolean,
): InitializeResult {
  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ["-"],
      },
      definitionProvider: true,
      hoverProvider: true,
      referencesProvider: true,
      renameProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      colorProvider: enableColorProvider,
    },
  };

  if (supportsWorkspaceFolders) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }

  return result;
}
