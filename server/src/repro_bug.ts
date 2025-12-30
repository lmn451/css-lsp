
import { parse } from 'node-html-parser';

const html = '<div class="foo bar"></div>';
const root = parse(html);
const div = root.querySelector('div');

if (div) {
    console.log('classList:', div.classList);
    console.log('classList.value:', div.classList.value);

    // Simulate what the code does
    const classes: string[] = [];
    // @ts-ignore
    for (let i = 0; i < div.classList.value.length; i++) {
        // @ts-ignore
        const className = div.classList.value[i];
        if (className) classes.push(className);
    }
    console.log('Extracted classes (current code):', classes);

    // Expected behavior
    const expectedClasses = div.classList.toString().split(' ');
    console.log('Expected classes:', expectedClasses);

    console.log('Testing classList[i] access:');
    for (let i = 0; i < div.classList.length; i++) {
        // @ts-ignore
        console.log(`Index ${i}:`, div.classList[i]);
    }
}
