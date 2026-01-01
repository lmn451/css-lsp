import { Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { glob } from 'glob';
import * as fs from 'fs';
import * as csstree from 'css-tree';
import { DOMTree, DOMNodeInfo } from './domTree';
import { parse, HTMLElement as ParsedHTMLElement } from 'node-html-parser';
import { Color } from 'vscode-languageserver/node';
import { parseColor } from './colorService';
import { calculateSpecificity, compareSpecificity } from './specificity';

export interface CssVariable {
	name: string;
	value: string;
	uri: string;
	range: Range; // Range of the entire declaration (e.g., "--foo: red")
	valueRange?: Range; // Range of just the value part (e.g., "red")
	selector: string; // CSS selector where this variable is defined (e.g., ":root", "div", ".class")
	important: boolean; // Whether this definition uses !important
	sourcePosition: number; // Character position in file (for source order)
}

export interface CssVariableUsage {
	name: string;
	uri: string;
	range: Range;
	usageContext: string; // CSS selector where this variable is used
	domNode?: DOMNodeInfo; // DOM node if usage is in HTML
}

export interface Logger {
	log(message: string): void;
	error(message: string): void;
}

export class CssVariableManager {
	private variables: Map<string, CssVariable[]> = new Map();
	private usages: Map<string, CssVariableUsage[]> = new Map();
	private domTrees: Map<string, DOMTree> = new Map(); // URI -> DOM tree
	private logger: Logger;

	constructor(logger?: Logger) {
		this.logger = logger || {
			log: (message: string) => {
				// Only log to console in debug mode
				if (process.env.CSS_LSP_DEBUG) {
					console.log(message);
				}
			},
			error: (message: string) => {
				// Always log errors
				console.error(message);
			}
		};
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

			// Find all CSS, SCSS, SASS, LESS and HTML files
			const files = await glob('**/*.{css,scss,sass,less,html}', {
				cwd: folderPath,
				ignore: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/.git/**'],
				absolute: true
			});

			this.logger.log(`[css-lsp] Scanned ${folder}: found ${files.length} files`);
			allFiles.push(...files);
		}

		const totalFiles = allFiles.length;
		let processedFiles = 0;

		// Parse each file with progress reporting
		for (const filePath of allFiles) {
			try {
				const content = fs.readFileSync(filePath, 'utf-8');
				const fileUri = URI.file(filePath).toString();

				let languageId = 'css';
				if (filePath.endsWith('.html')) {
					languageId = 'html';
				} else if (filePath.endsWith('.scss')) {
					languageId = 'scss';
				} else if (filePath.endsWith('.sass')) {
					languageId = 'sass';
				} else if (filePath.endsWith('.less')) {
					languageId = 'less';
				}

				this.parseContent(content, fileUri, languageId);
			} catch (error) {
				this.logger.error(`[css-lsp] Error scanning file ${filePath}: ${error}`);
			}

			processedFiles++;

			// Report progress every 10 files or at the end
			if (onProgress && (processedFiles % 10 === 0 || processedFiles === totalFiles)) {
				onProgress(processedFiles, totalFiles);
			}
		}

		this.logger.log(`[css-lsp] Workspace scan complete. Processed ${totalFiles} files.`);
	}

	public parseDocument(document: TextDocument): void {
		this.parseContent(document.getText(), document.uri, document.languageId);
	}

	public parseContent(text: string, uri: string, languageId: string): void {
		// Clear existing variables and usages for this document
		this.removeFile(uri);

		if (languageId === 'html') {
			// Build DOM tree for HTML documents
			try {
				const domTree = new DOMTree(text);
				this.domTrees.set(uri, domTree);
			} catch (error) {
				this.logger.error(`Error parsing HTML for ${uri}: ${error}`);
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
					}
				});

				const document = TextDocument.create(uri, languageId, 1, text);

				// Parse <style> blocks
				const styleElements = root.querySelectorAll('style');
				for (const styleEl of styleElements) {
					const styleContent = styleEl.textContent;
					if (styleContent && styleEl.range) {
						// Calculate the offset where the CSS content starts
						// styleEl.range gives us the full element from '<style>' to '</style>'
						// We need to find where the content starts (after the opening tag)
						const elementText = text.substring(styleEl.range[0], styleEl.range[1]);
						const openingTagEnd = elementText.indexOf('>') + 1;
						const styleStartOffset = styleEl.range[0] + openingTagEnd;

						this.parseCssText(styleContent, uri, document, styleStartOffset);
					}
				}

				// Parse inline style attributes
				const elementsWithStyle = root.querySelectorAll('[style]');
				for (const el of elementsWithStyle) {
					const styleAttr = el.getAttribute('style');
					if (styleAttr && el.range) {
						// Find the position of the style attribute value in the original text
						const elementText = text.substring(el.range[0], el.range[1]);
						const styleAttrStart = elementText.indexOf('style');
						if (styleAttrStart !== -1) {
							// Find where the attribute value starts (after the opening quote)
							const valueStart = elementText.indexOf(styleAttr, styleAttrStart);
							if (valueStart !== -1) {
								const styleStartOffset = el.range[0] + valueStart;
								const attributeOffset = el.range[0] + styleAttrStart;
								this.parseInlineStyle(styleAttr, uri, document, styleStartOffset, attributeOffset);
							}
						}
					}
				}
			} catch (error) {
				this.logger.error(`Error parsing HTML content for ${uri}: ${error}`);
			}
		} else {
			// CSS, SCSS, SASS, LESS
			const document = TextDocument.create(uri, languageId, 1, text);
			this.parseCssText(text, uri, document, 0);
		}
	}

	private parseCssText(text: string, uri: string, document: TextDocument, offset: number): void {
		try {
			const ast = csstree.parse(text, {
				positions: true,
				onParseError: (error) => {
					this.logger.log(`[css-lsp] CSS Parse Error in ${uri}: ${error.message}`);
				}
			});

			const selectorStack: string[] = [];

			csstree.walk(ast, {
				enter: (node: csstree.CssNode) => {
					if (node.type === 'Rule') {
						let selector = '';
						if (node.prelude && node.prelude.type === 'Raw') {
							// Clean up raw selector if possible, or just take it
							selector = node.prelude.value;
						} else if (node.prelude) {
							selector = csstree.generate(node.prelude);
						}
						selectorStack.push(selector);
					}

					if (node.type === 'Declaration' && node.property.startsWith('--')) {
						const name = node.property;
						const value = csstree.generate(node.value).trim();
						const important = node.important === true || node.important === 'important';
						const selector = selectorStack.length > 0 ? selectorStack[selectorStack.length - 1] : ':root';

						if (node.loc) {
							const startPos = document.positionAt(offset + node.loc.start.offset);
							const endPos = document.positionAt(offset + node.loc.end.offset);

							// Capture valueRange from node.value location
							let valueRange: Range | undefined;
							if (node.value && node.value.loc) {
								// Get the raw text from the value node
								const valueStartOffset = offset + node.value.loc.start.offset;
								const valueEndOffset = offset + node.value.loc.end.offset;
								const rawValueText = text.substring(valueStartOffset, valueEndOffset);

								// Trim leading/trailing whitespace to get the actual value position
								const leadingWhitespace = rawValueText.length - rawValueText.trimStart().length;
								const trailingWhitespace = rawValueText.length - rawValueText.trimEnd().length;

								const valueStartPos = document.positionAt(valueStartOffset + leadingWhitespace);
								const valueEndPos = document.positionAt(valueEndOffset - trailingWhitespace);
								valueRange = Range.create(valueStartPos, valueEndPos);
							}

							const variable: CssVariable = {
								name,
								value,
								uri,
								range: Range.create(startPos, endPos),
								valueRange,
								selector,
								important,
								sourcePosition: offset + node.loc.start.offset
							};

							if (!this.variables.has(name)) {
								this.variables.set(name, []);
							}
							this.variables.get(name)?.push(variable);
						}
					}

					if (node.type === 'Function' && node.name === 'var') {
						const children = node.children;
						if (children && children.first) {
							const firstChild = children.first;
							// Handle var(--name) or var(--name, fallback)
							// In csstree, --name is an Identifier
							if (firstChild.type === 'Identifier' && firstChild.name.startsWith('--')) {
								const name = firstChild.name;
								const usageContext = selectorStack.length > 0 ? selectorStack[selectorStack.length - 1] : '';

								if (node.loc) {
									const startPos = document.positionAt(offset + node.loc.start.offset);
									const endPos = document.positionAt(offset + node.loc.end.offset);

									const usage: CssVariableUsage = {
										name,
										uri,
										range: Range.create(startPos, endPos),
										usageContext
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
					if (node.type === 'Rule') {
						selectorStack.pop();
					}
				}
			});
		} catch (e) {
			this.logger.error(`Error parsing CSS in ${uri}: ${e}`);
		}
	}

	/**
	 * Parse inline style attributes for variable usages.
	 * Inline styles don't have selectors, they apply directly to elements (highest specificity).
	 */
	private parseInlineStyle(text: string, uri: string, document: TextDocument, offset: number, attributeOffset: number): void {
		try {
			const ast = csstree.parse(text, {
				context: 'declarationList',
				positions: true,
				onParseError: (error) => {
					this.logger.log(`[css-lsp] Inline Style Parse Error in ${uri}: ${error.message}`);
				}
			});

			csstree.walk(ast, {
				enter: (node: csstree.CssNode) => {
					if (node.type === 'Function' && node.name === 'var') {
						const children = node.children;
						if (children && children.first) {
							const firstChild = children.first;
							if (firstChild.type === 'Identifier' && firstChild.name.startsWith('--')) {
								const name = firstChild.name;

								if (node.loc) {
									const startPos = document.positionAt(offset + node.loc.start.offset);
									const endPos = document.positionAt(offset + node.loc.end.offset);

									// Try to find the DOM node for this inline style
									const domTree = this.domTrees.get(uri);
									// Use the attributeOffset (start of 'style="...') to find the correct DOM node
									const domNode = domTree?.findNodeAtPosition(attributeOffset);

									const usage: CssVariableUsage = {
										name,
										uri,
										range: Range.create(startPos, endPos),
										usageContext: 'inline-style',
										domNode: domNode
									};

									if (!this.usages.has(name)) {
										this.usages.set(name, []);
									}
									this.usages.get(name)?.push(usage);
								}
							}
						}
					}
				}
			});
		} catch (e) {
			this.logger.error(`Error parsing inline style in ${uri}: ${e}`);
		}
	}

	public async updateFile(uri: string): Promise<void> {
		try {
			const filePath = URI.parse(uri).fsPath;
			if (!fs.existsSync(filePath)) {
				this.logger.log(`[css-lsp] File ${uri} does not exist on disk, removing from manager.`);
				this.removeFile(uri);
				return;
			}

			const stat = fs.statSync(filePath);
			if (!stat.isFile()) {
				return;
			}

			const content = fs.readFileSync(filePath, 'utf-8');
			let languageId = 'css';
			if (filePath.endsWith('.html')) {
				languageId = 'html';
			} else if (filePath.endsWith('.scss')) {
				languageId = 'scss';
			} else if (filePath.endsWith('.sass')) {
				languageId = 'sass';
			} else if (filePath.endsWith('.less')) {
				languageId = 'less';
			} else if (!filePath.endsWith('.css')) {
				// Skip unsupported file types
				return;
			}

			this.parseContent(content, uri, languageId);
			this.logger.log(`[css-lsp] Updated file ${uri} from disk.`);
		} catch (error) {
			this.logger.error(`[css-lsp] Error updating file ${uri}: ${error}`);
		}
	}

	public removeFile(uri: string): void {
		this.clearDocumentVariables(uri);
		this.clearDocumentUsages(uri);
		this.clearDocumentDOMTree(uri);
	}

	public clearDocumentVariables(uri: string): void {
		for (const [name, vars] of this.variables.entries()) {
			const filtered = vars.filter(v => v.uri !== uri);
			if (filtered.length === 0) {
				this.variables.delete(name);
			} else {
				this.variables.set(name, filtered);
			}
		}
	}

	public clearDocumentUsages(uri: string): void {
		for (const [name, usgs] of this.usages.entries()) {
			const filtered = usgs.filter(u => u.uri !== uri);
			if (filtered.length === 0) {
				this.usages.delete(name);
			} else {
				this.usages.set(name, filtered);
			}
		}
	}

	public clearDocumentDOMTree(uri: string): void {
		this.domTrees.delete(uri);
	}

	public getAllVariables(): CssVariable[] {
		const allVars: CssVariable[] = [];
		for (const vars of this.variables.values()) {
			allVars.push(...vars);
		}
		return allVars;
	}

	public getVariables(name: string): CssVariable[] {
		return this.variables.get(name) || [];
	}

	public getVariableUsages(name: string): CssVariableUsage[] {
		return this.usages.get(name) || [];
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
		const allVars = this.getAllVariables();
		return allVars.filter(v => v.uri === uri);
	}

	/**
	 * Get the DOM tree for a document (if it's HTML)
	 */
	public getDOMTree(uri: string): DOMTree | undefined {
		return this.domTrees.get(uri);
	}

	/**
	 * Resolve a variable name to a Color if possible.
	 * Handles recursive variable references: var(--a) -> var(--b) -> #fff
	 * Uses CSS cascade rules: !important > specificity > source order
	 */
	public resolveVariableColor(name: string, context?: string, seen = new Set<string>()): Color | null {
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

		// Use the winning definition (first after sort)
		const variable = sortedVars[0];
		let value = variable.value;

		// Check if it's a reference to another variable
		const match = value.match(/^var\((--[\w-]+)\)$/);
		if (match) {
			return this.resolveVariableColor(match[1], context, seen);
		}

		return parseColor(value);
	}
}
