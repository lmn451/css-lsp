"use strict";
/**
 * CSS Specificity Calculator
 *
 * Calculates and compares CSS selector specificity according to the CSS specification.
 * https://www.w3.org/TR/selectors-3/#specificity
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateSpecificity = calculateSpecificity;
exports.compareSpecificity = compareSpecificity;
exports.formatSpecificity = formatSpecificity;
exports.matchesContext = matchesContext;
/**
 * Calculate the specificity of a CSS selector.
 *
 * Examples:
 * - ":root" → (0, 1, 0) - pseudo-class
 * - "div" → (0, 0, 1) - element
 * - ".class" → (0, 1, 0) - class
 * - "#id" → (1, 0, 0) - ID
 * - "div.class#id" → (1, 1, 1)
 */
function calculateSpecificity(selector) {
    // Remove whitespace and trim
    selector = selector.trim();
    // Handle empty or universal selector
    if (!selector || selector === '*') {
        return { ids: 0, classes: 0, elements: 0 };
    }
    const specificity = {
        ids: 0,
        classes: 0,
        elements: 0
    };
    // Split by comma for selector lists, take the most specific
    const selectors = selector.split(',');
    if (selectors.length > 1) {
        // For multiple selectors, return the highest specificity
        const specificities = selectors.map(s => calculateSpecificity(s.trim()));
        return specificities.reduce((max, curr) => compareSpecificity(curr, max) > 0 ? curr : max);
    }
    // Remove pseudo-elements first (::before, ::after) - count as elements
    const pseudoElementRegex = /::[a-z-]+/gi;
    const pseudoElements = selector.match(pseudoElementRegex) || [];
    specificity.elements += pseudoElements.length;
    selector = selector.replace(pseudoElementRegex, '');
    // Count IDs (#id)
    const idRegex = /#[a-z0-9_-]+/gi;
    const ids = selector.match(idRegex) || [];
    specificity.ids += ids.length;
    selector = selector.replace(idRegex, '');
    // Count classes (.class)
    const classRegex = /\.[a-z0-9_-]+/gi;
    const classes = selector.match(classRegex) || [];
    specificity.classes += classes.length;
    selector = selector.replace(classRegex, '');
    // Count attribute selectors ([attr])
    const attrRegex = /\[[^\]]+\]/g;
    const attrs = selector.match(attrRegex) || [];
    specificity.classes += attrs.length;
    selector = selector.replace(attrRegex, '');
    // Count pseudo-classes (:hover, :nth-child, etc.)
    const pseudoClassRegex = /:[a-z-]+(\([^)]*\))?/gi;
    const pseudoClasses = selector.match(pseudoClassRegex) || [];
    specificity.classes += pseudoClasses.length;
    selector = selector.replace(pseudoClassRegex, '');
    // Count type selectors (remaining words that aren't combinators)
    // Remove combinators: >, +, ~, and whitespace
    selector = selector.replace(/[>+~\s]/g, ' ');
    const elements = selector.split(/\s+/).filter(s => s && s !== '*');
    specificity.elements += elements.length;
    return specificity;
}
/**
 * Compare two specificity values.
 *
 * @returns 1 if a > b, -1 if a < b, 0 if equal
 */
function compareSpecificity(a, b) {
    // Compare IDs first
    if (a.ids !== b.ids) {
        return a.ids > b.ids ? 1 : -1;
    }
    // Then classes
    if (a.classes !== b.classes) {
        return a.classes > b.classes ? 1 : -1;
    }
    // Finally elements
    if (a.elements !== b.elements) {
        return a.elements > b.elements ? 1 : -1;
    }
    // Equal specificity
    return 0;
}
/**
 * Format specificity as a string for display
 */
function formatSpecificity(spec) {
    return `(${spec.ids},${spec.classes},${spec.elements})`;
}
/**
 * Check if a selector could apply to a given context.
 * This is a simplified check - a full implementation would require DOM structure.
 *
 * Examples:
 * - matchesContext(":root", ".button") → true (root applies to everything)
 * - matchesContext("div", "div") → true (exact match)
 * - matchesContext(".button", ".button") → true (exact match)
 * - matchesContext("#main", ".button") → false (different selectors)
 */
function matchesContext(definitionSelector, usageContext, domTree, domNode) {
    // If we have a DOM tree and node, use proper selector matching
    if (domTree && domNode) {
        try {
            return domTree.matchesSelector(domNode, definitionSelector);
        }
        catch (e) {
            // If selector matching fails, fall back to simple matching
        }
    }
    // Fallback: Simple matching without DOM
    // :root applies to everything (universal fallback)
    if (definitionSelector.trim() === ':root') {
        return true;
    }
    // Exact match
    if (definitionSelector.trim() === usageContext.trim()) {
        return true;
    }
    // For now, we use a simplified approach:
    // If the usage context contains the definition selector, it might apply
    // This handles cases like "div" applying to "div.class"
    const defParts = definitionSelector.split(/[\s>+~]/);
    const usageParts = usageContext.split(/[\s>+~]/);
    // Check if any part of the definition is in the usage
    return defParts.some(defPart => usageParts.some(usagePart => usagePart.includes(defPart) || defPart.includes(usagePart)));
}
//# sourceMappingURL=specificity.js.map