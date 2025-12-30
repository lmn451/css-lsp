
import { parseColor } from './colorService';

const hex4 = '#f008'; // Red with 50% alpha approx
const color = parseColor(hex4);

console.log(`Parsing ${hex4}:`, color);

if (color) {
    console.log('Success!');
} else {
    console.log('Failed to parse 4-digit hex');
}
