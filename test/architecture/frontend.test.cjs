const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { Linter } = require("eslint");
const { parse } = require("vue/compiler-sfc");

const root = path.resolve(__dirname, "../..");
const sourceRoot = path.join(root, "web/src");
const catalogRoot = path.join(root, "shared");
const features = new Set(["accounts", "workspaces", "tasks", "session", "settings", "projects", "setup"]);
const sharedGroups = new Set(["api", "components", "styles", "i18n"]);

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
  const { descriptor, errors } = parse(source, { filename: file });
  assert.deepEqual(errors, [], `${file}: Vue components must parse`);
  return [descriptor.script, descriptor.scriptSetup]
    .filter(Boolean).map((script) => script.content).join("\n");
}

function moduleImports(source, name) {
  const imports = [];
  const messages = new Linter().verify(source, [{
    languageOptions: { sourceType: "module", ecmaVersion: "latest" },
    plugins: {
      architecture: {
        rules: {
          inspect: {
            create(context) {
              function collect(node) {
                if (!node.source) return;
                if (node.source.type !== "Literal" || typeof node.source.value !== "string")
                  context.report({ node, message: "Module imports must use a literal path." });
                else imports.push(node.source.value);
              }
              return {
                ImportDeclaration: collect,
                ImportExpression: collect,
                ExportNamedDeclaration: collect,
                ExportAllDeclaration: collect,
              };
            },
          },
        },
      },
    },
    rules: { "architecture/inspect": "error" },
  }]);
  assert.deepEqual(messages, [], `${name}: imports must parse and use a literal path`);
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
    assert.ok(parts.slice(0, -1).every((part) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(part)),
      `${name}: directories must use kebab-case`);
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
  const graph = new Map();
  for (const file of filesIn(sourceRoot).filter((entry) => /\.(?:js|vue)$/.test(entry))) {
    const name = path.relative(sourceRoot, file).split(path.sep).join("/");
    const source = scriptSource(file, fs.readFileSync(file, "utf8"));
    const targets = [];
    graph.set(file, targets);
    for (const specifier of moduleImports(source, name).filter((entry) => entry.startsWith("."))) {
      assert.match(specifier, /\.(?:js|vue|css|json)$/, `${name}: local imports need explicit extensions`);
      const target = path.resolve(path.dirname(file), specifier);
      targets.push(target);
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
  const completed = new Set();
  const active = new Set();
  function visit(file) {
    assert.ok(!active.has(file), `Frontend dependency cycle at ${path.relative(sourceRoot, file)}`);
    if (completed.has(file)) return;
    active.add(file);
    for (const target of graph.get(file) || []) visit(target);
    active.delete(file);
    completed.add(file);
  }
  for (const file of graph.keys()) visit(file);
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
  assert.deepEqual(moduleImports(`export { api } from './api.js'; export * from './shared.js';
    const text = \`result: \${import('./lazy.js')}\`;`, "fixture.js"), [
    "./api.js", "./shared.js", "./lazy.js",
  ]);
  assert.equal(canImport("features/tasks", "features/session"), false);
  assert.equal(canImport("features/tasks", "app"), false);
  assert.equal(canImport("shared", "features/tasks"), false);
  assert.equal(canImport("shared", "app"), false);
  assert.equal(canImport("app", "main"), false);
  assert.equal(canImport("features/tasks", "shared"), true);
  assert.equal(canImport("features/tasks", "features/tasks"), true);
});
