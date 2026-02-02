import { CodeLensParams, CodeLens, Command } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CssVariableManager } from "../cssVariableManager";

/**
 * Handle code lens requests for CSS documents.
 * Shows usage counts above CSS variable definitions.
 */
export function handleCodeLens(
  params: CodeLensParams,
  documents: { get(uri: string): TextDocument | undefined },
  cssVariableManager: CssVariableManager,
): CodeLens[] | null {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const codeLenses: CodeLens[] = [];
  const allVariables = cssVariableManager.getAllVariables();

  // Find variables defined in this document
  const documentVariables = allVariables.filter((v) => v.uri === document.uri);

  // Group by variable name to avoid duplicate lenses
  const seen = new Set<string>();

  for (const variable of documentVariables) {
    if (seen.has(variable.name)) continue;
    seen.add(variable.name);

    // Get usage count for this variable
    const references = cssVariableManager.getReferences(variable.name);
    // Filter to only usages (not definitions)
    const usages = references.filter((ref) => !("selector" in ref));
    const usageCount = usages.length;

    // Use the nameRange if available, otherwise fall back to range
    const range = variable.nameRange || variable.range;

    const command: Command = {
      title: usageCount === 1 ? `${usageCount} usage` : `${usageCount} usages`,
      command: "", // No command, just informational
    };

    codeLenses.push({
      range,
      command,
    });
  }

  return codeLenses;
}
