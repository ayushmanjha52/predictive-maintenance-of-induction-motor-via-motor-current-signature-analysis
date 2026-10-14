// Runs the FastAPI backend (or its tests / audit) with the venv interpreter.
// Arguments are passed as an array, so paths with spaces are safe.
//
// Dev reload is done here rather than with `uvicorn --reload`: on Windows the
// uvicorn reloader restarts its worker with a console-wide CTRL_C_EVENT, which
// also kills every other process in the terminal (Vite, concurrently).
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { BACKEND, requireVenv } from "./python.mjs";

const py = requireVenv();
const flag = process.argv[2];
const env = { ...process.env };

function once(args) {
  const child = spawn(py, args, { cwd: BACKEND, env, stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

if (flag === "--test") {
  once(["-m", "pytest", "-q", "-p", "no:cacheprovider", "tests"]);
} else if (flag === "--audit") {
  once(["-m", "pip_audit", "-r", "requirements.txt"]);
} else {
  const dev = flag === "--dev";
  if (dev) env.APP_ENV = env.APP_ENV ?? "development";
  const args = [
    "-m", "uvicorn", "main:app",
    "--host", process.env.API_HOST ?? "127.0.0.1",
    "--port", process.env.API_PORT ?? "8000",
    "--no-server-header",
  ];

  let child = null;
  let restarting = false;
  const start = () => {
    child = spawn(py, args, { cwd: BACKEND, env, stdio: "inherit" });
    child.on("exit", (code) => {
      if (restarting) {
        restarting = false;
        start();
      } else if (!dev) {
        process.exit(code ?? 0);
      } else {
        console.log(`API exited (code ${code}); waiting for a file change to restart`);
        child = null;
      }
    });
  };
  start();

  if (dev) {
    let timer = null;
    watch(BACKEND, (_event, file) => {
      if (!file || !file.endsWith(".py")) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        console.log(`${file} changed, restarting`);
        if (child) {
          restarting = true;
          child.kill();
        } else {
          start();
        }
      }, 300);
    });
  }

  const stop = () => {
    restarting = false;
    child?.kill();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
