const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createRequire } = require("node:module");
const { test } = require("node:test");
const { Linter } = require("eslint");

const root = path.resolve(__dirname, "../..");
const sourceRoot = path.join(root, "src");
const catalogRoot = path.join(root, "shared");
const dependencies = {
  shared: ["shared"],
  domain: ["domain", "shared"],
  storage: ["storage", "domain", "shared"],
  git: ["git", "domain", "shared"],
  config: ["config", "git", "storage", "domain", "shared"],
  codex: ["codex", "domain", "shared"],
  agents: ["agents", "codex", "domain", "shared"],
  execution: [
    "execution",
    "agents",
    "git",
    "config",
    "storage",
    "domain",
    "shared",
  ],
  channels: ["channels", "config", "storage", "domain", "shared"],
  application: [
    "application",
    "channels",
    "execution",
    "agents",
    "git",
    "config",
    "storage",
    "domain",
    "shared",
  ],
  http: ["http", "application", "config", "domain", "shared"],
  cli: [
    "cli",
    "http",
    "application",
    "channels",
    "execution",
    "agents",
    "config",
    "storage",
    "domain",
    "shared",
  ],
};

function isInside(directory, file) {
  const relative = path.relative(directory, file);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  });
}

function inspectModules() {
  return filesIn(sourceRoot)
    .filter((file) => file.endsWith(".cjs"))
    .map((file) => {
      const name = path.relative(sourceRoot, file).split(path.sep).join("/");
      const group = name.split("/")[0];
      const source = fs.readFileSync(file, "utf8");
      const { imports, commandAccess, classes } = inspectSource(source);
      const resolve = createRequire(file).resolve;
      const local = imports
        .filter((specifier) => specifier.startsWith("."))
        .map((specifier) => {
          let target;
          try {
            target = resolve(specifier);
          } catch (error) {
            assert.fail(
              `${name}: unresolved dependency ${specifier}: ${error.message}`,
            );
          }
          return { target, specifier };
        });
      return { file, name, group, local, imports, commandAccess, classes };
    });
}

function inspectSource(source) {
  const imports = [];
  const commandAccess = [];
  const classes = [];
  const propertyName = (node) =>
    node.computed ? node.property.value : node.property.name;
  const messages = new Linter().verify(source, [
    {
      languageOptions: { sourceType: "commonjs", ecmaVersion: "latest" },
      plugins: {
        architecture: {
          rules: {
            inspect: {
              create(context) {
                return {
                  ClassDeclaration(node) {
                    classes.push(node.id.name);
                  },
                  ImportExpression(node) {
                    if (node.source.type !== "Literal" || typeof node.source.value !== "string")
                      context.report({ node, message: "Use literal imports so module boundaries can be checked." });
                    else imports.push(node.source.value);
                  },
                  CallExpression(node) {
                    if (
                      node.callee.type !== "Identifier" ||
                      node.callee.name !== "require"
                    )
                      return;
                    if (
                      node.arguments.length !== 1 ||
                      node.arguments[0].type !== "Literal" ||
                      typeof node.arguments[0].value !== "string"
                    ) {
                      context.report({
                        node,
                        message:
                          "Use literal CommonJS imports so module boundaries can be checked.",
                      });
                    } else imports.push(node.arguments[0].value);
                  },
                  MemberExpression(node) {
                    if (node.object.type !== "Identifier") return;
                    const object = node.object.name;
                    const property = propertyName(node);
                    if (
                      (object === "process" &&
                        [
                          "argv",
                          "stdout",
                          "stderr",
                          "exit",
                          "exitCode",
                        ].includes(property)) ||
                      (object === "require" && property === "main")
                    ) {
                      commandAccess.push(`${object}.${property}`);
                    }
                  },
                };
              },
            },
          },
        },
      },
      rules: { "architecture/inspect": "error" },
    },
  ]);
  assert.deepEqual(
    messages,
    [],
    "Architecture source parsing must succeed with literal imports.",
  );
  return { imports, commandAccess, classes };
}

test("backend directories, modules and classes use matching responsibility names", () => {
  for (const file of filesIn(sourceRoot)) {
    const parts = path.relative(sourceRoot, file).split(path.sep);
    assert.ok(parts.slice(0, -1).every((part) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(part)),
      `${file}: directories must use kebab-case`);
    assert.ok(parts.at(-1) === "README.md" || /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.cjs$/.test(parts.at(-1)),
      `${file}: backend modules must use kebab-case .cjs names`);
  }
  for (const module of inspectModules()) {
    for (const name of module.classes) {
      assert.match(name, /^[A-Z][A-Za-z0-9]*$/, `${module.name}: classes must use PascalCase`);
      const filename = name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
      assert.equal(path.basename(module.file, ".cjs"), filename,
        `${module.name}: give each class its own corresponding kebab-case module`);
    }
    for (const { specifier } of module.local)
      assert.match(specifier, /\.(?:cjs|json)$/, `${module.name}: local imports need explicit extensions`);
  }
});

