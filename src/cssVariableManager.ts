import { Range } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { glob } from "glob";
import * as fs from "fs";
import * as csstree from "css-tree";
import { DOMTree, DOMNodeInfo } from "./domTree";
import { parse } from "node-html-parser";
import { Color } from "vscode-languageserver/node";
import { getNormalizedColorKey, parseColor } from "./colorService";
import { calculateSpecificity, compareSpecificity } from "./specificity";
import * as path from "path";
import { Logger } from "./logger";

export interface CssVariable {
  name: string;
  value: string;
  uri: string;
  range: Range; // Range of the entire declaration (e.g., "--foo: red")
  nameRange?: Range; // Range of just the variable name (e.g., "--foo")
  valueRange?: Range; // Range of just the value part (e.g., "red")
  selector: string; // CSS selector where this variable is defined (e.g., ":root", "div", ".class")
  important: boolean; // Whether this definition uses !important
  inline?: boolean; // Whether this definition is from an inline style attribute
  sourcePosition: number; // Character position in file (for source order)
}

export interface CssVariableUsage {
  name: string;
  uri: string;
  range: Range;
  nameRange?: Range;
  usageContext: string; // CSS selector where this variable is used
  domNode?: DOMNodeInfo; // DOM node if usage is in HTML
}

export interface CssColorLiteral {
  uri: string;
  range: Range;
  value: string;
  color: Color;
  propertyName: string;
  variableName?: string;
}

const DEFAULT_LOOKUP_FILES = [
  "**/*.css",
  "**/*.scss",
  "**/*.sass",
  "**/*.less",
  "**/*.html",
  "**/*.vue",
  "**/*.svelte",
  "**/*.astro",
  "**/*.ripple",
];

