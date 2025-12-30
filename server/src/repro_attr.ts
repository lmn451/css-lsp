
import { calculateSpecificity } from './specificity';

const selector = '[title="]"]';
const spec = calculateSpecificity(selector);

console.log(`Specificity for ${selector}:`, spec);

// Expected: (0, 1, 0) - one class/attribute
// If regex fails, it might count incorrectly or leave garbage
if (spec.classes === 1 && spec.elements === 0 && spec.ids === 0) {
    console.log('Success!');
} else {
    console.log('Failed to parse attribute with closing bracket');
}
