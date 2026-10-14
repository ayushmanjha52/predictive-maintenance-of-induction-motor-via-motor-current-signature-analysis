// Locates the backend virtualenv interpreter (shared by setup.mjs and run-api.mjs).
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BACKEND = path.join(ROOT, "backend");
export const VENV = path.join(BACKEND, ".venv");
export const VENV_PY =
  process.platform === "win32" ? path.join(VENV, "Scripts", "python.exe") : path.join(VENV, "bin", "python");

export function requireVenv() {
  if (!existsSync(VENV_PY)) {
    console.error("backend/.venv not found. Run `npm run setup` first.");
    process.exit(1);
  }
  return VENV_PY;
}
