"use strict";
/**
 * DOM Tree wrapper using node-html-parser
 * Provides a lightweight DOM tree for CSS selector matching
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DOMTree = void 0;
const node_html_parser_1 = require("node-html-parser");
class DOMTree {
    constructor(htmlText) {
        this.htmlText = htmlText;
        this.root = (0, node_html_parser_1.parse)(htmlText, {
            lowerCaseTagName: true,
            comment: false,
            blockTextElements: {
                script: true,
                noscript: true,
                style: false, // We want to parse style content
            },
        });
    }
    /**
     * Find the DOM node at a specific character position in the HTML
     */
    findNodeAtPosition(position) {
        return this.findNodeAtPositionRecursive(this.root, position);
    }
    findNodeAtPositionRecursive(node, position) {
        if (!(node instanceof node_html_parser_1.HTMLElement)) {
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
        return {
            tagName: node.tagName,
            id: node.id,
            classes: [...node.classList.values()],
            element: node,
        };
    }
    /**
     * Check if a CSS selector matches a given DOM node
     */
    matchesSelector(nodeInfo, selector) {
        try {
            // Use querySelectorAll on parent and check if element is in results
            // This is a workaround since node-html-parser doesn't have matches()
            const parent = nodeInfo.element.parentNode;
            if (!parent || !(parent instanceof node_html_parser_1.HTMLElement)) {
                // If no parent, try matching against root
                const matches = this.root.querySelectorAll(selector);
                return matches.includes(nodeInfo.element);
            }
            const matches = parent.querySelectorAll(selector);
            return matches.includes(nodeInfo.element);
        }
        catch (e) {
            // Invalid selector, return false
            return false;
        }
    }
    /**
     * Find all nodes that match a CSS selector
     */
    querySelectorAll(selector) {
        try {
            const elements = this.root.querySelectorAll(selector);
            return elements.map((el) => {
                // Manually extract classes from DOMTokenList
                const classes = [];
                for (let i = 0; i < el.classList.length; i++) {
                    const className = el.classList.value[i];
                    if (className)
                        classes.push(className);
                }
                return {
                    tagName: el.tagName,
                    id: el.id,
                    classes: classes,
                    element: el,
                };
            });
        }
        catch (e) {
            // Invalid selector
            return [];
        }
    }
    /**
     * Get the root element
     */
    getRoot() {
        return this.root;
    }
}
exports.DOMTree = DOMTree;
//# sourceMappingURL=domTree.js.map