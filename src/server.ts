#!/usr/bin/env node

import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  Location,
  SymbolKind,
  DocumentSymbol,
  WorkspaceSymbol,
  TextEdit,
  FileChangeType,
  DidChangeWatchedFilesNotification,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CssVariable } from "./cssVariableManager";
import { getCssCompletionContext } from "./completionContext";
import * as path from "path";
import { URI } from "vscode-uri";

import { CssVariableManager, normalizeUri } from "./cssVariableManager";
import {
  collectColorPresentations,
  collectDocumentColors,
} from "./colorProvider";
import { buildInitializeResult } from "./initialize";
import { formatUriForDisplay, toNormalizedFsPath } from "./pathDisplay";
import { buildRuntimeConfig } from "./runtimeConfig";
import {
  calculateSpecificity,
  compareSpecificity,
  formatSpecificity,
  matchesContext,
} from "./specificity";

const runtimeConfig = buildRuntimeConfig(process.argv.slice(2), process.env);

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

function logDebug(label: string, payload: unknown) {
  // Only log in debug mode (set CSS_LSP_DEBUG=1 environment variable)
  if (process.env.CSS_LSP_DEBUG) {
    const message = `[css-lsp] ${label} ${JSON.stringify(payload)}`;
    connection.console.log(message);
  }
}

function updateWorkspaceFolderPaths(folders?: Array<{ uri: string }>): void {
  if (!folders) {
    workspaceFolderPaths = [];
    return;
  }

  const paths = folders
    .map((folder) => toNormalizedFsPath(folder.uri))
    .filter((folderPath): folderPath is string => Boolean(folderPath));

  workspaceFolderPaths = paths.toSorted((a, b) => b.length - a.length);
}

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);
const cssVariableManager = new CssVariableManager(
  connection.console,
  runtimeConfig.lookupFiles,
  runtimeConfig.ignoreGlobs,
);

let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;
let hasDynamicFileWatchingCapability = false;
let workspaceFolderPaths: string[] = [];
let rootFolderPath: string | null = null;
let rootFolderUri: string | null = null;

async function workspaceFolderUrisForScan(): Promise<string[]> {
  if (hasWorkspaceFolderCapability) {
    try {
      const folders = await connection.workspace.getWorkspaceFolders();
      if (folders?.length) {
        updateWorkspaceFolderPaths(folders);
        return [...new Set(folders.map((folder) => folder.uri))];
      }
    } catch (error) {
      connection.console.log(
        `Unable to query workspace folders; falling back to the initialize root: ${String(error)}`,
      );
    }
  }

  return rootFolderUri ? [rootFolderUri] : [];
}

connection.onInitialize((params: InitializeParams) => {
  logDebug("initialize", {
    rootUri: params.rootUri,
    // rootPath is deprecated and optional in InitializeParams
    rootPath: params.rootPath,
    workspaceFolders: params.workspaceFolders,
    capabilities: params.capabilities,
  });

  const capabilities = params.capabilities;

  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );
  hasDynamicFileWatchingCapability =
    !!capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration;
  rootFolderPath = null;
  rootFolderUri = null;
  if (params.rootUri) {
    try {
      const parsedRootUri = URI.parse(params.rootUri);
      rootFolderPath = path.normalize(parsedRootUri.fsPath);
      rootFolderUri = parsedRootUri.toString();
    } catch {
      rootFolderPath = null;
      rootFolderUri = null;
    }
  } else if (params.rootPath) {
    rootFolderPath = path.normalize(params.rootPath);
    rootFolderUri = URI.file(params.rootPath).toString();
  }
  updateWorkspaceFolderPaths(params.workspaceFolders || undefined);

  return buildInitializeResult(
    runtimeConfig.enableColorProvider,
    hasWorkspaceFolderCapability,
  );
});

