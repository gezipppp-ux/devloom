const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "../..");
const sourceRoot = path.join(root, "web/src");
const catalogRoot = path.join(root, "shared");
const features = new Set(["workspaces", "tasks", "session", "settings"]);
const sharedGroups = new Set(["api", "components", "styles"]);

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}

function isInside(directory, file) {
  const relative = path.relative(directory, file);
  return relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function scriptSource(file, source) {
  if (!file.endsWith(".vue")) return source;
  return [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/g)]
    .map((match) => match[1]).join("\n");
}

function moduleImports(source, name) {
  // Tokenize only the literal imports used in this project. Comments and string
  // contents are opaque; Vue templates/styles never reach this scanner.
  const tokens = [...source.matchAll(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[\w$]+|[^\s]/g,
  )].map((match) => match[0]).filter((token) =>
    !token.startsWith("//") && !token.startsWith("/*"));
  const imports = [];
  const literal = (token) => token && /^["']/.test(token);
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] !== "import" || tokens[index - 1] === ".") continue;
    const next = tokens[index + 1];
    if (next === ".") continue; // import.meta is not a module dependency.
    if (next === "(") {
      assert.ok(literal(tokens[index + 2]) && tokens[index + 3] === ")",
        `${name}: dynamic imports must use a literal path`);
      imports.push(tokens[index + 2].slice(1, -1));
    } else if (literal(next)) {
      imports.push(next.slice(1, -1));
    } else {
      let end = index + 1;
      while (end < tokens.length && !["from", ";"].includes(tokens[end])) end++;
      assert.ok(tokens[end] === "from" && literal(tokens[end + 1]),
        `${name}: unsupported static import; update the architecture scanner`);
      imports.push(tokens[end + 1].slice(1, -1));
      index = end + 1;
    }
  }
  return imports;
}

function layer(file) {
  const parts = path.relative(sourceRoot, file).split(path.sep);
  if (parts.length === 1 && parts[0] === "main.js") return "main";
  return parts[0] === "features" ? `features/${parts[1]}` : parts[0];
}

function canImport(from, to) {
  if (from === "main" || from === "app")
    return to === "app" || to === "shared" || to.startsWith("features/");
  if (from.startsWith("features/")) return to === from || to === "shared";
  return from === "shared" && to === "shared";
}

test("frontend files stay in declared feature directories with consistent names", () => {
  const files = filesIn(sourceRoot);
  assert.ok(files.some((file) => path.relative(sourceRoot, file) === "main.js"));
  for (const file of files) {
    const parts = path.relative(sourceRoot, file).split(path.sep);
    const name = parts.join("/");
    const basename = parts.at(-1);
    if (["main.js", "README.md"].includes(name)) continue;
    assert.ok(
      (parts[0] === "app" && parts.length >= 2) ||
        (parts[0] === "features" && parts.length >= 3 && features.has(parts[1])) ||
        (parts[0] === "shared" && parts.length >= 3 && sharedGroups.has(parts[1])),
      `${name}: place frontend files in app, a declared feature, or shared group`,
    );
    const naming = path.extname(file) === ".vue"
      ? /^[A-Z][A-Za-z0-9]*\.vue$/
      : /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.(?:js|css)$/;
    assert.ok(basename === "README.md" || naming.test(basename),
      `${name}: use PascalCase Vue components and kebab-case JS/CSS modules`);
  }
});

test("frontend relative static and dynamic imports resolve within allowed layers", () => {
  let checked = 0;
  for (const file of filesIn(sourceRoot).filter((entry) => /\.(?:js|vue)$/.test(entry))) {
    const name = path.relative(sourceRoot, file).split(path.sep).join("/");
    const source = scriptSource(file, fs.readFileSync(file, "utf8"));
    for (const specifier of moduleImports(source, name).filter((entry) => entry.startsWith("."))) {
      const target = path.resolve(path.dirname(file), specifier);
      assert.ok(fs.existsSync(target) && fs.statSync(target).isFile(),
        `${name}: unresolved relative import ${specifier}`);
      if (isInside(sourceRoot, target)) {
        assert.ok(canImport(layer(file), layer(target)),
          `${name}: forbidden dependency on ${layer(target)}: ${specifier}`);
      } else {
        assert.ok(
          (layer(file).startsWith("features/") || layer(file) === "shared") &&
            isInside(catalogRoot, target) && path.extname(target) === ".json",
          `${name}: imports outside web/src must be shared JSON catalogs: ${specifier}`,
        );
      }
      checked++;
    }
  }
  assert.ok(checked > 0, "frontend import checks must inspect actual dependencies");
});

test("frontend scanner distinguishes imports from comments, strings and Vue styles", () => {
  const source = `<script setup>
    import {
      api,
    } from "../../shared/api/api.js";
    import "./theme.css";
    const details = () => import('./Details.vue');
    // import Missing from './comment.js';
    /* import('./block-comment.js') */
    const text = "import('./string.js')";
    const css = \`content: "import('./template.js')"\`;
  </script>
  <template><div>import('./template-content.js')</div></template>
  <style>.example::before { content: "import('./style-content.js')"; }</style>`;
  assert.deepEqual(moduleImports(scriptSource("Fixture.vue", source), "Fixture.vue"), [
    "../../shared/api/api.js", "./theme.css", "./Details.vue",
  ]);
  assert.throws(() => moduleImports("import(dynamicPath)", "Fixture.js"), /literal path/);
  assert.equal(canImport("features/tasks", "features/session"), false);
  assert.equal(canImport("features/tasks", "app"), false);
  assert.equal(canImport("shared", "features/tasks"), false);
  assert.equal(canImport("shared", "app"), false);
  assert.equal(canImport("app", "main"), false);
  assert.equal(canImport("features/tasks", "shared"), true);
  assert.equal(canImport("features/tasks", "features/tasks"), true);
});
