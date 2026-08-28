import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import fs from "node:fs";

// 确保 Cargo 路径添加到 PATH 环境变量中
const cargoBinDir = path.join(os.homedir(), ".cargo", "bin");
const currentPath = process.env.PATH || "";

if (fs.existsSync(cargoBinDir) && !currentPath.split(path.delimiter).includes(cargoBinDir)) {
  process.env.PATH = `${cargoBinDir}${path.delimiter}${currentPath}`;
}

const args = process.argv.slice(2);
const cliPath = path.resolve("node_modules/@tauri-apps/cli/tauri.js");

const child = spawn(process.execPath, [cliPath, ...args], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
