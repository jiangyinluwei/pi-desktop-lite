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

const cargoExe = process.platform === "win32" && fs.existsSync(path.join(cargoBinDir, "cargo.exe"))
  ? path.join(cargoBinDir, "cargo.exe")
  : "cargo";

const manifestPath = path.resolve("src-tauri", "Cargo.toml");
const userArgs = process.argv.slice(2);
const args = ["check", "--manifest-path", manifestPath, "--color", "always", ...userArgs];

const child = spawn(cargoExe, args, {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32" && cargoExe === "cargo",
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
