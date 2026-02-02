import {
  CallHierarchyPrepareParams,
  CallHierarchyIncomingCallsParams,
  CallHierarchyOutgoingCallsParams,
  CallHierarchyItem,
  CallHierarchyIncomingCall,
  CallHierarchyOutgoingCall,
  SymbolKind,
  Range,
  Position,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import * as path from "path";
import { CssVariableManager } from "../cssVariableManager";
import { URI } from "vscode-uri";

/**
 * Handle call hierarchy prepare.
 * Resolves the item at the cursor position to start the hierarchy.
 */
export function handleCallHierarchyPrepare(
  params: CallHierarchyPrepareParams,
  documents: { get(uri: string): TextDocument | undefined },
  cssVariableManager: CssVariableManager,
): CallHierarchyItem[] | null {
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
  if (!word.startsWith("--")) {
    return null;
  }

  const variables = cssVariableManager.getVariables(word);
  if (variables.length === 0) {
    // If definition not found, try usage
    const usages = cssVariableManager.getVariableUsages(word);
    if (usages.length > 0) {
      // Return item based on usage, but pointing to definition if possible
      // Ideally we resolve to the definition.
      // For now, create a virtual item if definition is missing?
      // Actually, hierarchy works best on definitions.
      return null;
    }
    return null;
  }

  const variable = variables[0]; // Use first definition

  return [
    {
      name: variable.name,
      kind: SymbolKind.Variable,
      uri: variable.uri,
      range: variable.range,
      selectionRange: variable.nameRange || variable.range,
      detail: variable.value,
    },
  ];
}

/**
 * Handle incoming calls (Functions that call this function).
 * For CSS variables: Where is this variable used?
 */
export function handleCallHierarchyIncomingCalls(
  params: CallHierarchyIncomingCallsParams,
  cssVariableManager: CssVariableManager,
): CallHierarchyIncomingCall[] | null {
  const item = params.item;
  const variableName = item.name;

  const usages = cssVariableManager.getVariableUsages(variableName);

  const incomingCalls: CallHierarchyIncomingCall[] = [];

  for (const usage of usages) {
    // We need to identify the "caller".
    // In CSS, the "caller" is the rule or selector that uses the variable.
    // Or if inside another variable definition: --foo: var(--bar);

    // Simplification: We'll create an item for the file/range where it's used
    const fromRange: Range = usage.range;

    // We ideally need a "container" symbol (like the selector name).
    // cssVariableManager doesn't easily give us the "parent rule" of a usage yet without re-parsing.
    // But we know the file URI.

    const callerItem: CallHierarchyItem = {
      name: usage.usageContext || "root", // Fallback if no selector known
      kind: SymbolKind.Property,
      uri: usage.uri,
      range: usage.range, // Approx range (usage site)
      selectionRange: usage.range,
      detail: "Usage",
    };

    incomingCalls.push({
      from: callerItem,
      fromRanges: [usage.range],
    });
  }

  return incomingCalls;
}

/**
 * Handle outgoing calls (Functions called by this function).
 * For CSS variables: What other variables does this variable use?
 */
export function handleCallHierarchyOutgoingCalls(
  params: CallHierarchyOutgoingCallsParams,
  cssVariableManager: CssVariableManager,
): CallHierarchyOutgoingCall[] | null {
  const item = params.item;
  // This requires analyzing the value of the variable to find var() calls
  // `item.detail` might hold the value if we populated it.

  const variableValue = item.detail;
  if (!variableValue) return null;

  const outgoingCalls: CallHierarchyOutgoingCall[] = [];
  const varRegex = /var\((--[\w-]+)/g;
  let match;

  while ((match = varRegex.exec(variableValue)) !== null) {
    const usedVarName = match[1];
    const definitions = cssVariableManager.getVariables(usedVarName);

    if (definitions.length > 0) {
      const def = definitions[0];
      const toItem: CallHierarchyItem = {
        name: def.name,
        kind: SymbolKind.Variable,
        uri: def.uri,
        range: def.range,
        selectionRange: def.nameRange || def.range,
        detail: def.value,
      };

      // Where in the value string is it used?
      // We don't have absolute position in file easily here without reparsing definition location.
      // We'll approximate or leave empty.
      // Range is required.
      const dummyRange: Range = {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      };

      outgoingCalls.push({
        to: toItem,
        fromRanges: [dummyRange],
      });
    }
  }

  return outgoingCalls;
}
