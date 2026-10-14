// One-time setup: backend virtualenv + Python deps, frontend npm deps, synthetic features.
// Picks the first Python 3.10+ that actually has pip (a bare `python` on PATH may not).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { BACKEND, ROOT, VENV, VENV_PY } from "./python.mjs";

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) {
    console.error(`\n✖ ${cmd} ${args.join(" ")} failed`);
    process.exit(r.status ?? 1);
  }
};

const candidates =
  process.platform === "win32"
    ? [["py", ["-3.12"]], ["py", ["-3.11"]], ["py", ["-3"]], ["python", []], ["python3", []]]
    : [["python3.12", []], ["python3.11", []], ["python3", []], ["python", []]];

function findPython() {
  for (const [cmd, pre] of candidates) {
    const probe = spawnSync(
      cmd,
      [...pre, "-c", "import sys, ensurepip, venv; assert sys.version_info >= (3, 10); print(sys.executable)"],
      { encoding: "utf8" },
    );
    if (probe.status === 0) return [cmd, pre, probe.stdout.trim()];
  }
  return null;
}

if (!existsSync(VENV_PY)) {
  const found = findPython();
  if (!found) {
    console.error("No Python 3.10+ with venv/pip found. Install Python from python.org and re-run.");
    process.exit(1);
  }
  const [cmd, pre, exe] = found;
  console.log(`› creating backend/.venv with ${exe}`);
  run(cmd, [...pre, "-m", "venv", VENV]);
}
console.log("› installing Python packages");
run(VENV_PY, ["-m", "pip", "install", "--upgrade", "pip", "--quiet"]);
run(VENV_PY, ["-m", "pip", "install", "-r", path.join(BACKEND, "requirements-dev.txt"), "--quiet"]);

if (!existsSync(path.join(BACKEND, "data", "features.csv")) && !existsSync(path.join(BACKEND, "data", "features_synthetic.csv"))) {
  console.log("› no features file found; generating the synthetic demo dataset (~1 min)");
  run(VENV_PY, ["build_features.py", "--synthetic"], { cwd: BACKEND });
}

console.log("› installing frontend packages");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
run(npm, ["install", "--no-fund"], { cwd: path.join(ROOT, "frontend"), shell: process.platform === "win32" });
console.log("\n✓ setup complete. Start everything with: npm run dev");
