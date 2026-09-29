/**
 * pi-ocr — Pix2Text backend
 *
 * Uses Pix2Text (https://github.com/breezedeus/Pix2Text) — an open-source
 * Python alternative to Mathpix. Recognizes layouts, text, math formulas (LaTeX),
 * and tables, outputting Markdown directly. SMALL ONNX models, CPU-friendly.
 *
 * Prerequisites:
 *   pip install pix2text
 *
 * First run downloads ONNX models (~50MB) to ~/.pix2text/1.1/.
 *
 * Progress reporting: for multi-page PDFs, processes pages individually
 * and sends per-page progress via stderr (JSON lines), final result via stdout.
 */

import { spawn } from "node:child_process";
import { basename } from "node:path";
import { getPythonCmd } from "./python";
import type { OcrResult, OcrProgressCallback } from "./types";
import { isImage, isPdf } from "./ollama";

// ── Embedded Python OCR engine ───────────────────────────────────────────────
//
// For PDFs: extracts pages via PyMuPDF, runs Pix2Text on each page individually,
//           printing progress JSON to stderr so TypeScript can relay it.
// For images: single call to p2t.recognize().
//
// Usage: python3 -c SCRIPT <file_path> <task>
//   stdout → final Markdown result
//   stderr → progress lines: {"page": 1, "total": 10} / {"status": "loading"} / errors

const PIX2TEXT_ENGINE = `
import sys, os, json, io, tempfile
from pathlib import Path

file_path = sys.argv[1]
ext = Path(file_path).suffix.lower()

# Suppress noisy library output
os.environ.setdefault("DISABLE_TQDM", "1")

# Progress helper — JSON lines to stderr
def progress(payload):
    print(json.dumps(payload), file=sys.stderr, flush=True)

progress({"status": "loading", "message": "Initializing Pix2Text models..."})

# Auto-detect optimal GPU device
import torch
if torch.cuda.is_available():
    _device = "cuda"
elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
    _device = "mps"
else:
    _device = "cpu"

# Prevent MPS memory fragmentation on macOS
if _device == "mps":
    os.environ.setdefault("PYTORCH_MPS_HIGH_WATERMARK_RATIO", "0.0")

# Suppress model-loading noise on stdout during initialization
_real_stdout = sys.stdout
sys.stdout = sys.stderr

try:
    from pix2text import Pix2Text
    p2t = Pix2Text.from_config(enable_formula=True, enable_table=False, device=_device)
finally:
    sys.stdout = _real_stdout

if ext == ".pdf":
    import fitz  # PyMuPDF — already a pix2text dependency

    progress({"status": "loading", "message": "Opening PDF..."})
    doc = fitz.open(file_path)
    total = len(doc)
    progress({"status": "started", "pages": total})

    results = []
    for i in range(total):
        progress({"status": "page", "page": i + 1, "total": total})

        # Render page to PNG at 200 DPI
        page = doc[i]
        pix = page.get_pixmap(dpi=200)
        img_bytes = pix.tobytes("png")

        # Write to unique temp file (Pix2Text needs a file path)
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(img_bytes)
            tmp_path = f.name

        try:
            text = p2t.recognize(tmp_path)
            if text:
                results.append(f"## Page {i + 1}\\n\\n{text}")
            else:
                results.append(f"## Page {i + 1}\\n\\n> ⚠️ No text detected")
        except Exception as e:
            results.append(f"## Page {i + 1}\\n\\n> ⚠️ Error: {e}")
        finally:
            try:
                os.unlink(tmp_path)
            except:
                pass

    doc.close()
    progress({"status": "done", "pages": total})
    print("\\n\\n".join(results))

elif ext in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".tif"):
    progress({"status": "recognizing"})
    result = p2t.recognize(file_path)
    progress({"status": "done", "pages": 1})
    print(result if result else "")

else:
    progress({"status": "error", "message": f"Unsupported file type: {ext}"})
    print(f"ERROR: unsupported file type {ext}")
    sys.exit(1)
`;

// ── Subprocess runner with progress streaming ────────────────────────────────

async function execPythonWithProgress(
	code: string,
	args: string[],
	onProgress: OcrProgressCallback,
): Promise<{ stdout: string; exitCode: number }> {
	const pyCmd = await getPythonCmd();
	return new Promise((resolve) => {
		const child = spawn(pyCmd, ["-c", code, ...args], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		const outChunks: Buffer[] = [];
		let lastPageReported = 0;

		child.stdout.on("data", (d) => outChunks.push(d));

		// Buffer for stderr line reassembly across chunk boundaries
		let stderrBuf = "";
		child.stderr.on("data", (d) => {
			stderrBuf += d.toString("utf8");
			const lines = stderrBuf.split("\n");
			// Last element may be incomplete — keep it in the buffer
			stderrBuf = lines.pop() || "";
			// Parse JSON progress lines, ignore noisy library output
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed.startsWith("{")) continue;
				try {
					const p = JSON.parse(trimmed);
					if (p.status === "page" && p.page && p.total) {
						// Only report every 5th page or first/last to avoid spam
						if (p.page !== lastPageReported) {
							lastPageReported = p.page;
							onProgress(`📄 Page ${p.page}/${p.total}`);
						}
					} else if (p.status === "loading" && p.message) {
						onProgress(`⏳ ${p.message}`);
					} else if (p.status === "started" && p.pages) {
						onProgress(`📄 Processing ${p.pages} page(s) with Pix2Text…`);
					} else if (p.status === "done") {
						onProgress(`✅ Pix2Text complete (${p.pages} page(s))`);
					} else if (p.status === "error") {
						// Error will be handled by exit code
					}
				} catch {
					// Not JSON — library noise, ignore
				}
			}
		});

		child.on("error", () =>
			resolve({
				stdout: "",
				exitCode: 1,
			}),
		);

		child.on("close", (code) => {
			// Process any remaining buffered stderr line
			if (stderrBuf.trim().startsWith("{")) {
				try {
					const p = JSON.parse(stderrBuf.trim());
					if (p.status === "done" && p.pages) {
						onProgress(`✅ Pix2Text complete (${p.pages} page(s))`);
					}
				} catch {
					/* not valid JSON, ignore */
				}
			}
			resolve({
				stdout: Buffer.concat(outChunks).toString("utf8").trim(),
				exitCode: code ?? 1,
			});
		});
	});
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function pix2textOcr(
	filePath: string,
	_signal: AbortSignal | undefined,
	onProgress: OcrProgressCallback,
): Promise<OcrResult> {
	if (!isImage(filePath) && !isPdf(filePath)) {
		throw new Error(`Unsupported file type: ${basename(filePath)}`);
	}

	const { stdout, exitCode } = await execPythonWithProgress(
		PIX2TEXT_ENGINE,
		[filePath, "auto"],
		onProgress,
	);

	if (exitCode !== 0) {
		const msg = stdout || "Pix2Text failed";
		if (
			msg.includes("ModuleNotFoundError") ||
			msg.includes("No module named")
		) {
			throw new Error("Pix2Text not installed. Run:\n  pip install pix2text");
		}
		if (msg.includes("table-rec") || msg.includes("pytorch_model")) {
			throw new Error(
				"Pix2Text model download incomplete. Try:\n  pip install pix2text --upgrade",
			);
		}
		throw new Error(msg.slice(0, 1000));
	}

	if (!stdout || stdout.startsWith("ERROR:")) {
		return {
			text: "",
			details: { backend: "pix2text", warning: stdout || "no text detected" },
		};
	}

	return { text: stdout, details: { backend: "pix2text" } };
}
