import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Aggregate runner for the frontend self-checks. No test-framework dependency:
// each test_*.ts file is executed in its own Node process under
// --experimental-strip-types, mirroring backend/tests/run.py.
const here = dirname(fileURLToPath(import.meta.url));
const tests = readdirSync(here)
  .filter((name) => name.startsWith("test_") && name.endsWith(".ts"))
  .sort();

const selected = process.argv.slice(2);
const files = selected.length ? selected : tests;

for (const file of files) {
  const path = join(here, file);
  console.log(`\n==> ${file}`);
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", path],
    { stdio: "inherit", cwd: join(here, "..", "..") },
  );
  if (result.status) process.exit(result.status ?? 1);
}
