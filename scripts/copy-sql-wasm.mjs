import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = dirname(require.resolve("sql.js"));
const destDir = join(root, "public");

// The bundler resolves sql.js to its "browser" build, which loads sql-wasm-browser.wasm;
// Node (tests) uses sql-wasm.wasm. Ship both.
const files = ["sql-wasm.wasm", "sql-wasm-browser.wasm"];

mkdirSync(destDir, { recursive: true });
for (const file of files) {
  copyFileSync(join(distDir, file), join(destDir, file));
}
console.log(`Copied ${files.join(", ")} to public/`);