connection.onInitialized(async () => {
  if (hasDynamicFileWatchingCapability) {
    try {
      await connection.client.register(DidChangeWatchedFilesNotification.type, {
        watchers: cssVariableManager
          .getLookupGlobs()
          .map((globPattern) => ({ globPattern })),
      });
    } catch (error) {
      connection.console.log(
        `Unable to register file watchers: ${String(error)}`,
      );
    }
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders((_event) => {
      connection.console.log("Workspace folder change event received.");
      void connection.workspace.getWorkspaceFolders().then((folders) => {
        updateWorkspaceFolderPaths(folders || undefined);
      });
    });
  }

  // Scan workspace for CSS variables on initialization with progress reporting
  const folderUris = await workspaceFolderUrisForScan();
  if (folderUris.length > 0) {
    connection.console.log("Scanning workspace for CSS variables...");

    // Scan with progress callback that logs to console
    let lastLoggedPercentage = 0;
    await cssVariableManager.scanWorkspace(folderUris, (current, total) => {
      const percentage = Math.round((current / total) * 100);
      // Log progress every 20% to avoid spam
      if (percentage - lastLoggedPercentage >= 20 || current === total) {
        connection.console.log(
          `Scanning CSS files: ${current}/${total} (${percentage}%)`,
        );
        lastLoggedPercentage = percentage;
      }
    });

    const totalVars = cssVariableManager.getAllVariables().length;
    connection.console.log(
      `Workspace scan complete. Found ${totalVars} CSS variables.`,
    );

    // Validate all open documents after workspace scan
    documents.all().forEach(validateTextDocument);
  }
});

// Handle document close events
documents.onDidClose(async (e) => {
  connection.console.log(`[css-lsp] Document closed: ${e.document.uri}`);
  const pending = validationTimeouts.get(e.document.uri);
  if (pending) {
    clearTimeout(pending);
    validationTimeouts.delete(e.document.uri);
  }
  const previousNames = getDefinedNames(e.document.uri);
  documentUsageNames.delete(e.document.uri);
  // When a document is closed, we need to revert to the file system version
  // instead of removing it completely (which would break workspace files).
  // This handles cases where the editor had unsaved changes.
  await cssVariableManager.updateFile(e.document.uri);
  scheduleDependentValidation(previousNames, e.document.uri);
  connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
});

// Debounce map for validation (per document URI)
const validationTimeouts: Map<string, NodeJS.Timeout> = new Map();
let validateAllTimeout: NodeJS.Timeout | null = null;
const pendingDefinitionNames = new Set<string>();
const documentUsageNames = new Map<string, Set<string>>();

function diagnosticUsages(
  document: TextDocument,
): IterableIterator<RegExpExecArray> {
  // Use the same extraction for dependency tracking and diagnostics, including
  // open embedded-language buffers that the CSS index may not fully parse.
  return document.getText().matchAll(/var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)/g);
}

function getDefinedNames(uri: string): Set<string> {
  return new Set(
    cssVariableManager
      .getDocumentDefinitions(uri)
      .map((definition) => definition.name),
  );
}

function scheduleValidation(textDocument: TextDocument): void {
  // Debounce validation to avoid excessive diagnostic updates while typing
  const uri = textDocument.uri;

  // Clear existing timeout for this document
  const existingTimeout = validationTimeouts.get(uri);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }

  // Schedule validation after 300ms of inactivity
  const timeout = setTimeout(() => {
    const current = documents.get(uri);
    if (current) {
      validateTextDocument(current);
    }
    validationTimeouts.delete(uri);
  }, 300);

  validationTimeouts.set(uri, timeout);
}

