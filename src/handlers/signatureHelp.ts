import {
  SignatureHelpParams,
  SignatureHelp,
  SignatureInformation,
  ParameterInformation,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CssVariableManager } from "../cssVariableManager";

/**
 * Handle signature help requests for CSS documents.
 * Provides parameter hints for var(--name, fallback) syntax.
 */
export function handleSignatureHelp(
  params: SignatureHelpParams,
  documents: { get(uri: string): TextDocument | undefined },
  cssVariableManager: CssVariableManager,
): SignatureHelp | null {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return null;
  }

  const text = document.getText();
  const offset = document.offsetAt(params.position);

  // Look backwards for "var(" to see if we're inside a var() call
  const textBefore = text.slice(0, offset);
  const varMatch = textBefore.match(/var\(\s*(--[\w-]*)?(?:\s*,\s*)?$/);

  if (!varMatch) {
    return null;
  }

  // Determine which parameter we're in
  const afterVar = textBefore.slice(textBefore.lastIndexOf("var("));
  const hasComma = afterVar.includes(",");
  const activeParameter = hasComma ? 1 : 0;

  // Get variable info if we have a name
  const varName = varMatch[1];
  let variableInfo = "";
  if (varName) {
    const variables = cssVariableManager.getVariables(varName);
    if (variables.length > 0) {
      variableInfo = ` (current value: ${variables[0].value})`;
    }
  }

  const signature: SignatureInformation = {
    label: "var(--custom-property, fallback-value)",
    documentation: `CSS custom property (variable) function.${variableInfo}\n\nThe var() function substitutes the value of a custom property.`,
    parameters: [
      {
        label: "--custom-property",
        documentation:
          "The name of the custom property to use, starting with --",
      } as ParameterInformation,
      {
        label: "fallback-value",
        documentation:
          "Optional fallback value used if the property is not defined",
      } as ParameterInformation,
    ],
  };

  return {
    signatures: [signature],
    activeSignature: 0,
    activeParameter,
  };
}
