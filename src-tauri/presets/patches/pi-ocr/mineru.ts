/**
 * pi-ocr — MinerU API backend
 *
 * Uses the free Agent Lightweight API (no token required):
 *   - File ≤10MB, ≤20 pages → one free request
 *   - File ≤10MB, >20 pages → auto-splits into ≤20-page chunks (if mineruSplitPdf enabled)
 *   - File >10MB → warns and suggests compression at ilovepdf.com
 *
 * API flow (file mode) — each chunk is a SEPARATE request (not batch):
 *   1. POST /api/v1/agent/parse/file → task_id + signed OSS upload URL
 *   2. PUT file bytes to signed URL
 *   3. Poll GET /api/v1/agent/parse/{task_id} until state=done
 *   4. GET markdown_url → download final Markdown
 *
 * PDF splitting uses pypdfium2 (same dep as Pix2Text backend).
 */

import {
	readFileSync,
	mkdtempSync,
	unlinkSync,
	rmdirSync,
	readdirSync,
} from "node:fs";
import { basename, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { OcrResult, OcrProgressCallback } from "./types";
import { getPdfPageCount } from "./ollama";
import { getPythonCmd } from "./python";

const BASE_URL = "https://mineru.net/api/v1/agent";

// ── Python PDF splitter (uses pypdfium2) ─────────────────────────────────────

const PDF_SPLIT_SCRIPT = `
import sys, json, os
import pypdfium2 as pdfium

input_path = sys.argv[1]
chunk_size = int(sys.argv[2])
output_dir = sys.argv[3]

src = pdfium.PdfDocument(input_path)
total = len(src)

results = []
for start in range(0, total, chunk_size):
    end = min(start + chunk_size, total)

    # Create a new PDF with pages [start, end)
    dst = pdfium.PdfDocument.new()
    dst.import_pages(src, list(range(start, end)))
    out_path = os.path.join(output_dir, f"chunk_{start // chunk_size + 1}.pdf")
    dst.save(out_path)
    dst.close()

    results.append({"path": out_path, "firstPage": start + 1, "lastPage": end})

src.close()
print(json.dumps({"total": total, "chunks": results}))
`;

async function execPy(code: string, args: string[]): Promise<string> {
	const pyCmd = await getPythonCmd();
	return new Promise((resolve, reject) => {
		const child = spawn(pyCmd, ["-c", code, ...args], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		const out: Buffer[] = [];
		const err: Buffer[] = [];
		child.stdout.on("data", (d) => out.push(d));
		child.stderr.on("data", (d) => err.push(d));
		child.on("error", () =>
			reject(
				new Error(
					"python3 not found. Install Python 3 and pypdfium2:\n  pip install pypdfium2",
				),
			),
		);
		child.on("close", (code) => {
			if (code === 0) resolve(Buffer.concat(out).toString("utf8").trim());
			else
				reject(
					new Error(
						Buffer.concat(err).toString("utf8").trim() ||
							`python3 exited with code ${code}`,
					),
				);
		});
	});
}

function rmdirSafe(dir: string) {
	try {
		for (const f of readdirSync(dir)) unlinkSync(join(dir, f));
		rmdirSync(dir);
	} catch {
		/* best effort */
	}
}

// ── MinerU API helpers ───────────────────────────────────────────────────────

async function apiPost(
	url: string,
	body: Record<string, unknown>,
): Promise<{ task_id: string; file_url?: string }> {
	const resp = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(30_000),
	});

	if (resp.status === 429)
		throw new Error(
			"MinerU rate limit (429). Wait a minute and retry, or switch backend with /ocr.",
		);
	if (!resp.ok) {
		const text = await resp.text().catch(() => "");
		throw new Error(`MinerU API error ${resp.status}: ${text.slice(0, 200)}`);
	}

	const data = (await resp.json()) as {
		code: number;
		msg: string;
		data: { task_id: string; file_url?: string };
	};
	if (data.code !== 0 || !data.data?.task_id) {
		throw new Error(`MinerU API error: ${data.msg || "no task_id returned"}`);
	}

	return { task_id: data.data.task_id, file_url: data.data.file_url };
}

async function putFile(uploadUrl: string, filePath: string): Promise<void> {
	const fileData = readFileSync(filePath);
	const resp = await fetch(uploadUrl, {
		method: "PUT",
		body: fileData,
		signal: AbortSignal.timeout(60_000),
	});
	if (!resp.ok) {
		const text = await resp.text().catch(() => "");
		throw new Error(
			`File upload failed (${resp.status}): ${text.slice(0, 200)}`,
		);
	}
}

