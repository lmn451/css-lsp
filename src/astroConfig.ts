import * as path from "path";
import * as ts from "typescript";

/**
 * The configuration files that Astro documents as supported. Keep this list
 * deliberately narrow: parsing every JavaScript/TypeScript file in a
 * workspace would turn this small extractor into a general source indexer.
 */
export const ASTRO_CONFIG_GLOB = "**/astro.config.{js,mjs,cjs,ts,mts,cts}";

const ASTRO_CONFIG_BASENAMES = new Set([
  "astro.config.js",
  "astro.config.mjs",
  "astro.config.cjs",
  "astro.config.ts",
  "astro.config.mts",
  "astro.config.cts",
]);

export interface AstroFontVariable {
  /** The decoded custom-property name from the source literal. */
  name: string;
  /** Start and end offsets of the complete source literal, including quotes. */
  literalStart: number;
  literalEnd: number;
  /** Start and end offsets of the literal contents, excluding quotes. */
  contentStart: number;
  contentEnd: number;
}

/** Return true only for one of Astro's recognized configuration basenames. */
export function isAstroConfigFile(filePath: string): boolean {
  return ASTRO_CONFIG_BASENAMES.has(path.basename(filePath));
}

function propertyNameIs(
  property: ts.PropertyName | undefined,
  expected: string,
): boolean {
  // Computed names are intentionally excluded, even when their expression is
  // a string literal. A computed property can depend on runtime behavior.
  return (
    !!property &&
    (ts.isIdentifier(property) || ts.isStringLiteral(property)) &&
    property.text === expected
  );
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isStringLiteralLike(
  expression: ts.Expression,
): expression is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  );
}

function scriptKindForFile(fileName: string): ts.ScriptKind {
  switch (path.extname(fileName).toLowerCase()) {
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    case ".ts":
    case ".mts":
    case ".cts":
      return ts.ScriptKind.TS;
    default:
      return ts.ScriptKind.TS;
  }
}

function isCustomPropertyName(name: string): boolean {
  // This mirrors the name grammar consumed by the rest of the manager. The
  // extractor must never create a definition that var(--name) cannot use.
  return /^--[\w-]+$/.test(name);
}

function extractFontArray(
  initializer: ts.Expression,
  variables: AstroFontVariable[],
): void {
  const fonts = unwrapExpression(initializer);
  if (!ts.isArrayLiteralExpression(fonts)) {
    return;
  }

  for (const element of fonts.elements) {
    const entry = unwrapExpression(element);
    if (!ts.isObjectLiteralExpression(entry)) {
      // Spreads, calls, conditionals, and other dynamic entries are ignored.
      continue;
    }

    const cssVariable = resolvePropertyInitializer(entry, "cssVariable");
    if (!cssVariable.initializer) {
      continue;
    }

    const value = unwrapExpression(cssVariable.initializer);
    if (!isStringLiteralLike(value) || !isCustomPropertyName(value.text)) {
      continue;
    }

    const literalStart = value.getStart();
    const literalEnd = value.getEnd();
    const sourceText = value.getSourceFile().text;
    // An unterminated literal can still appear in TypeScript's recovery AST;
    // do not turn that partial text into a definition with a false range.
    if (
      literalEnd - literalStart < 2 ||
      sourceText[literalStart] !== sourceText[literalEnd - 1]
    ) {
      continue;
    }

    // StringLiteral and NoSubstitutionTemplateLiteral both have one
    // delimiter on each side. Keeping the content range separate lets the
    // existing rename handler replace --name without deleting delimiters.
    variables.push({
      name: value.text,
      literalStart,
      literalEnd,
      contentStart: literalStart + 1,
      contentEnd: literalEnd - 1,
    });
  }
}

interface ResolvedPropertyInitializer {
  /** Whether an own property with this name appeared in the object. */
  found: boolean;
  /** The final initializer when it is a direct, statically readable value. */
  initializer?: ts.Expression;
}

