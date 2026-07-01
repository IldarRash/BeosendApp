import { spawnSync } from "node:child_process";

const scopeAliases = new Map([
  ["admin", "@beosand/admin"],
  ["api", "@beosand/api"],
  ["bot", "@beosand/bot"],
  ["config", "@beosand/config"],
  ["db", "@beosand/db"],
  ["i18n", "@beosand/i18n"],
  ["miniapp", "@beosand/miniapp"],
  ["types", "@beosand/types"],
  ["apps/admin", "@beosand/admin"],
  ["apps/api", "@beosand/api"],
  ["apps/bot", "@beosand/bot"],
  ["apps/miniapp", "@beosand/miniapp"],
  ["packages/config", "@beosand/config"],
  ["packages/db", "@beosand/db"],
  ["packages/i18n", "@beosand/i18n"],
  ["packages/types", "@beosand/types"]
]);

function usage() {
  console.log(`Usage:
  pnpm check              Run full workspace lint, then full workspace test
  pnpm check all          Same as no argument
  pnpm check admin        Run lint/test for @beosand/admin
  pnpm check @beosand/bot Run lint/test for an explicit pnpm filter`);
}

function quoteWindowsArg(value) {
  return /[\s"]/u.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

function run(command, args) {
  const result =
    process.platform === "win32"
      ? spawnSync([command, ...args].map(quoteWindowsArg).join(" "), {
          stdio: "inherit",
          shell: true
        })
      : spawnSync(command, args, {
          stdio: "inherit"
        });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const [rawScope] = process.argv.slice(2);

if (rawScope === "--help" || rawScope === "-h") {
  usage();
  process.exit(0);
}

const scope = rawScope && rawScope !== "all" ? scopeAliases.get(rawScope) ?? rawScope : null;

if (scope) {
  run("pnpm", ["--filter", scope, "lint"]);
  run("pnpm", ["--filter", scope, "test"]);
} else {
  run("pnpm", ["lint"]);
  run("pnpm", ["test"]);
}