async function pollTask(
	taskId: string,
	timeoutMs: number,
	progressPrefix: string,
	onProgress: OcrProgressCallback,
): Promise<string> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const resp = await fetch(`${BASE_URL}/parse/${taskId}`, {
			signal: AbortSignal.timeout(10_000),
		});

		if (resp.status === 429)
			throw new Error(
				"MinerU rate limit (429). Wait a minute and retry, or switch backend with /ocr.",
			);
		if (!resp.ok) {
			const text = await resp.text().catch(() => "");
			throw new Error(
				`MinerU poll error ${resp.status}: ${text.slice(0, 200)}`,
			);
		}

		const data = (await resp.json()) as {
			code: number;
			data: {
				state: string;
				markdown_url?: string;
				err_msg?: string;
				err_code?: number;
			};
		};

		const state = data.data?.state || "unknown";

		if (state === "done") {
			const markdownUrl = data.data.markdown_url;
			if (!markdownUrl)
				throw new Error("MinerU returned done state but no markdown_url");
			const mdResp = await fetch(markdownUrl, {
				signal: AbortSignal.timeout(60_000),
			});
			if (!mdResp.ok)
				throw new Error(`Failed to download markdown: ${mdResp.status}`);
			return mdResp.text();
		}

		if (state === "failed") {
			throw new Error(
				`MinerU parsing failed: ${data.data.err_msg || "unknown error"} (code: ${data.data.err_code})`,
			);
		}

		const elapsed = Math.floor((Date.now() - start) / 1000);
		onProgress(`${progressPrefix} ${state} (${elapsed}s)`);
		await new Promise((r) => setTimeout(r, 3000));
	}
	throw new Error(`MinerU task ${taskId} timed out after ${timeoutMs / 1000}s`);
}

// ── Single-file processing (one individual request, NOT batch) ───────────────

async function mineruProcessFile(
	filePath: string,
	fileName: string,
	progressPrefix: string,
	onProgress: OcrProgressCallback,
): Promise<string> {
	const stats = await stat(filePath);
	const sizeMB = stats.size / (1024 * 1024);
	if (sizeMB > 10) {
		throw new Error(
			`File too large for free MinerU API: ${sizeMB.toFixed(1)}MB (limit: 10MB).\n` +
				`Compress at https://ilovepdf.com/compress_pdf or switch to Ollama/Pix2Text backend with /ocr.`,
		);
	}

	// Step 1: Get signed upload URL
	onProgress(`${progressPrefix} uploading…`);
	const { task_id, file_url } = await apiPost(`${BASE_URL}/parse/file`, {
		file_name: fileName,
		language: "ch", // Chinese + English (default: ch_server for better handwriting/Japanese)
		enable_table: true,
		enable_formula: true,
		is_ocr: false,
	});

	if (!file_url) {
		throw new Error(
			"MinerU did not return a file upload URL — this endpoint may have changed.",
		);
	}

	// Step 2: Upload file bytes
	await putFile(file_url, filePath);

	// Step 3 + 4: Poll for result and download markdown
	onProgress(`${progressPrefix} pending…`);
	const markdown = await pollTask(task_id, 300_000, progressPrefix, onProgress);
	onProgress(`${progressPrefix} done`);
	return markdown;
}

// ── Image → PDF wrapper (so MinerU applies language=\"ch\" pipeline) ──────────

const IMG2PDF_SCRIPT = `
import sys
from PIL import Image
img = Image.open(sys.argv[1])
img.save(sys.argv[2], "PDF")
`;