function propertyMayMatch(
  property: ts.ObjectLiteralElementLike,
  expected: string,
): boolean {
  // A spread can override any property. If it follows a candidate, the
  // candidate must be treated as unknown because we do not resolve spreads.
  if (ts.isSpreadAssignment(property)) {
    return true;
  }

  const namedProperty = property as ts.ObjectLiteralElement & {
    name?: ts.PropertyName;
  };
  if (!namedProperty.name) {
    return false;
  }

  // Computed names are deliberately unsupported, but can still override a
  // statically named property at runtime. Conservatively invalidate earlier
  // candidates when one appears after them.
  if (ts.isComputedPropertyName(namedProperty.name)) {
    return true;
  }

  return propertyNameIs(namedProperty.name, expected);
}

function resolvePropertyInitializer(
  object: ts.ObjectLiteralExpression,
  expected: string,
): ResolvedPropertyInitializer {
  let found = false;
  let initializer: ts.Expression | undefined;

  for (const property of object.properties) {
    if (!propertyMayMatch(property, expected)) {
      continue;
    }

    found = true;
    if (
      ts.isPropertyAssignment(property) &&
      propertyNameIs(property.name, expected)
    ) {
      // Object properties are applied in source order, so a later assignment
      // replaces an earlier one. The caller can inspect only the final value.
      initializer = property.initializer;
    } else {
      // Shorthand properties, methods, accessors, spreads, and computed
      // names all require runtime knowledge and therefore invalidate prior
      // static candidates.
      initializer = undefined;
    }
  }

  return { found, initializer };
}

function extractFromConfigObject(
  config: ts.ObjectLiteralExpression,
  variables: AstroFontVariable[],
): void {
  const fonts = resolvePropertyInitializer(config, "fonts");
  if (fonts.initializer) {
    extractFontArray(fonts.initializer, variables);
  }

  const experimental = resolvePropertyInitializer(config, "experimental");
  if (!experimental.initializer) {
    return;
  }

  const experimentalObject = unwrapExpression(experimental.initializer);
  if (!ts.isObjectLiteralExpression(experimentalObject)) {
    return;
  }

  const legacyFonts = resolvePropertyInitializer(experimentalObject, "fonts");
  if (legacyFonts.initializer) {
    extractFontArray(legacyFonts.initializer, variables);
  }
}

function isModuleLevelExpression(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): boolean {
  let current: ts.Node = node;
  while (current.parent && current.parent !== sourceFile) {
    const parent = current.parent;
    if (
      ts.isExpressionStatement(parent) ||
      ts.isExportAssignment(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isVariableStatement(parent) ||
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isTypeAssertionExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      (ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === ts.SyntaxKind.EqualsToken)
    ) {
      current = parent;
      continue;
    }
    return false;
  }
  return current.parent === sourceFile;
}

/**
 * Extract statically known Astro font CSS custom properties.
 *
 * This function only traverses the compiler AST. It never loads modules or
 * evaluates configuration code, and it intentionally performs no constant
 * propagation beyond a few syntax wrappers around a literal expression.
 */
export function extractAstroFontVariables(
  text: string,
  fileName = "astro.config.ts",
): AstroFontVariable[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForFile(fileName),
  );
  const variables: AstroFontVariable[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "defineConfig" &&
      isModuleLevelExpression(node, sourceFile)
    ) {
      const firstArgument = node.arguments[0];
      if (firstArgument) {
        const config = unwrapExpression(firstArgument);
        if (ts.isObjectLiteralExpression(config)) {
          extractFromConfigObject(config, variables);
        }
      }
    }

    // A direct default-exported object is common in Astro's configuration
    // API. It is still a narrowly scoped, statically identifiable root.
    if (
      ts.isExportAssignment(node) &&
      ts.isObjectLiteralExpression(unwrapExpression(node.expression))
    ) {
      extractFromConfigObject(
        unwrapExpression(node.expression) as ts.ObjectLiteralExpression,
        variables,
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return variables;
}
