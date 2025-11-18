import { Range, Position } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

export interface CssVariable {
	name: string;
	value: string;
	uri: string;
	range: Range;
}

export class CssVariableManager {
	private variables: Map<string, CssVariable[]> = new Map();

	public parseDocument(document: TextDocument): void {
		const text = document.getText();
		const uri = document.uri;

		// Clear existing variables for this document
		this.clearDocumentVariables(uri);

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
		const regex = /(--[\w-]+)\s*:\s*([^;]+);/g;
		let match;

		while ((match = regex.exec(text)) !== null) {
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
}
