import { test } from "node:test";
import { strict as assert } from "node:assert";
import { Color } from "vscode-languageserver/node";
import { parseColor } from "../src/colorService";

function assertUnitColor(color: Color | null): asserts color is Color {
  assert.ok(color);
  for (const channel of Object.values(color)) {
    assert.ok(Number.isFinite(channel) && channel >= 0 && channel <= 1);
  }
  assert.ok(!JSON.stringify(color).includes("null"));
}

test("malformed complete color tokens are rejected", () => {
  const invalid = [
    "",
    "#",
    "#12",
    "#12345",
    "#1234567",
    "#gggggg",
    "#1g2",
    "#112233g",
    "#12 3456",
    "rgb(1x,0,0)",
    "rgb(1.2.3,0,0)",
    "rgb(1,2)",
    "rgb(1,2,3,4,5)",
    "rgb(1 2 3 4)",
    "rgb(1,2 3)",
    "rgb(1,2,3 / .5)",
    "rgb(1 2 3 /)",
    "rgb(1 2 3 // .5)",
    "rgb(1,2,3)trailing",
    "rgb(1,2,3))",
    "rgb(1,2,3",
    "rgb(1%,2,3)",
    "rgb(NaN,0,0)",
    "rgba(1,2,3,Infinity)",
    "rgb(1e999,0,0)",
    "rgb(0x10,0,0)",
    "rgb(1.,0,0)",
    "hsl(1x,50%,50%)",
    "hsl(0,50x%,50%)",
    "hsl(0,50%,50%)junk",
    "hsl(0 50% 50% .5)",
    "hsl(0,50%,50%,NaN)",
    "hsl(1e999,50%,50%)",
    "constructor",
    "__proto__",
    "notacolor",
    "red trailing",
  ];
  for (const input of invalid) {
    assert.equal(parseColor(input, { allowNamedColors: true }), null, input);
  }
});

test("valid hex, RGB, HSL, alpha and named color forms remain supported", () => {
  const valid = [
    "#abc",
    "#abcd",
    "#aabbcc",
    "#AABBCCDD",
    " #ABC ",
    "rgb(255, 0, 0)",
    "rgba(255, 0, 0, .5)",
    "rgb(255 0 0 / 50%)",
    "rgb(100%,0%,0%)",
    "rgb(100% 0 0)",
    "rgb(2.55e2,0,0)",
    "hsl(0,100%,50%)",
    "hsla(120,100%,50%,.5)",
    "hsl(240 100% 50% / 25%)",
    "hsl(0 100 50)",
    "hsl(400grad 100% 50%)",
    "hsl(1turn 100% 50%)",
    "hsl(0rad 100% 50%)",
    "red",
    "rebeccapurple",
    "transparent",
  ];
  for (const input of valid) {
    assertUnitColor(parseColor(input, { allowNamedColors: true }));
  }
  assert.equal(parseColor("red"), null);
  assert.deepEqual(parseColor("rgb(100%, 0%, 0%)"), {
    red: 1,
    green: 0,
    blue: 0,
    alpha: 1,
  });
  assert.equal(parseColor("rgba(0 0 0 / 50%)")?.alpha, 0.5);
  assert.equal(parseColor("#abcd")?.alpha, 221 / 255);
});

test("finite out-of-range channels clamp and hue wraps", () => {
  assert.deepEqual(parseColor("rgba(999,-5,0,2)"), {
    red: 1,
    green: 0,
    blue: 0,
    alpha: 1,
  });
  assert.deepEqual(parseColor("hsla(-360,200%,50%,-1)"), {
    red: 1,
    green: 0,
    blue: 0,
    alpha: 0,
  });
  assert.deepEqual(parseColor("hsl(3600,100%,200%)"), {
    red: 1,
    green: 1,
    blue: 1,
    alpha: 1,
  });
  for (const value of ["-1e300", "-999", "-.5", "0", ".5", "999", "1e300"]) {
    assertUnitColor(parseColor(`rgba(${value},${value},${value},${value})`));
    assertUnitColor(parseColor(`hsla(${value},${value}%,${value}%,${value})`));
  }
});
