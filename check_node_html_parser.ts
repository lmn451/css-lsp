import { parse } from "node-html-parser";

const root = parse('<div class="foo bar"></div>');
const el = root.querySelector("div")!;
console.log("classList.length:", el.classList.length);
console.log("classList.value:", el.classList.value);
console.log("classList.values():", [...el.classList.values()]);
for (let i = 0; i < el.classList.length; i++) {
  console.log(`classList.value[${i}]:`, el.classList.value[i]);
}
