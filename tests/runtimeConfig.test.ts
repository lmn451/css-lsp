import { test } from "node:test";
import { strict as assert } from "node:assert";
import { buildRuntimeConfig } from "../src/runtimeConfig";

function makeEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

test("runtime config defaults", () => {
  const config = buildRuntimeConfig([], makeEnv());

  assert.equal(config.enableColorProvider, true);
  assert.equal(config.colorOnlyOnVariables, false);
  assert.equal(config.lookupFiles, undefined);
  assert.equal(config.pathDisplayMode, "relative");
  assert.equal(config.pathDisplayAbbrevLength, 1);
});

test("color provider and variable flags", () => {
  assert.equal(
    buildRuntimeConfig(["--no-color-preview"], makeEnv()).enableColorProvider,
    false,
  );
  assert.equal(
    buildRuntimeConfig(["--color-only-variables"], makeEnv())
      .colorOnlyOnVariables,
    true,
  );
  assert.equal(
    buildRuntimeConfig([], makeEnv({ CSS_LSP_COLOR_ONLY_VARIABLES: "1" }))
      .colorOnlyOnVariables,
    true,
  );
  assert.equal(
    buildRuntimeConfig([], makeEnv({ CSS_LSP_COLOR_ONLY_VARIABLES: "0" }))
      .colorOnlyOnVariables,
    false,
  );
});

test("lookup files resolve from cli then env", () => {
  const config = buildRuntimeConfig(
    [
      "--lookup-files",
      "a.css,b.css",
      "--lookup-file",
      "c.css",
      "--lookup-files= d.css , e.css",
      "--lookup-files=**/*",
      "--lookup-file=f.css",
    ],
    makeEnv({ CSS_LSP_LOOKUP_FILES: "env.css" }),
  );

  assert.deepEqual(config.lookupFiles, [
    "a.css",
    "b.css",
    "c.css",
    "d.css",
    "e.css",
    "**/*",
    "f.css",
  ]);
});

test("lookup files fall back to env when cli list is empty", () => {
  const config = buildRuntimeConfig(
    ["--lookup-files", ",,"],
    makeEnv({ CSS_LSP_LOOKUP_FILES: "env.css,other.css" }),
  );

  assert.deepEqual(config.lookupFiles, ["env.css", "other.css"]);
});

test("path display parsing supports abbreviations and lengths", () => {
  const config = buildRuntimeConfig(["--path-display", "abbr:4"], makeEnv());

  assert.equal(config.pathDisplayMode, "abbreviated");
  assert.equal(config.pathDisplayAbbrevLength, 4);
});

test("path display length overrides and clamps", () => {
  const config = buildRuntimeConfig(
    ["--path-display", "absolute:5", "--path-display-length=2"],
    makeEnv(),
  );

  assert.equal(config.pathDisplayMode, "absolute");
  assert.equal(config.pathDisplayAbbrevLength, 2);

  const negative = buildRuntimeConfig(
    ["--path-display-length=-3"],
    makeEnv(),
  );
  assert.equal(negative.pathDisplayAbbrevLength, 0);
});

test("path display envs are used when args are absent", () => {
  const config = buildRuntimeConfig(
    [],
    makeEnv({ CSS_LSP_PATH_DISPLAY: "fish:3" }),
  );

  assert.equal(config.pathDisplayMode, "abbreviated");
  assert.equal(config.pathDisplayAbbrevLength, 3);
});

test("path display invalid mode falls back but keeps length", () => {
  const config = buildRuntimeConfig(["--path-display", "nope:4"], makeEnv());

  assert.equal(config.pathDisplayMode, "relative");
  assert.equal(config.pathDisplayAbbrevLength, 4);
});

test("path display length handles invalid inputs and precedence", () => {
  const fromDisplay = buildRuntimeConfig(
    ["--path-display=abbreviated:7", "--path-display-length=oops"],
    makeEnv(),
  );

  assert.equal(fromDisplay.pathDisplayMode, "abbreviated");
  assert.equal(fromDisplay.pathDisplayAbbrevLength, 7);

  const invalid = buildRuntimeConfig(
    ["--path-display=absolute:bad"],
    makeEnv(),
  );

  assert.equal(invalid.pathDisplayMode, "absolute");
  assert.equal(invalid.pathDisplayAbbrevLength, 1);

  const fromEnv = buildRuntimeConfig(
    [],
    makeEnv({ CSS_LSP_PATH_DISPLAY_LENGTH: "5" }),
  );

  assert.equal(fromEnv.pathDisplayMode, "relative");
  assert.equal(fromEnv.pathDisplayAbbrevLength, 5);
});

test("path display flags require values", () => {
  const config = buildRuntimeConfig(
    ["--path-display", "--path-display-length", "2"],
    makeEnv(),
  );

  assert.equal(config.pathDisplayMode, "relative");
  assert.equal(config.pathDisplayAbbrevLength, 2);
});

test("lookup flags ignore missing values and fall back to env", () => {
  const config = buildRuntimeConfig(
    ["--lookup-file", "--color-only-variables"],
    makeEnv({ CSS_LSP_LOOKUP_FILES: "env.css" }),
  );

  assert.deepEqual(config.lookupFiles, ["env.css"]);
});

test("color-only env requires explicit 1", () => {
  const config = buildRuntimeConfig(
    [],
    makeEnv({ CSS_LSP_COLOR_ONLY_VARIABLES: "true" }),
  );

  assert.equal(config.colorOnlyOnVariables, false);
});