const DEFAULT_IGNORE_GLOBS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/out/**",
  "**/.git/**",
];

const EXTENSION_LANGUAGE_MAP = new Map<string, string>([
  [".css", "css"],
  [".scss", "scss"],
  [".sass", "sass"],
  [".less", "less"],
  [".html", "html"],
  [".vue", "html"],
  [".svelte", "html"],
  [".astro", "html"],
  [".ripple", "html"],
]);

export const HTML_LIKE_LANGUAGE_IDS = new Set([
  "html",
  "vue",
  "svelte",
  "astro",
  "ripple",
]);

export const CSS_LANGUAGE_IDS = new Set(["css", "scss", "sass", "less"]);

function normalizeGlobPattern(pattern: string): string {
  return pattern.replace(/\\/g, "/").trim();
}

function normalizeGlobList(globs?: string[]): string[] | undefined {
  if (!globs) {
    return undefined;
  }
  return globs
    .map((glob) => normalizeGlobPattern(glob))
    .filter((glob) => glob.length > 0);
}

function extractExtensions(pattern: string): string[] {
  const braceMatch = pattern.match(/\{([^}]+)\}/);
  if (braceMatch) {
    return braceMatch[1]
      .split(",")
      .map((ext) => ext.trim())
      .filter(Boolean)
      .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`));
  }

  const ext = path.extname(pattern);
  return ext ? [ext] : [];
}

function normalizeUri(uri: string): string {
  try {
    return URI.parse(uri).toString().toLowerCase();
  } catch (e) {
    return uri.toLowerCase();
  }
}

export class CssVariableManager {
  private variables: Map<string, CssVariable[]> = new Map();
  private usages: Map<string, CssVariableUsage[]> = new Map();
  private colorLiterals: Map<string, Map<number, CssColorLiteral[]>> = new Map();
  private domTrees: Map<string, DOMTree> = new Map(); // URI -> DOM tree
  private colorIndex: Map<string, Set<string>> = new Map(); // color key -> variable names
  private colorIndexDirty: boolean = true;
  private logger: Logger;
  private lookupFiles: string[];
  private ignoreGlobs: string[];
  private lookupExtensions: Map<string, string>;

  constructor(logger: Logger, lookupFiles?: string[], ignoreGlobs?: string[]) {
    this.logger = logger;
    const normalizedLookupFiles = normalizeGlobList(lookupFiles);
    const normalizedIgnoreGlobs = normalizeGlobList(ignoreGlobs);

    this.lookupFiles =
      normalizedLookupFiles && normalizedLookupFiles.length > 0
        ? normalizedLookupFiles
        : DEFAULT_LOOKUP_FILES;
    this.ignoreGlobs =
      normalizedIgnoreGlobs && normalizedIgnoreGlobs.length > 0
        ? normalizedIgnoreGlobs
        : DEFAULT_IGNORE_GLOBS;
    this.lookupExtensions = this.buildLookupExtensions(this.lookupFiles);
  }

  private buildLookupExtensions(lookupFiles: string[]): Map<string, string> {
    const extensions = new Map<string, string>();
    for (const pattern of lookupFiles) {
      for (const ext of extractExtensions(pattern)) {
        const languageId = EXTENSION_LANGUAGE_MAP.get(ext) ?? "css";
        extensions.set(ext, languageId);
      }
    }
    return extensions;
  }

  /**
   * Rebuild the color index for O(1) color lookups.
   * Should be called when variables change.
   */
  private rebuildColorIndex(): void {
    this.colorIndex.clear();
    
    for (const name of this.variables.keys()) {
      const resolvedColor = this.resolveVariableColor(name);
      if (resolvedColor) {
        const key = getNormalizedColorKey(resolvedColor);
        if (!this.colorIndex.has(key)) {
          this.colorIndex.set(key, new Set());
        }
        this.colorIndex.get(key)!.add(name);
      }
    }
    
    this.colorIndexDirty = false;
  }
  /**
   * Ensure the color index is up to date.
   */
  private ensureColorIndex(): void {
    if (this.colorIndexDirty) {
      this.rebuildColorIndex();
    }
  }

  private resolveLanguageId(filePath: string): string | null {
    const ext = path.extname(filePath);
    if (!ext) {
      return null;
    }
    return this.lookupExtensions.get(ext) ?? null;
  }

  private resolveDocumentLanguageId(languageId: string, uri: string): string {
    if (HTML_LIKE_LANGUAGE_IDS.has(languageId)) {
      return "html";
    }

    if (CSS_LANGUAGE_IDS.has(languageId)) {
      return languageId;
    }

    const filePath = URI.parse(uri).fsPath;
    return this.resolveLanguageId(filePath) ?? languageId;
  }

  /**
   * Scan all CSS and HTML files in the workspace
   * @param workspaceFolders Array of workspace folder URIs
   * @param onProgress Optional callback for progress updates (current, total)
   */
  public async scanWorkspace(
    workspaceFolders: string[],
    onProgress?: (current: number, total: number) => void
  ): Promise<void> {
    // First, collect all files from all folders
    const allFiles: string[] = [];

    for (const folder of workspaceFolders) {
      const folderUri = URI.parse(folder);
      const folderPath = folderUri.fsPath;

      // Find all CSS and HTML-like files based on lookup globs
      const files = await glob(this.lookupFiles, {
        cwd: folderPath,
        ignore: this.ignoreGlobs,
        absolute: true,
      });

      this.logger.debug("scanFolder", { folder, fileCount: files.length });
      allFiles.push(...files);
    }

    const totalFiles = allFiles.length;
    let processedFiles = 0;

    // Parse each file with progress reporting
    for (const filePath of allFiles) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const fileUri = URI.file(filePath).toString();

        const languageId = this.resolveLanguageId(filePath);
        if (!languageId) {
          continue;
        }

        this.parseContent(content, fileUri, languageId);
      } catch (error) {
        this.logger.error("scanFileError", { filePath, error: String(error) });
      }

      processedFiles++;

      // Report progress every 10 files or at the end
      if (
        onProgress &&
        (processedFiles % 10 === 0 || processedFiles === totalFiles)
      ) {
        onProgress(processedFiles, totalFiles);
      }
    }

    this.logger.debug("workspaceScanComplete", { totalFiles });
  }

  public parseDocument(document: TextDocument): void {
    this.parseContent(document.getText(), document.uri, document.languageId);
  }

  public parseContent(text: string, uri: string, languageId: string): void {
    const normalizedUri = normalizeUri(uri);
    this.removeFile(normalizedUri);

    const resolvedLanguageId = this.resolveDocumentLanguageId(
      languageId,
      normalizedUri
    );

    if (resolvedLanguageId === "html") {
      // Build DOM tree for HTML documents
      try {
        const domTree = new DOMTree(text);
        this.domTrees.set(uri, domTree);
      } catch (error) {
        this.logger.error("parseHtmlError", { uri, error: String(error) });
      }

      // Use node-html-parser to extract style blocks and inline styles
      try {
        const root = parse(text, {
          lowerCaseTagName: true,
          comment: false, // Automatically ignores comments
          blockTextElements: {
            script: true,
            noscript: true,
            style: true, // Keep style as block text so we can extract content
          },
        });

        const document = TextDocument.create(uri, resolvedLanguageId, 1, text);

        // Parse <style> blocks
        const styleElements = root.querySelectorAll("style");
        for (const styleEl of styleElements) {
          const styleContent = styleEl.textContent;
          if (styleContent && styleEl.range) {
            // Calculate the offset where the CSS content starts
            // styleEl.range gives us the full element from '<style>' to '</style>'
            // We need to find where the content starts (after the opening tag)
            const elementText = text.substring(
              styleEl.range[0],
              styleEl.range[1]
            );
            const openingTagEnd = elementText.indexOf(">") + 1;
            const styleStartOffset = styleEl.range[0] + openingTagEnd;

            this.parseCssText(styleContent, uri, document, styleStartOffset);
          }
        }

        // Parse inline style attributes
        const elementsWithStyle = root.querySelectorAll("[style]");
        for (const el of elementsWithStyle) {
          const styleAttr = el.getAttribute("style");
          if (styleAttr && el.range) {
            // Find the position of the style attribute value in the original text
            const elementText = text.substring(el.range[0], el.range[1]);
            const styleAttrStart = elementText.indexOf("style");
            if (styleAttrStart !== -1) {
              // Find where the attribute value starts (after the opening quote)
              const valueStart = elementText.indexOf(styleAttr, styleAttrStart);
              if (valueStart !== -1) {
                const styleStartOffset = el.range[0] + valueStart;
                const attributeOffset = el.range[0] + styleAttrStart;
                this.parseInlineStyle(
                  styleAttr,
                  uri,
                  document,
                  styleStartOffset,
                  attributeOffset
                );
              }
            }
          }
        }
      } catch (error) {
        this.logger.error("parseHtmlContentError", { uri, error: String(error) });
      }
    } else {
      // CSS, SCSS, SASS, LESS
      const document = TextDocument.create(uri, resolvedLanguageId, 1, text);
      this.parseCssText(text, uri, document, 0);
    }
  }

  private parseCssText(
    text: string,
    uri: string,
    document: TextDocument,
    offset: number
  ): void {
    try {
      const ast = csstree.parse(text, {
        positions: true,
        onParseError: (error) => {
          this.logger.debug("cssParseError", { uri, error: error.message });
        },
      });

      const selectorStack: string[] = [];

      csstree.walk(ast, {
        enter: (node: csstree.CssNode) => {
          if (node.type === "Rule") {
            let selector = "";
            if (node.prelude && node.prelude.type === "Raw") {
              // Clean up raw selector if possible, or just take it
              selector = node.prelude.value;
            } else if (node.prelude) {
              selector = csstree.generate(node.prelude);
            }
            selectorStack.push(selector);
          }

          if (node.type === "Declaration" && node.property.startsWith("--")) {
            const name = node.property;
            const value = csstree.generate(node.value).trim();
            const important =
              node.important === true || node.important === "important";
            const selector =
              selectorStack.length > 0
                ? selectorStack[selectorStack.length - 1]
                : ":root";

            if (node.loc) {
              const startPos = document.positionAt(
                offset + node.loc.start.offset
              );
              const endPos = document.positionAt(offset + node.loc.end.offset);

              const declarationText = text.substring(
                node.loc.start.offset,
                node.loc.end.offset
              );
              const colonIndex = declarationText.indexOf(":");
              const declarationHeader =
                colonIndex >= 0
                  ? declarationText.slice(0, colonIndex)
                  : declarationText;
              const nameMatch = declarationHeader.match(/--[\w-]+/);
              let nameRange: Range | undefined;
              if (nameMatch && nameMatch.index !== undefined) {
                const nameStartOffset =
                  offset + node.loc.start.offset + nameMatch.index;
                const nameEndOffset = nameStartOffset + nameMatch[0].length;
                nameRange = Range.create(
                  document.positionAt(nameStartOffset),
                  document.positionAt(nameEndOffset)
                );
              }

              // Capture valueRange from node.value location
              let valueRange: Range | undefined;
              if (node.value && node.value.loc) {
                // Get the raw text from the value node
                const valueStartOffset = offset + node.value.loc.start.offset;
                const valueEndOffset = offset + node.value.loc.end.offset;
                const rawValueText = text.substring(
                  valueStartOffset,
                  valueEndOffset
                );

                // Trim leading/trailing whitespace to get the actual value position
                const leadingWhitespace =
                  rawValueText.length - rawValueText.trimStart().length;
                const trailingWhitespace =
                  rawValueText.length - rawValueText.trimEnd().length;

                const valueStartPos = document.positionAt(
                  valueStartOffset + leadingWhitespace
                );
                const valueEndPos = document.positionAt(
                  valueEndOffset - trailingWhitespace
                );
                valueRange = Range.create(valueStartPos, valueEndPos);
              }

              const variable: CssVariable = {
                name,
                value,
                uri,
                range: Range.create(startPos, endPos),
                nameRange,
                valueRange,
                selector,
                important,
                inline: false,
                sourcePosition: offset + node.loc.start.offset,
              };

              if (!this.variables.has(name)) {
                this.variables.set(name, []);
              }
              this.variables.get(name)?.push(variable);
              this.colorIndexDirty = true;
            }
          }

          if (node.type === "Declaration" && node.value) {
            this.collectColorLiteralsFromDeclaration(
              node,
              uri,
              document,
              text,
              offset
            );
          }

          if (node.type === "Function" && node.name === "var") {
            const children = node.children;
            if (children && children.first) {
              const firstChild = children.first;
              // Handle var(--name) or var(--name, fallback)
              // In csstree, --name is an Identifier
              if (
                firstChild.type === "Identifier" &&
                firstChild.name.startsWith("--")
              ) {
                const name = firstChild.name;
                const usageContext =
                  selectorStack.length > 0
                    ? selectorStack[selectorStack.length - 1]
                    : "";

                if (node.loc) {
                  const startPos = document.positionAt(
                    offset + node.loc.start.offset
                  );
                  const endPos = document.positionAt(
                    offset + node.loc.end.offset
                  );
                  let nameRange: Range | undefined;
                  if (firstChild.loc) {
                    const nameStartOffset =
                      offset + firstChild.loc.start.offset;
                    const nameEndOffset = offset + firstChild.loc.end.offset;
                    nameRange = Range.create(
                      document.positionAt(nameStartOffset),
                      document.positionAt(nameEndOffset)
                    );
                  }

                  const usage: CssVariableUsage = {
                    name,
                    uri,
                    range: Range.create(startPos, endPos),
                    nameRange,
                    usageContext,
                  };

                  if (!this.usages.has(name)) {
                    this.usages.set(name, []);
                  }
                  this.usages.get(name)?.push(usage);
                }
              }
            }
          }
        },
        leave: (node: csstree.CssNode) => {
          if (node.type === "Rule") {
            selectorStack.pop();
          }
        },
      });
    } catch (e) {
      this.logger.error("parseCssError", { uri, error: String(e) });
    }
  }

  /**
   * Parse inline style attributes for variable usages.
   * Inline styles don't have selectors, they apply directly to elements (highest specificity).
   */
  private parseInlineStyle(
    text: string,
    uri: string,
    document: TextDocument,
    offset: number,
    attributeOffset: number
  ): void {
    try {
      const ast = csstree.parse(text, {
        context: "declarationList",
        positions: true,
        onParseError: (error) => {
          this.logger.debug("inlineStyleParseError", { uri, error: error.message });
        },
      });

      csstree.walk(ast, {
        enter: (node: csstree.CssNode) => {
          if (node.type === "Declaration" && node.property.startsWith("--")) {
            const name = node.property;
            const value = csstree.generate(node.value).trim();
            const important =
              node.important === true || node.important === "important";

            if (node.loc) {
              const startPos = document.positionAt(
                offset + node.loc.start.offset
              );
              const endPos = document.positionAt(offset + node.loc.end.offset);

              const declarationText = text.substring(
                node.loc.start.offset,
                node.loc.end.offset
              );
              const colonIndex = declarationText.indexOf(":");
              const declarationHeader =
                colonIndex >= 0
                  ? declarationText.slice(0, colonIndex)
                  : declarationText;
              const nameMatch = declarationHeader.match(/--[\w-]+/);
              let nameRange: Range | undefined;
              if (nameMatch && nameMatch.index !== undefined) {
                const nameStartOffset =
                  offset + node.loc.start.offset + nameMatch.index;
                const nameEndOffset = nameStartOffset + nameMatch[0].length;
                nameRange = Range.create(
                  document.positionAt(nameStartOffset),
                  document.positionAt(nameEndOffset)
                );
              }

              let valueRange: Range | undefined;
              if (node.value && node.value.loc) {
                const valueStartOffset = offset + node.value.loc.start.offset;
                const valueEndOffset = offset + node.value.loc.end.offset;
                const rawValueText = text.substring(
                  node.value.loc.start.offset,
                  node.value.loc.end.offset
                );
                const leadingWhitespace =
                  rawValueText.length - rawValueText.trimStart().length;
                const trailingWhitespace =
                  rawValueText.length - rawValueText.trimEnd().length;
                const valueStartPos = document.positionAt(
                  valueStartOffset + leadingWhitespace
                );
                const valueEndPos = document.positionAt(
                  valueEndOffset - trailingWhitespace
                );
                valueRange = Range.create(valueStartPos, valueEndPos);
              }

              const variable: CssVariable = {
                name,
                value,
                uri,
                range: Range.create(startPos, endPos),
                nameRange,
                valueRange,
                selector: "inline-style",
                important,
                inline: true,
                sourcePosition: offset + node.loc.start.offset,
              };

              if (!this.variables.has(name)) {
                this.variables.set(name, []);
              }
              this.variables.get(name)?.push(variable);
              this.colorIndexDirty = true;
            }
          }

          if (node.type === "Declaration" && node.value) {
            this.collectColorLiteralsFromDeclaration(
              node,
              uri,
              document,
              text,
              offset
            );
          }

          if (node.type === "Function" && node.name === "var") {
            const children = node.children;
            if (children && children.first) {
              const firstChild = children.first;
              if (
                firstChild.type === "Identifier" &&
                firstChild.name.startsWith("--")
              ) {
                const name = firstChild.name;

                if (node.loc) {
                  const startPos = document.positionAt(
                    offset + node.loc.start.offset
                  );
                  const endPos = document.positionAt(
                    offset + node.loc.end.offset
                  );
                  let nameRange: Range | undefined;
                  if (firstChild.loc) {
                    const nameStartOffset =
                      offset + firstChild.loc.start.offset;
                    const nameEndOffset = offset + firstChild.loc.end.offset;
                    nameRange = Range.create(
                      document.positionAt(nameStartOffset),
                      document.positionAt(nameEndOffset)
                    );
                  }

                  // Try to find the DOM node for this inline style
                  const domTree = this.domTrees.get(uri);
                  // Use the attributeOffset (start of 'style="...') to find the correct DOM node
                  const domNode = domTree?.findNodeAtPosition(attributeOffset);

                  const usage: CssVariableUsage = {
                    name,
                    uri,
                    range: Range.create(startPos, endPos),
                    nameRange,
                    usageContext: "inline-style",
                    domNode: domNode,
                  };

                  if (!this.usages.has(name)) {
                    this.usages.set(name, []);
                  }
                  this.usages.get(name)?.push(usage);
                }
              }
            }
          }
        },
      });
    } catch (e) {
      this.logger.error("parseInlineStyleError", { uri, error: String(e) });
    }
  }

  private collectColorLiteralsFromDeclaration(
    declaration: csstree.Declaration,
    uri: string,
    document: TextDocument,
    text: string,
    offset: number
  ): void {
    const lineMap = this.colorLiterals.get(normalizeUri(uri)) || new Map<number, CssColorLiteral[]>();

    this.collectColorLiteralsFromValue(
      declaration.value,
      uri,
      document,
      text,
      offset,
      declaration.property,
      lineMap
    );

    if (declaration.value.type === "Raw" && declaration.value.loc) {
      try {
        const rawAst = csstree.parse(declaration.value.value, {
          context: "value",
          positions: true,
        });
        this.collectColorLiteralsFromValue(
          rawAst,
          uri,
          document,
          declaration.value.value,
          offset + declaration.value.loc.start.offset,
          declaration.property,
          lineMap
        );
      } catch (error) {
        this.logger.debug("rawValueParseError", { uri, error: String(error) });
      }
    }

    this.colorLiterals.set(normalizeUri(uri), lineMap);
  }

  private collectColorLiteralsFromValue(
    valueNode: csstree.CssNode,
    uri: string,
    document: TextDocument,
    sourceText: string,
    baseOffset: number,
    propertyName: string,
    lineMap: Map<number, CssColorLiteral[]>
  ): void {
    csstree.walk(valueNode, {
      enter: (node: csstree.CssNode) => {
        if (node.type === "Function" && node.name === "var") {
          return csstree.walk.skip;
        }

        if (
          node.type !== "Hash" &&
          node.type !== "Function" &&
          node.type !== "Identifier"
        ) {
          return;
        }

        if (!node.loc) {
          return;
        }

        const value = csstree.generate(node).trim();
        const color = parseColor(value, { allowNamedColors: true });
        if (!color) {
          return;
        }

        const rawValueText = sourceText.substring(
          node.loc.start.offset,
          node.loc.end.offset
        );
        const leadingWhitespace =
          rawValueText.length - rawValueText.trimStart().length;
        const trailingWhitespace =
          rawValueText.length - rawValueText.trimEnd().length;

        const startOffset =
          baseOffset + node.loc.start.offset + leadingWhitespace;
        const endOffset = baseOffset + node.loc.end.offset - trailingWhitespace;

        const range = Range.create(
          document.positionAt(startOffset),
          document.positionAt(endOffset)
        );

        const line = range.start.line;
        if (!lineMap.has(line)) {
          lineMap.set(line, []);
        }
        lineMap.get(line)!.push({
          uri,
          range,
          value,
          color,
          propertyName,
          variableName: propertyName.startsWith("--") ? propertyName : undefined,
        });
      },
    });
  }

  public async updateFile(uri: string): Promise<void> {
    try {
      const filePath = URI.parse(uri).fsPath;
      if (!fs.existsSync(filePath)) {
        this.logger.debug("fileNotFound", { uri });
        this.removeFile(uri);
        return;
      }

      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        return;
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const languageId = this.resolveLanguageId(filePath);
      if (!languageId) {
        // Skip unsupported file types
        return;
      }

      this.parseContent(content, uri, languageId);
      this.logger.debug("fileUpdatedFromDisk", { uri });
    } catch (error) {
      this.logger.error("fileUpdateError", { uri, error: String(error) });
    }
  }

  public removeFile(uri: string): void {
    const normalizedUri = normalizeUri(uri);
    this.clearDocumentVariables(normalizedUri);
    this.clearDocumentUsages(normalizedUri);
    this.clearDocumentColorLiterals(normalizedUri);
    this.clearDocumentDOMTree(normalizedUri);
  }

  public clearDocumentVariables(uri: string): void {
    const normalizedUri = normalizeUri(uri);
    for (const [name, vars] of this.variables.entries()) {
      const filtered = vars.filter(
        (v) => normalizeUri(v.uri) !== normalizedUri
      );
      if (filtered.length === 0) {
        this.variables.delete(name);
      } else if (filtered.length !== vars.length) {
        this.variables.set(name, filtered);
      }
    }
    this.colorIndexDirty = true;
  }
  public clearDocumentUsages(uri: string): void {
    const normalizedUri = normalizeUri(uri);
    for (const [name, usgs] of this.usages.entries()) {
      const filtered = usgs.filter(
        (u) => normalizeUri(u.uri) !== normalizedUri
      );
      if (filtered.length === 0) {
        this.usages.delete(name);
      } else if (filtered.length !== usgs.length) {
        this.usages.set(name, filtered);
      }
    }
  }

  public clearDocumentColorLiterals(uri: string): void {
    this.colorLiterals.delete(normalizeUri(uri));
  }

  public clearDocumentDOMTree(uri: string): void {
    this.domTrees.delete(uri);
  }

  public getAllVariables(): CssVariable[] {
    const allVars: CssVariable[] = [];
    for (const vars of this.variables.values()) {
      allVars.push(...vars);
    }
    // this.logger.log(`[css-lsp] getAllVariables: returning ${allVars.length} variables`);
    return allVars;
  }

  public getVariables(name: string): CssVariable[] {
    return this.variables.get(name) || [];
  }

  public getVariableUsages(name: string): CssVariableUsage[] {
    return this.usages.get(name) || [];
  }

  public getDocumentColorLiterals(uri: string): CssColorLiteral[] {
    const lineMap = this.colorLiterals.get(normalizeUri(uri));
    if (!lineMap) { return []; }
    return Array.from(lineMap.values()).flat();
  }

  public getDocumentColorLiteralsByLine(uri: string, line: number): CssColorLiteral[] {
    return this.colorLiterals.get(normalizeUri(uri))?.get(line) ?? [];
  }

  /**
   * Get all references (definitions + usages) for a variable
   */
  public getReferences(name: string): Array<CssVariable | CssVariableUsage> {
    const definitions = this.getVariables(name);
    const usages = this.getVariableUsages(name);
    return [...definitions, ...usages];
  }

  /**
   * Get all variable definitions across the workspace (for workspace symbols)
   */
  public getAllDefinitions(): CssVariable[] {
    return this.getAllVariables();
  }

  /**
   * Get all variable definitions in a specific document (for document symbols)
   */
  public getDocumentDefinitions(uri: string): CssVariable[] {
    const normalizedUri = normalizeUri(uri);
    const allVars = this.getAllVariables();
    return allVars.filter((v) => normalizeUri(v.uri) === normalizedUri);
  }

  /**
   * Get the DOM tree for a document (if it's HTML)
   */
  public getDOMTree(uri: string): DOMTree | undefined {
    return this.domTrees.get(uri);
  }

  public getVariablesByColor(
    color: Color,
    options: { excludeName?: string } = {}
  ): CssVariable[] {
    this.ensureColorIndex();
    const key = getNormalizedColorKey(color);
    const names = this.colorIndex.get(key) || new Set();
    
    const matches: CssVariable[] = [];
    for (const name of names) {
      if (options.excludeName && name === options.excludeName) {
        continue;
      }
      const winningDefinition = this.getWinningVariableDefinition(name);
      if (winningDefinition) {
        matches.push(winningDefinition);
      }
    }
    
    return matches.toSorted((a, b) => a.name.localeCompare(b.name));
  }
  /**
   * Resolve a variable name to a Color if possible.
   * Handles recursive variable references: var(--a) -> var(--b) -> #fff
   * Uses CSS cascade rules: !important > specificity > source order
   */
  public resolveVariableColor(
    name: string,
    context?: string,
    seen = new Set<string>()
  ): Color | null {
    if (seen.has(name)) {
      return null; // Cycle detected
    }
    seen.add(name);

    const variables = this.getVariables(name);
    if (variables.length === 0) {
      return null;
    }

    // Apply CSS cascade rules to find the winning definition
    // Sort by cascade rules: !important > specificity > source order
    const variable = this.getWinningVariableDefinition(name);
    if (!variable) {
      return null;
    }
    let value = variable.value;

    // Check if it's a reference to another variable
    const recursiveMatch = value.match(
      /var\(\s*(--[\w-]+)\s*(?:,\s*[^)]+)?\s*\)/
    );
    if (recursiveMatch) {
      return this.resolveVariableColor(recursiveMatch[1], context, seen);
    }

    return parseColor(value, { allowNamedColors: true });
  }

  private getWinningVariableDefinition(name: string): CssVariable | null {
    const variables = this.getVariables(name);
    if (variables.length === 0) {
      return null;
    }

    return [...variables].sort((a, b) => {
      if (a.important !== b.important) {
        return a.important ? -1 : 1;
      }

      const aInline = a.inline ?? false;
      const bInline = b.inline ?? false;
      if (aInline !== bInline) {
        return aInline ? -1 : 1;
      }

      const specA = calculateSpecificity(a.selector);
      const specB = calculateSpecificity(b.selector);
      const specCompare = compareSpecificity(specA, specB);

      if (specCompare !== 0) {
        return -specCompare;
      }

      return b.sourcePosition - a.sourcePosition;
    })[0];
  }
}
