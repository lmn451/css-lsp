/**
 * DOM Tree wrapper using node-html-parser
 * Provides a lightweight DOM tree for CSS selector matching
 */

import { parse, HTMLElement as ParsedHTMLElement, Node as ParsedNode } from 'node-html-parser';

export interface DOMNodeInfo {
	tagName: string;
	id?: string;
	classes: string[];
	element: ParsedHTMLElement;
}

export class DOMTree {
	private root: ParsedHTMLElement;
	private htmlText: string;

	constructor(htmlText: string) {
		this.htmlText = htmlText;
		this.root = parse(htmlText, {
			lowerCaseTagName: true,
			comment: false,
			blockTextElements: {
				script: true,
				noscript: true,
				style: false, // We want to parse style content
			}
		});
	}

	/**
	 * Find the DOM node at a specific character position in the HTML
	 */
	public findNodeAtPosition(position: number): DOMNodeInfo | undefined {
		return this.findNodeAtPositionRecursive(this.root, position);
	}

	private findNodeAtPositionRecursive(node: ParsedNode, position: number): DOMNodeInfo | undefined {
		if (!(node instanceof ParsedHTMLElement)) {
			return undefined;
		}

		// Check if position is within this node's range
		const range = node.range;
		if (!range || position < range[0] || position > range[1]) {
			return undefined;
		}

		// Check children first (most specific match)
		for (const child of node.childNodes) {
			const found = this.findNodeAtPositionRecursive(child, position);
			if (found) {
				return found;
			}
		}

		// Return this node if no child matched
		// Manually extract classes from DOMTokenList using item()
		const classes: string[] = [];
		for (let i = 0; i < node.classList.length; i++) {
			const className = (node.classList as any)[i]; // Type assertion needed due to library types
			if (className) classes.push(className);
		}

		return {
			tagName: node.tagName,
			id: node.id,
			classes: classes,
			element: node
		};
	}

	/**
	 * Check if a CSS selector matches a given DOM node
	 */
	public matchesSelector(nodeInfo: DOMNodeInfo, selector: string): boolean {
		try {
			// Use querySelectorAll on parent and check if element is in results
			// This is a workaround since node-html-parser doesn't have matches()
			const parent = nodeInfo.element.parentNode;
			if (!parent || !(parent instanceof ParsedHTMLElement)) {
				// If no parent, try matching against root
				const matches = this.root.querySelectorAll(selector);
				return matches.includes(nodeInfo.element);
			}

			const matches = parent.querySelectorAll(selector);
			return matches.includes(nodeInfo.element);
		} catch (e) {
			// Invalid selector, return false
			return false;
		}
	}

	/**
	 * Find all nodes that match a CSS selector
	 */
	public querySelectorAll(selector: string): DOMNodeInfo[] {
		try {
			const elements = this.root.querySelectorAll(selector);
			return elements.map(el => {
				// Manually extract classes from DOMTokenList
				const classes: string[] = [];
				for (let i = 0; i < el.classList.length; i++) {
					const className = el.classList.value[i];
					if (className) classes.push(className);
				}

				return {
					tagName: el.tagName,
					id: el.id,
					classes: classes,
					element: el as ParsedHTMLElement
				};
			});
		} catch (e) {
			// Invalid selector
			return [];
		}
	}

	/**
	 * Get the root element
	 */
	public getRoot(): ParsedHTMLElement {
		return this.root;
	}
}
