// Makes the listed packages unresolvable, as if they were not installed.
//
//   BLOCKED_PACKAGES="typeorm,@nestjs/typeorm,@mikro-orm/*" node --import ./scripts/block-packages.mjs app.mjs
//
// Loaded with --import, this file registers itself (module.register) as a resolve hook.
// Entries match a package name and its subpaths; a trailing "/*" matches a whole scope.
import { register } from "node:module";
import { isMainThread } from "node:worker_threads";

if (isMainThread) {
  const blocked = (process.env.BLOCKED_PACKAGES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  register(import.meta.url, { data: { blocked } });
}

let blocked = [];

export function initialize(data) {
  blocked = data?.blocked ?? [];
}

function isBlocked(specifier) {
  return blocked.some((entry) =>
    entry.endsWith("/*")
      ? specifier.startsWith(entry.slice(0, -1))
      : specifier === entry || specifier.startsWith(`${entry}/`),
  );
}

export async function resolve(specifier, context, nextResolve) {
  if (isBlocked(specifier)) {
    const error = new Error(
      `Cannot find package '${specifier}' imported from ${context.parentURL ?? "<entry>"} (blocked by scripts/block-packages.mjs)`,
    );
    error.code = "ERR_MODULE_NOT_FOUND";
    throw error;
  }
  return nextResolve(specifier, context);
}