async function wrapImageAsPdf(
	imagePath: string,
	pdfPath: string,
): Promise<void> {
	await execPy(IMG2PDF_SCRIPT, [imagePath, pdfPath]);
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function mineruOcr(
	filePath: string,
	splitPdf: boolean,
	signal: AbortSignal | undefined,
	onProgress: OcrProgressCallback,
): Promise<OcrResult> {
	const ext = extname(filePath).toLowerCase();
	const fileName = basename(filePath);

	// For images (non-PDF): wrap in PDF so MinerU applies language=\"ch\" pipeline
	if (ext !== ".pdf") {
		if (
			![
				".png",
				".jpg",
				".jpeg",
				".gif",
				".webp",
				".bmp",
				".tiff",
				".tif",
			].includes(ext)
		) {
			throw new Error(
				`MinerU does not support this file type: ${ext}. Use PDF, PNG, JPG, Docx, PPTx, or Xlsx.`,
			);
		}

		// Wrap image as 1-page PDF so language/chinese OCR works
		onProgress("[1/1] converting image to PDF…");
		const pdfPath = join(tmpdir(), `pi-mineru-img-${Date.now()}.pdf`);
		try {
			await wrapImageAsPdf(filePath, pdfPath);
			const pdfName = fileName.replace(/\.[^.]+$/, "") + ".pdf";
			const markdown = await mineruProcessFile(
				pdfPath,
				pdfName,
				"[1/1]",
				onProgress,
			);
			return {
				text: markdown,
				details: { backend: "mineru", fileName, pages: 1 },
			};
		} finally {
			try {
				unlinkSync(pdfPath);
			} catch {
				/* cleanup */
			}
		}
	}

	// ── PDF handling ──
	const pageCount = await getPdfPageCount(filePath);

	const totalStats = await stat(filePath);
	const totalMB = totalStats.size / (1024 * 1024);

	if (totalMB > 10) {
		onProgress(
			`⚠️ PDF is ${totalMB.toFixed(1)}MB — MinerU free tier limit is 10MB.\n` +
				`💡 Compress at https://ilovepdf.com/compress_pdf first, or switch backend with /ocr.`,
		);
	}

	// Single chunk case: one individual request
	if (pageCount <= 20) {
		const markdown = await mineruProcessFile(
			filePath,
			fileName,
			"[1/1]",
			onProgress,
		);
		return {
			text: markdown,
			details: { backend: "mineru", fileName, pages: pageCount },
		};
	}

	// ── Multi-chunk: split PDF and process each chunk as SEPARATE requests ──
	if (!splitPdf) {
		onProgress(
			`⚠️ PDF has ${pageCount} pages but splitting is disabled.\n` +
				`Enable in /ocr settings → "MinerU: Split PDF >20 pages: ON"`,
		);
		try {
			const markdown = await mineruProcessFile(
				filePath,
				fileName,
				"[1/1]",
				onProgress,
			);
			return {
				text: markdown,
				details: { backend: "mineru", fileName, pages: pageCount },
			};
		} catch (e: any) {
			throw new Error(
				`${e.message}\n\n💡 Enable PDF splitting in /ocr settings.`,
			);
		}
	}

	onProgress(`Splitting ${pageCount}-page PDF into ≤20-page chunks…`);

	const splitDir = mkdtempSync(join(tmpdir(), "pi-mineru-split-"));
	try {
		const raw = await execPy(PDF_SPLIT_SCRIPT, [filePath, "20", splitDir]);
		const { chunks } = JSON.parse(raw) as {
			total: number;
			chunks: Array<{ path: string; firstPage: number; lastPage: number }>;
		};

		const results: string[] = [];
		const oversizedChunks: number[] = [];

		for (let i = 0; i < chunks.length; i++) {
			if (signal?.aborted) throw new Error("Aborted");
			const chunk = chunks[i];
			const prefix = `[${i + 1}/${chunks.length}]`;

			// Check chunk size before processing
			const chunkStats = await stat(chunk.path);
			const chunkMB = chunkStats.size / (1024 * 1024);
			if (chunkMB > 10) {
				oversizedChunks.push(i + 1);
				results.push(
					`## Pages ${chunk.firstPage}-${chunk.lastPage}\n\n> ⚠️ Skipped: chunk too large for free MinerU API (${chunkMB.toFixed(1)}MB, limit: 10MB). Compress PDF and retry.`,
				);
				onProgress(
					`${prefix} skipped (${chunkMB.toFixed(1)}MB — exceeds 10MB limit)`,
				);
				continue;
			}

			if (i > 0) {
				onProgress(`${prefix} waiting rate limit…`);
				await new Promise((r) => setTimeout(r, 3_000));
			}

			const chunkName = `${fileName.replace(/\.pdf$/i, "")}_p${chunk.firstPage}-${chunk.lastPage}.pdf`;
			const markdown = await mineruProcessFile(
				chunk.path,
				chunkName,
				prefix,
				onProgress,
			);
			results.push(
				`## Pages ${chunk.firstPage}-${chunk.lastPage}\n\n${markdown}`,
			);
		}

		if (oversizedChunks.length > 0) {
			onProgress(
				`⚠️ Skipped ${oversizedChunks.length} chunk(s) (chunks ${oversizedChunks.join(", ")}) — exceeded 10MB limit. Compress PDF at https://ilovepdf.com/compress_pdf and retry.`,
			);
		}

		return {
			text: results.join("\n\n"),
			details: {
				backend: "mineru",
				fileName,
				pages: pageCount,
				chunks: chunks.length,
			},
		};
	} finally {
		rmdirSafe(splitDir);
	}
}
