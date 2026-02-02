import { TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CssVariableManager } from "../cssVariableManager";

/**
 * Document sync setup for CSS LSP.
 * Note: In the current version, document save events are handled 
 * through the existing file watching mechanism.
 */
export function setupDocumentSync(
  documents: TextDocuments<TextDocument>,
  cssVariableManager: CssVariableManager,
): void {
  // The TextDocuments manager already handles document changes
  // Save events are handled through the existing file watching system
  // in server.ts via connection.onDidChangeWatchedFiles
  
  console.log("[css-lsp] Document sync setup complete");
}

