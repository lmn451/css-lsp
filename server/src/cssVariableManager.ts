import { Range } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { glob } from 'glob';
import * as fs from 'fs';
import * as path from 'path';

export interface CssVariable {
	name: string;
	value: string;
	uri: string;
	range: Range;
}

export interface CssVariableUsage {
	name: string;
	uri: string;
	range: Range;
}

export class CssVariableManager {
	private variables: Map<string, CssVariable[]> = new Map();
	private usages: Map<string, CssVariableUsage[]> = new Map();

	/**
	 * Scan all CSS and HTML files in the workspace
	 */
	public async scanWorkspace(workspaceFolders: string[]): Promise<void> {
		for (const folder of workspaceFolders) {
			const folderUri = URI.parse(folder);
			const folderPath = folderUri.fsPath;

			// Find all CSS and HTML files
			const files = await glob('**/*.{css,html}', {
				cwd: folderPath,
				ignore: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/.git/**'],
				absolute: true
			});

			// Parse each file
			for (const filePath of files) {
				try {
					const content = fs.readFileSync(filePath, 'utf-8');
					const fileUri = URI.file(filePath).toString();
					const languageId = filePath.endsWith('.html') ? 'html' : 'css';

					// Create a TextDocument for parsing
					const document = TextDocument.create(fileUri, languageId, 1, content);
					this.parseDocument(document);
				} catch (error) {
					console.error(`Error scanning file ${filePath}:`, error);
				}
			}
		}
	}

	public parseDocument(document: TextDocument): void {
		const text = document.getText();
		const uri = document.uri;

		// Clear existing variables and usages for this document
		this.clearDocumentVariables(uri);
		this.clearDocumentUsages(uri);

		if (document.languageId === 'html') {
			const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/g;
			let styleMatch;
			while ((styleMatch = styleRegex.exec(text)) !== null) {
				const styleContent = styleMatch[1];
				const styleStartOffset = styleMatch.index + styleMatch[0].indexOf(styleContent);
				this.parseCssText(styleContent, uri, document, styleStartOffset);
			}
		} else {
			this.parseCssText(text, uri, document, 0);
		}
	}

	private parseCssText(text: string, uri: string, document: TextDocument, offset: number): void {
		// Parse variable definitions
		const defRegex = /(--[\w-]+)\s*:\s*([^;]+);/g;
		let match;

		while ((match = defRegex.exec(text)) !== null) {
			const name = match[1];
			const value = match[2].trim();
			const startPos = document.positionAt(offset + match.index);
			const endPos = document.positionAt(offset + match.index + match[0].length);

			const variable: CssVariable = {
				name,
				value,
				uri,
				range: Range.create(startPos, endPos)
			};

			if (!this.variables.has(name)) {
				this.variables.set(name, []);
			}
			this.variables.get(name)?.push(variable);
		}

		// Parse variable usages: var(--variable-name) or var(--variable-name, fallback)
		const usageRegex = /var\((--[\w-]+)(?:\s*,\s*[^)]+)?\)/g;
		while ((match = usageRegex.exec(text)) !== null) {
			const name = match[1];
			const startPos = document.positionAt(offset + match.index);
			const endPos = document.positionAt(offset + match.index + match[0].length);

			const usage: CssVariableUsage = {
				name,
				uri,
				range: Range.create(startPos, endPos)
			};

			if (!this.usages.has(name)) {
				this.usages.set(name, []);
			}
			this.usages.get(name)?.push(usage);
		}
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
}