test("tests use kebab-case .test.cjs names while fixtures and helpers use .cjs", () => {
  const testRoot = path.join(root, "test");
  for (const file of filesIn(testRoot)) {
    const parts = path.relative(testRoot, file).split(path.sep);
    assert.ok(["architecture", "unit", "integration", "browser", "fixtures", "support"].includes(parts[0]),
      `${file}: select a declared test category`);
    assert.ok(parts.slice(0, -1).every((part) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(part)));
    const isTest = ["architecture", "unit", "integration", "browser"].includes(parts[0]);
    const suffix = isTest ? "\\.test\\.cjs" : "\\.cjs";
    assert.match(parts.at(-1), new RegExp(`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*${suffix}$`),
      `${file}: use <kebab-case>${isTest ? ".test.cjs" : ".cjs"} in ${parts[0]}`);
  }
});

test("backend modules resolve within their declared layers and shared catalogs", () => {
  const modules = inspectModules();
  assert.ok(modules.length > 0);
  for (const module of modules) {
    assert.ok(
      Object.hasOwn(dependencies, module.group),
      `${module.name}: place backend code in a declared module directory`,
    );
    for (const { target, specifier } of module.local) {
      if (isInside(sourceRoot, target)) {
        const targetGroup = path
          .relative(sourceRoot, target)
          .split(path.sep)[0];
        assert.ok(
          dependencies[module.group].includes(targetGroup),
          `${module.name} must not depend on ${targetGroup}: ${specifier}`,
        );
        if (module.group === "channels" && module.name.split("/").length > 2) {
          const channel = module.name.split("/")[1];
          const targetName = path
            .relative(sourceRoot, target)
            .split(path.sep)
            .join("/");
          assert.ok(
            targetGroup !== "channels" ||
              targetName.startsWith(`channels/${channel}/`),
            `${module.name}: a channel cannot import another channel or the registry`,
          );
        }
        if (module.group === "http" && targetGroup === "config")
          assert.equal(
            target,
            path.join(sourceRoot, "config/runtime.cjs"),
            `${module.name}: settings operations belong to application services`,
          );
        if (module.group === "application" && targetGroup === "git")
          assert.notEqual(target, path.join(sourceRoot, "git/command.cjs"),
            `${module.name}: use Git operation APIs instead of composing commands in application services`);
      } else {
        const generatedPrismaClient = module.name === "storage/postgres-database.cjs" &&
          target === path.join(root, "generated/prisma-runtime/client.cjs");
        assert.ok(
          generatedPrismaClient || (module.group === "domain" &&
            isInside(catalogRoot, target) &&
            path.extname(target) === ".json"),
          `${module.name}: only domain catalogs or the storage-owned generated Prisma client may be imported outside src: ${specifier}`,
        );
      }
    }
  }
});

test("only CLI adapters access command arguments, terminal output and process exit", () => {
  for (const module of inspectModules()) {
    if (module.group !== "cli")
      assert.deepEqual(module.commandAccess, [], module.name);
    if (module.group === "domain")
      assert.ok(
        !module.imports.some((specifier) =>
          /^(?:node:)?(?:fs|child_process|http|https|net)(?:\/|$)/.test(
            specifier,
          ),
        ),
        `${module.name}: domain rules cannot perform storage, subprocess or network I/O`,
      );
    if (["storage", "config"].includes(module.group))
      assert.ok(
        !module.imports.some((specifier) =>
          /^(?:node:)?child_process$/.test(specifier),
        ),
        `${module.name}: Git/process operations must have their own infrastructure module`,
      );
    if (module.group === "application")
      assert.ok(!module.imports.some((specifier) => /^(?:node:)?fs(?:\/|$)/.test(specifier)),
        `${module.name}: application services use storage APIs instead of owning disk formats`);
    if (module.group !== "storage")
      assert.ok(!module.imports.some((specifier) => /^(?:better-sqlite3|knex|pg|prisma|@prisma\/[^/]+)(?:\/|$)/.test(specifier)),
        `${module.name}: database drivers and migrations belong to storage`);
    if (module.name === "execution/runner.cjs")
      assert.ok(!module.imports.some((specifier) => /^(?:node:)?fs(?:\/|$)/.test(specifier)),
        `${module.name}: execution persistence belongs in ExecutionStore`);
  }
});

