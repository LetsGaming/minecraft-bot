import fs from "fs";
import path from "path";
import ts from "typescript";

/**
 * Finds user-facing string literals that bypass t(): a string or template
 * literal (including pieces of a concatenation or conditional) handed
 * straight to a Discord reply/embed/button sink. Parses with the TypeScript
 * syntax tree only (no type checking), so a full scan takes well under a
 * second.
 */

export const LINT_ROOTS = [
  "src/bot/commands",
  "src/bot/interactions",
  "src/bot/logWatcher/watchers",
  "src/bot/utils/embeds",
  "src/bot/utils/guild/guildRouter.ts",
  "src/bot/index.ts",
];

const REPLY_METHODS = new Set([
  "reply",
  "editReply",
  "followUp",
  "update",
  "send",
  "setContent",
]);

/** Builder methods whose first argument is display text. */
const TEXT_METHODS = new Set([
  "setTitle",
  "setDescription",
  "setLabel",
  "setPlaceholder",
  "setContent",
]);

/** Builder methods taking an object (or varargs of objects) of display text. */
const OBJECT_METHODS = new Set(["setFooter", "setAuthor", "addFields", "setFields"]);

const TEXT_PROPS = new Set([
  "content",
  "title",
  "description",
  "text",
  "name",
  "value",
  "label",
  "placeholder",
]);

const HAS_LETTER = /\p{L}/u;
const URL_ONLY = /^\s*https?:\/\/\S*\s*$/;

function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" ");
  }
  return null;
}

/** Collects literal fragments reachable through +, ?:, ?? and parentheses. */
function collectLiterals(node, out) {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
    collectLiterals(node.expression, out);
  } else if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.PlusToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    collectLiterals(node.left, out);
    collectLiterals(node.right, out);
  } else if (ts.isConditionalExpression(node)) {
    collectLiterals(node.whenTrue, out);
    collectLiterals(node.whenFalse, out);
  } else {
    const text = literalText(node);
    if (text !== null) out.push({ node, text });
  }
}

/** Unit and metric abbreviations that read the same in every locale. */
const NEUTRAL_WORDS = new Set(["ms", "s", "min", "h", "d", "kb", "mb", "gb", "tps", "mspt", "p"]);

function isUserFacingText(text) {
  if (!HAS_LETTER.test(text) || URL_ONLY.test(text)) return false;
  const words = text.match(/\p{L}+/gu) ?? [];
  return !words.every((w) => NEUTRAL_WORDS.has(w.toLowerCase()));
}

function* textPropValues(objectLiteral, depth = 0) {
  for (const prop of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null;
    if (key === null) continue;
    if (TEXT_PROPS.has(key)) yield prop.initializer;
    else if (
      depth < 2 &&
      (key === "footer" || key === "author") &&
      ts.isObjectLiteralExpression(prop.initializer)
    ) {
      yield* textPropValues(prop.initializer, depth + 1);
    } else if (depth < 2 && key === "fields" && ts.isArrayLiteralExpression(prop.initializer)) {
      for (const el of prop.initializer.elements) {
        if (ts.isObjectLiteralExpression(el)) yield* textPropValues(el, depth + 1);
      }
    }
  }
}

function* objectArgValues(arg) {
  if (ts.isObjectLiteralExpression(arg)) {
    yield* textPropValues(arg);
  } else if (ts.isArrayLiteralExpression(arg)) {
    for (const el of arg.elements) yield* objectArgValues(el);
  } else if (ts.isSpreadElement(arg)) {
    yield* objectArgValues(arg.expression);
  }
}

/** Slash command and option metadata is registered with Discord as plain English. */
function isSlashMetadataChain(call) {
  let cur = call.expression;
  while (cur) {
    if (ts.isPropertyAccessExpression(cur)) {
      if (/^(setName|add\w+Option|addSubcommand\w*|setDefaultMemberPermissions)$/.test(cur.name.text)) {
        return true;
      }
      cur = cur.expression;
    } else if (ts.isCallExpression(cur)) {
      cur = cur.expression;
    } else if (ts.isNewExpression(cur)) {
      return /^Slash\w*Builder$/.test(cur.expression.getText());
    } else if (ts.isParenthesizedExpression(cur)) {
      cur = cur.expression;
    } else {
      return false;
    }
  }
  return false;
}

function isConsoleCommand(node) {
  const found = [];
  collectLiterals(node, found);
  return found.length > 0 && found.every((f) => f.text.trimStart().startsWith("/"));
}

export function lintSource(fileName, source) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const findings = [];

  const report = (expr) => {
    const found = [];
    collectLiterals(expr, found);
    for (const { node, text } of found) {
      if (!isUserFacingText(text)) continue;
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      findings.push({ file: fileName, line: line + 1, text: text.trim().slice(0, 60) });
    }
  };

  const inCommandLayer =
    /^src\/bot\/(commands|interactions)\//.test(fileName) ||
    fileName === "src/bot/utils/guild/guildRouter.ts";

  const visit = (node) => {
    if (
      inCommandLayer &&
      ts.isThrowStatement(node) &&
      node.expression &&
      ts.isNewExpression(node.expression) &&
      /Error$/.test(node.expression.expression.getText(sf)) &&
      node.expression.arguments?.[0]
    ) {
      report(node.expression.arguments[0]);
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : "";
      const args = node.arguments ?? [];
      if (/^create(Error|Success|Info)Embed$/.test(name) && args[0]) report(args[0]);
      if (name === "errorReply") for (const arg of args) report(arg);
      if (/^(create\w*Embed\w*|EmbedBuilder)$/.test(name)) {
        for (const arg of args) for (const v of objectArgValues(arg)) report(v);
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const [first] = node.arguments;
      if (first) {
        if (TEXT_METHODS.has(method) && !isSlashMetadataChain(node)) report(first);
        if (REPLY_METHODS.has(method)) {
          if (!(method === "send" && isConsoleCommand(first))) report(first);
          for (const v of objectArgValues(first)) report(v);
        }
        if (OBJECT_METHODS.has(method)) {
          for (const arg of node.arguments) for (const v of objectArgValues(arg)) report(v);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) yield full;
  }
}

export function lintRepo(root, allowlist = []) {
  const findings = [];
  for (const rel of LINT_ROOTS) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const files = fs.statSync(abs).isDirectory() ? [...walk(abs)] : [abs];
    for (const file of files) {
      const relPath = path.relative(root, file).split(path.sep).join("/");
      const entries = allowlist.filter((e) => e.path === relPath);
      const whole = entries.some((e) => e.text === undefined);
      if (whole) continue;
      findings.push(
        ...lintSource(relPath, fs.readFileSync(file, "utf-8")).filter(
          (f) => !entries.some((e) => f.text.includes(e.text)),
        ),
      );
    }
  }
  return findings;
}
