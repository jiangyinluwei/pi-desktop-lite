/**
 * Windows-safe Python command resolution.
 *
 * pi-ocr spawns Python for image→PDF wrapping, PDF splitting and Pix2Text.
 * On Windows the `python3` executable on PATH is usually the Microsoft Store
 * "app execution alias" stub: it exits with code 49 and prints
 * "Python was not found; run without arguments to install from the Microsoft
 * Store..." instead of running anything. The real interpreter is typically
 * available as `python`. So we probe candidates and pick the first one that
 * actually executes, caching the result for the process lifetime.
 */

let cachedCmd: string | null = null;

const CANDIDATES = process.platform === "win32"
	? ["python", "python3", "py"]
	: ["python3", "python"];

async function tryCmd(cmd: string): Promise<boolean> {
	const { spawn } = await import("node:child_process");
	return new Promise((resolve) => {
		const child = spawn(cmd, ["-c", "import sys; print(sys.version_info[:2])"], {
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
		});
		let out = "";
		child.stdout.on("data", (d) => (out += d.toString()));
		child.on("error", () => resolve(false));
		child.on("close", (code) => resolve(code === 0 && out.trim().length > 0));
	});
}

/** Resolve a working Python command, cached after first success. */
export async function getPythonCmd(): Promise<string> {
	if (cachedCmd) return cachedCmd;
	for (const cmd of CANDIDATES) {
		if (await tryCmd(cmd)) {
			cachedCmd = cmd;
			return cmd;
		}
	}
	// Last resort: let the spawn below produce its native error.
	cachedCmd = CANDIDATES[0];
	return cachedCmd;
}