function scheduleDependentValidation(
  previousNames: Set<string>,
  uri: string,
): void {
  // Keep every changed name until validation runs, including definitions removed
  // by earlier edits in this debounce window or edits in another document.
  for (const name of previousNames) {
    pendingDefinitionNames.add(name);
  }
  for (const name of getDefinedNames(uri)) {
    pendingDefinitionNames.add(name);
  }
  if (pendingDefinitionNames.size === 0) {
    return;
  }
  if (validateAllTimeout) {
    clearTimeout(validateAllTimeout);
  }

  validateAllTimeout = setTimeout(() => {
    const affectedUris = new Set<string>();
    for (const [documentUri, names] of documentUsageNames) {
      for (const name of names) {
        if (pendingDefinitionNames.has(name)) {
          affectedUris.add(documentUri);
          break;
        }
      }
    }
    pendingDefinitionNames.clear();
    documents.all().forEach((document) => {
      if (affectedUris.has(document.uri)) {
        validateTextDocument(document);
      }
    });
    validateAllTimeout = null;
  }, 300);
}

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
// Note: We don't need a separate onDidOpen handler because onDidChangeContent
// already fires when a document is first opened, avoiding double-parsing.
documents.onDidChangeContent((change) => {
  const previousNames = getDefinedNames(change.document.uri);
  // Parse immediately (needed for completion/hover)
  cssVariableManager.parseDocument(change.document);
  documentUsageNames.set(
    change.document.uri,
    new Set(Array.from(diagnosticUsages(change.document), (usage) => usage[1])),
  );

  scheduleValidation(change.document);
  scheduleDependentValidation(previousNames, change.document.uri);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  const diagnostics: Diagnostic[] = [];

  for (const match of diagnosticUsages(textDocument)) {
    const variableName = match[1];
    const hasFallback = Boolean(match[2]);
    const definitions = cssVariableManager.getVariables(variableName);

    if (definitions.length === 0) {
      if (hasFallback && runtimeConfig.undefinedVarFallback === "off") {
        continue;
      }

      const severity =
        hasFallback && runtimeConfig.undefinedVarFallback === "info"
          ? DiagnosticSeverity.Information
          : DiagnosticSeverity.Warning;
      // Variable is used but not defined
      const startPos = textDocument.positionAt(match.index);
      const endPos = textDocument.positionAt(match.index + match[0].length);

      const diagnostic: Diagnostic = {
        severity,
        range: {
          start: startPos,
          end: endPos,
        },
        message: `CSS variable '${variableName}' is not defined in the workspace`,
        source: "css-variable-lsp",
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
  connection.console.log("Received file change event");
  logDebug("didChangeWatchedFiles", change);

  for (const fileEvent of change.changes) {
    const previousNames = getDefinedNames(fileEvent.uri);
    if (fileEvent.type === FileChangeType.Deleted) {
      cssVariableManager.removeFile(fileEvent.uri);
    } else if (
      !documents
        .all()
        .some(
          (document) =>
            normalizeUri(document.uri) === normalizeUri(fileEvent.uri),
        )
    ) {
      // Open buffers already update the index through didChangeContent.
      await cssVariableManager.updateFile(fileEvent.uri);
    } else {
      continue;
    }
    scheduleDependentValidation(previousNames, fileEvent.uri);
  }
});

/**
 * Check if a CSS variable is relevant for a given property based on naming conventions.
 * Returns a score: higher is more relevant, 0 means not relevant, -1 means keep (no filtering).
 */
function scoreVariableRelevance(
  varName: string,
  propertyName: string | null,
): number {
  if (!propertyName) {
    return -1; // No property context, keep all variables
  }

  const lowerVarName = varName.toLowerCase();

  // Color-related properties
  const colorProperties = [
    "color",
    "background-color",
    "background",
    "border-color",
    "outline-color",
    "text-decoration-color",
    "fill",
    "stroke",
  ];
  if (colorProperties.includes(propertyName)) {
    // High relevance: variable name contains color-related keywords
    if (
      lowerVarName.includes("color") ||
      lowerVarName.includes("bg") ||
      lowerVarName.includes("background") ||
      lowerVarName.includes("primary") ||
      lowerVarName.includes("secondary") ||
      lowerVarName.includes("accent") ||
      lowerVarName.includes("text") ||
      lowerVarName.includes("border") ||
      lowerVarName.includes("link")
    ) {
      return 10;
    }
    // Low relevance for non-color variables
    if (
      lowerVarName.includes("spacing") ||
      lowerVarName.includes("margin") ||
      lowerVarName.includes("padding") ||
      lowerVarName.includes("size") ||
      lowerVarName.includes("width") ||
      lowerVarName.includes("height") ||
      lowerVarName.includes("font") ||
      lowerVarName.includes("weight") ||
      lowerVarName.includes("radius")
    ) {
      return 0;
    }
    // Medium relevance: might be a color
    return 5;
  }

  // Spacing-related properties
  const spacingProperties = [
    "margin",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "gap",
    "row-gap",
    "column-gap",
  ];
  if (spacingProperties.includes(propertyName)) {
    if (
      lowerVarName.includes("spacing") ||
      lowerVarName.includes("margin") ||
      lowerVarName.includes("padding") ||
      lowerVarName.includes("gap")
    ) {
      return 10;
    }
    if (
      lowerVarName.includes("color") ||
      lowerVarName.includes("bg") ||
      lowerVarName.includes("background")
    ) {
      return 0;
    }
    return 5;
  }

  // Size-related properties
  const sizeProperties = [
    "width",
    "height",
    "max-width",
    "max-height",
    "min-width",
    "min-height",
    "font-size",
  ];
  if (sizeProperties.includes(propertyName)) {
    if (
      lowerVarName.includes("width") ||
      lowerVarName.includes("height") ||
      lowerVarName.includes("size")
    ) {
      return 10;
    }
    if (
      lowerVarName.includes("color") ||
      lowerVarName.includes("bg") ||
      lowerVarName.includes("background")
    ) {
      return 0;
    }
    return 5;
  }

  // Border-radius properties
  if (propertyName.includes("radius")) {
    if (lowerVarName.includes("radius") || lowerVarName.includes("rounded")) {
      return 10;
    }
    if (
      lowerVarName.includes("color") ||
      lowerVarName.includes("bg") ||
      lowerVarName.includes("background")
    ) {
      return 0;
    }
    return 5;
  }

  // Font-related properties
  const fontProperties = ["font-family", "font-weight", "font-style"];
  if (fontProperties.includes(propertyName)) {
    if (lowerVarName.includes("font")) {
      return 10;
    }
    if (lowerVarName.includes("color") || lowerVarName.includes("spacing")) {
      return 0;
    }
    return 5;
  }

  // Default: no strong preference, keep all
  return -1;
}

// This handler provides the initial list of the completion items.
connection.onCompletion(
  (textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    const document = documents.get(textDocumentPosition.textDocument.uri);
    if (!document) {
      return [];
    }

    const completionContext = getCssCompletionContext(
      document,
      textDocumentPosition.position,
    );
    if (!completionContext) {
      return [];
    }

    const propertyName = completionContext.propertyName;

    const variables = cssVariableManager.getAllVariables();
    // Deduplicate by name
    const uniqueVars = new Map<string, CssVariable>();
    variables.forEach((v) => {
      if (!uniqueVars.has(v.name)) {
        uniqueVars.set(v.name, v);
      }
    });

    // Score and filter variables based on property context
    const scoredVars = Array.from(uniqueVars.values()).map((v) => ({
      variable: v,
      score: scoreVariableRelevance(v.name, propertyName),
    }));

    // Filter out score 0 (not relevant) and sort by score (higher first)
    const filteredAndSorted = scoredVars
      .filter((sv) => sv.score !== 0)
      .sort((a, b) => {
        // Sort by score (descending)
        if (a.score !== b.score) {
          return b.score - a.score;
        }
        // Same score: alphabetical order
        return a.variable.name.localeCompare(b.variable.name);
      });

    return filteredAndSorted.map((sv) => ({
      label: sv.variable.name,
      kind: CompletionItemKind.Variable,
      detail: sv.variable.value,
      documentation: `Defined in ${formatUriForDisplay(sv.variable.uri, {
        mode: runtimeConfig.pathDisplayMode,
        abbrevLength: runtimeConfig.pathDisplayAbbrevLength,
        workspaceFolderPaths,
        rootFolderPath,
      })}`,
      insertText: sv.variable.name,
    }));
  },
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
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

  if (word.startsWith("--")) {
    const variables = cssVariableManager.getVariables(word);
    if (variables.length === 0) {
      return undefined;
    }

    // Get all usages to find context if hovering over a usage
    const usages = cssVariableManager.getVariableUsages(word);
    const hoverUsage = usages.find(
      (u) =>
        document.positionAt(document.offsetAt(u.range.start)) ===
          params.position ||
        (offset >= document.offsetAt(u.range.start) &&
          offset <= document.offsetAt(u.range.end)),
    );

    const usageContext = hoverUsage?.usageContext || "";
    const isInlineStyle = usageContext === "inline-style";

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

      // Inline styles win over non-inline styles
      const aInline = a.inline ?? false;
      const bInline = b.inline ?? false;
      if (aInline !== bInline) {
        return aInline ? -1 : 1;
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
      hoverText += `**Source:** \`${formatUriForDisplay(v.uri, {
        mode: runtimeConfig.pathDisplayMode,
        abbrevLength: runtimeConfig.pathDisplayAbbrevLength,
        workspaceFolderPaths,
        rootFolderPath,
      })}\`\n\n`;

      if (v.selector) {
        hoverText += `**Defined in:** \`${v.selector}\`\n`;
        hoverText += `**Specificity:** ${formatSpecificity(
          calculateSpecificity(v.selector),
        )}\n`;
      }
    } else {
      // Multiple definitions - show full cascade
      hoverText += "**Definitions** (CSS cascade order):\n\n";

      sortedVars.forEach((v, index) => {
        const spec = calculateSpecificity(v.selector);
        // Use DOM-aware matching if available, otherwise fall back to simple matching
        const isApplicable = usageContext
          ? matchesContext(v.selector, usageContext, domTree, domNode)
          : true;
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
            line += " ✓ **Wins (!important)**";
          } else if (isInlineStyle) {
            line += " ✓ **Would apply (inline style)**";
          } else if (domTree && domNode) {
            line += " ✓ **Applies (DOM match)**";
          } else {
            line += " ✓ **Applies here**";
          }
        } else if (!isApplicable && usageContext && !isInlineStyle) {
          line += " _(selector doesn't match)_";
        } else if (index > 0 && usageContext) {
          // Explain why it doesn't win
          const winner = sortedVars[0];
          if (winner.important && !v.important) {
            line += " _(overridden by !important)_";
          } else {
            const winnerSpec = calculateSpecificity(winner.selector);
            const cmp = compareSpecificity(winnerSpec, spec);
            if (cmp > 0) {
              line += " _(lower specificity)_";
            } else if (cmp === 0) {
              line += " _(earlier in source)_";
            }
          }
        }

        hoverText += line + "\n";
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
        kind: "markdown",
        value: hoverText,
      },
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

  if (word.startsWith("--")) {
    const variables = cssVariableManager.getVariables(word);
    if (variables.length > 0) {
      return {
        uri: variables[0].uri,
        range: variables[0].range,
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

  if (word.startsWith("--")) {
    const references = cssVariableManager.getReferences(word);
    return references.map((ref) => Location.create(ref.uri, ref.range));
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

  if (word.startsWith("--")) {
    const references = cssVariableManager.getReferences(word);
    const changes: { [uri: string]: TextEdit[] } = {};

    for (const ref of references) {
      if (!changes[ref.uri]) {
        changes[ref.uri] = [];
      }

      // Replace just the variable name to preserve formatting/fallbacks
      const editRange = ref.nameRange ?? ref.range;
      const edit: TextEdit = {
        range: editRange,
        newText: params.newName,
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
  return variables.map((v) =>
    DocumentSymbol.create(
      v.name,
      v.value,
      SymbolKind.Variable,
      v.range,
      v.range,
    ),
  );
});

// Workspace symbols handler
connection.onWorkspaceSymbol((params) => {
  const query = params.query.toLowerCase();
  const allVariables = cssVariableManager.getAllDefinitions();

  const filtered = query
    ? allVariables.filter((v) => v.name.toLowerCase().includes(query))
    : allVariables;

  return filtered.map((v) =>
    WorkspaceSymbol.create(v.name, SymbolKind.Variable, v.uri, v.range),
  );
});

// Color Provider: Document Colors
connection.onDocumentColor((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }
  return collectDocumentColors(document, cssVariableManager, {
    enabled: runtimeConfig.enableColorProvider,
    onlyVariables: runtimeConfig.colorOnlyOnVariables,
  });
});

// Color Provider: Color Presentation
connection.onColorPresentation((params) => {
  const color = params.color;
  const range = params.range;
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }
  return collectColorPresentations(
    range,
    color,
    runtimeConfig.enableColorProvider,
  );
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