test("architecture inspection recognizes real dependencies and ignores example text", () => {
  assert.deepEqual(
    inspectSource(
      `// require('bad'); process.argv\nconst example = "process.exit(1)";`,
    ),
    { imports: [], commandAccess: [], classes: [] },
  );
  assert.deepEqual(
    inspectSource(`require('./task.cjs'); process['argv']; require.main;`),
    {
      imports: ["./task.cjs"],
      commandAccess: ["process.argv", "require.main"],
      classes: [],
    },
  );
  assert.throws(() => inspectSource("require(variable)"), /literal imports/);
  assert.throws(() => inspectSource("import(variable)"), /literal imports/);
  assert.deepEqual(inspectSource("class ExampleClient {} import('vite');"), {
    imports: ["vite"], commandAccess: [], classes: ["ExampleClient"],
  });
});

test("backend module dependencies do not contain cycles", () => {
  const modules = inspectModules();
  const graph = new Map(modules.map((module) => [module.file, module]));
  const completed = new Set();
  const active = [];
  function visit(file) {
    const cycleStart = active.indexOf(file);
    assert.equal(
      cycleStart,
      -1,
      `Dependency cycle: ${active
        .slice(cycleStart)
        .concat(file)
        .map((entry) => graph.get(entry).name)
        .join(" -> ")}`,
    );
    if (completed.has(file)) return;
    active.push(file);
    for (const { target } of graph.get(file).local) {
      if (graph.has(target)) visit(target);
    }
    active.pop();
    completed.add(file);
  }
  for (const module of modules) visit(module.file);
});

test("agent protocol details cannot leak into business modules or Vue", () => {
  for (const module of inspectModules()) {
    if (["codex", "agents"].includes(module.group)) continue;
    const source = fs.readFileSync(module.file, "utf8");
    assert.doesNotMatch(source, /["'](?:thread\/(?:start|resume|read|items\/list)|turn\/(?:start|steer|interrupt|started|completed)|item\/(?:tool\/requestUserInput|commandExecution\/requestApproval))["']/,
      `${module.name}: native protocol belongs to a provider`);
    assert.doesNotMatch(source, /\b(?:config|state|task)\.(?:codex|codex_prompt)\b/,
      `${module.name}: use neutral execution, agent and prompt records`);
  }
  for (const file of filesIn(path.join(root, "web/src")).filter(file => /\.(?:vue|js)$/.test(file)))
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /item\/tool\/requestUserInput|request\.method|request\.params|rpcId/,
      `${file}: consume normalized interactive requests`);
});

test("package Node entrypoints still resolve after module moves", () => {
  const scripts = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ).scripts;
  const entries = Object.entries(scripts).flatMap(([name, command]) =>
    [...command.matchAll(/\bnode\s+(?:--env-file-if-exists=\.env\s+)?(src\/[\w/-]+\.cjs)\b/g)].map((match) => ({
      name,
      file: match[1],
    })),
  );
  assert.ok(entries.length > 0);
  for (const { name, file } of entries) {
    assert.ok(
      file.startsWith("src/cli/"),
      `${name}: process entrypoints belong in src/cli/`,
    );
    assert.ok(
      fs.statSync(path.join(root, file)).isFile(),
      `${name}: missing entrypoint ${file}`,
    );
  }
});

test("installation root and shared catalogs stay independent of cwd and data root", (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "web-coding-architecture-"),
  );
  t.after(() => {
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert.ok(path.basename(directory).startsWith("web-coding-architecture-"));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  });
  const runtime = path.join(sourceRoot, "config", "runtime.cjs");
  const program = `
    const runtime = require(${JSON.stringify(runtime)});
    require(${JSON.stringify(path.join(sourceRoot, "domain", "project-permissions.cjs"))});
    require(${JSON.stringify(path.join(sourceRoot, "domain", "workspace-icon.cjs"))});
    process.stdout.write(JSON.stringify({ root: runtime.root, dataRoot: runtime.dataRoot }));
  `;
  for (const dataRoot of [undefined, path.join(directory, "separate-data")]) {
    const env = { ...process.env };
    delete env.RUNNER_DATA_DIR;
    if (dataRoot) env.RUNNER_DATA_DIR = dataRoot;
    const result = JSON.parse(
      execFileSync(process.execPath, ["-e", program], {
        cwd: directory,
        env,
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    assert.equal(result.root, root);
    assert.equal(result.dataRoot, dataRoot || root);
  }
});
