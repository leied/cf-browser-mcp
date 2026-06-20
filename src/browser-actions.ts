import type { Env, QuickActionJsonResult } from "./types";

async function parseJsonResult<T>(res: Response): Promise<T> {
	const data = (await res.json()) as QuickActionJsonResult<T>;
	if (!data.success) {
		const message = data.errors?.map((e) => e.message).join("; ") || `Browser Run request failed (${res.status})`;
		throw new Error(message);
	}
	return data.result as T;
}

function browserMsUsed(res: Response): string | null {
	return res.headers.get("X-Browser-Ms-Used");
}

export async function fetchMarkdown(env: Env, url: string): Promise<{ markdown: string; msUsed: string | null }> {
	const res = await env.BROWSER.quickAction("markdown", { url });
	const markdown = await parseJsonResult<string>(res);
	return { markdown, msUsed: browserMsUsed(res) };
}

export async function fetchContent(env: Env, url: string): Promise<{ html: string; msUsed: string | null }> {
	const res = await env.BROWSER.quickAction("content", { url });
	const html = await parseJsonResult<string>(res);
	return { html, msUsed: browserMsUsed(res) };
}

export async function fetchLinks(env: Env, url: string): Promise<{ links: string[]; msUsed: string | null }> {
	const res = await env.BROWSER.quickAction("links", { url });
	const links = await parseJsonResult<string[]>(res);
	return { links, msUsed: browserMsUsed(res) };
}

export interface SnapshotResult {
	content?: string;
	markdown?: string;
	screenshot?: string; // base64 PNG
	accessibilityTree?: unknown;
	msUsed: string | null;
}

export async function fetchSnapshot(
	env: Env,
	url: string,
	formats: string[] = ["markdown", "screenshot"],
): Promise<SnapshotResult> {
	const res = await env.BROWSER.quickAction("snapshot", { url, formats });
	const result = await parseJsonResult<Record<string, unknown>>(res);
	return {
		content: typeof result.content === "string" ? result.content : undefined,
		markdown: typeof result.markdown === "string" ? result.markdown : undefined,
		screenshot: typeof result.screenshot === "string" ? result.screenshot : undefined,
		accessibilityTree: result.accessibilityTree,
		msUsed: browserMsUsed(res),
	};
}

export async function fetchPdf(env: Env, url: string): Promise<{ pdfBase64: string; msUsed: string | null }> {
	const res = await env.BROWSER.quickAction("pdf", { url });
	if (!res.ok) {
		throw new Error(`Browser Run returned ${res.status} while rendering a PDF for ${url}`);
	}
	const buf = await res.arrayBuffer();
	return { pdfBase64: arrayBufferToBase64(buf), msUsed: browserMsUsed(res) };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
	let binary = "";
	const bytes = new Uint8Array(buf);
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}
	return btoa(binary);
}
