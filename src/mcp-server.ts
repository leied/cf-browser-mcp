import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { BlocklistConfig, Env } from "./types";
import {
  DEFAULT_BLOCKLIST,
  checkUrlAgainstBlocklist,
  getBlocklist,
} from "./blocklist";
import {
  fetchContent,
  fetchLinks,
  fetchMarkdown,
  fetchPdf,
  fetchSnapshot,
} from "./browser-actions";
import { cancelCrawl, getCrawlStatus, startCrawlAndWait } from "./crawl";
import { fetchYoutubeTranscript } from "./youtube-transcript";

function blockedResult(reason: string) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          `Blocked: ${reason}\n\n` +
          "This URL is on the configured blocklist, so no request was made. " +
          "Some reasons of the block may include promoting violence or inapproproate content. " +
          "INFORM the user about this and FIND alternative resources to achieve their goal.",
      },
    ],
    isError: true,
  };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

export class BrowserMcp extends McpAgent<Env> {
  server = new McpServer({ name: "browser-mcp", version: "1.0.0" });
  private readonly blocklistTtlMs = 30_000;
  private blocklistCache:
    | { value: BlocklistConfig; expiresAt: number }
    | null = null;
  private blocklistFetchPromise: Promise<BlocklistConfig> | null = null;

  private async getBlocklistCached(): Promise<BlocklistConfig> {
    const now = Date.now();
    if (this.blocklistCache && this.blocklistCache.expiresAt > now) {
      return this.blocklistCache.value;
    }

    if (!this.blocklistFetchPromise) {
      this.blocklistFetchPromise = getBlocklist(this.env)
        .catch(() => this.blocklistCache?.value ?? { ...DEFAULT_BLOCKLIST })
        .finally(() => {
          this.blocklistFetchPromise = null;
        });
    }

    const value = await this.blocklistFetchPromise;
    this.blocklistCache = { value, expiresAt: now + this.blocklistTtlMs };
    return value;
  }

  async init() {
    // ---------------------------------------------------------------
    // Page reading
    // ---------------------------------------------------------------

    this.server.registerTool(
      "fetch_markdown",
      {
        description:
          "Render a URL with a headless browser and return its content as clean Markdown. " +
          "Best for reading articles, docs, and other text-heavy pages. Checks the blocklist first.",
        inputSchema: { url: z.string().url() },
      },
      async ({ url }) => {
        const blocklist = await this.getBlocklistCached();
        const check = checkUrlAgainstBlocklist(url, blocklist);
        if (check.blocked) return blockedResult(check.reason!);

        try {
          const { markdown, msUsed } = await fetchMarkdown(this.env, url);
          const content: { type: "text"; text: string }[] = [
            { type: "text", text: markdown },
          ];
          if (msUsed)
            content.push({ type: "text", text: `[browser time: ${msUsed}ms]` });
          return { content };
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "fetch_content",
      {
        description:
          "Render a URL with a headless browser and return the fully rendered HTML (after JavaScript runs). " +
          "Use this when you need raw markup instead of Markdown. Checks the blocklist first.",
        inputSchema: { url: z.string().url() },
      },
      async ({ url }) => {
        const blocklist = await this.getBlocklistCached();
        const check = checkUrlAgainstBlocklist(url, blocklist);
        if (check.blocked) return blockedResult(check.reason!);

        try {
          const { html } = await fetchContent(this.env, url);
          return { content: [{ type: "text" as const, text: html }] };
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "fetch_snapshot",
      {
        description:
          "Capture multiple representations of a page in one call: Markdown, rendered HTML, a screenshot, " +
          "and/or the accessibility tree. Defaults to ['markdown', 'screenshot']. Checks the blocklist first.",
        inputSchema: {
          url: z.string().url(),
          formats: z
            .array(
              z.enum([
                "content",
                "markdown",
                "screenshot",
                "accessibilityTree",
              ]),
            )
            .optional()
            .describe(
              "Which representations to include. Defaults to ['markdown', 'screenshot'].",
            ),
        },
      },
      async ({ url, formats }) => {
        const blocklist = await this.getBlocklistCached();
        const check = checkUrlAgainstBlocklist(url, blocklist);
        if (check.blocked) return blockedResult(check.reason!);

        try {
          const snap = await fetchSnapshot(this.env, url, formats);
          const content: Array<
            | { type: "text"; text: string }
            | { type: "image"; data: string; mimeType: string }
          > = [];
          if (snap.markdown)
            content.push({ type: "text", text: snap.markdown });
          if (snap.content) content.push({ type: "text", text: snap.content });
          if (snap.accessibilityTree) {
            content.push({
              type: "text",
              text: JSON.stringify(snap.accessibilityTree, null, 2),
            });
          }
          if (snap.screenshot) {
            content.push({
              type: "image",
              data: snap.screenshot,
              mimeType: "image/png",
            });
          }
          if (content.length === 0) {
            content.push({
              type: "text",
              text: "Snapshot returned no data for the requested formats.",
            });
          }
          return { content };
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "fetch_pdf",
      {
        description:
          "Render a URL with a headless browser and return it as a PDF file. Checks the blocklist first.",
        inputSchema: { url: z.string().url() },
      },
      async ({ url }) => {
        const blocklist = await this.getBlocklistCached();
        const check = checkUrlAgainstBlocklist(url, blocklist);
        if (check.blocked) return blockedResult(check.reason!);

        try {
          const { pdfBase64 } = await fetchPdf(this.env, url);
          return {
            content: [
              {
                type: "resource" as const,
                resource: {
                  uri: url,
                  mimeType: "application/pdf",
                  blob: pdfBase64,
                },
              },
            ],
          };
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "get_links",
      {
        description:
          "Extract all links (including hidden ones) from a rendered page. Checks the blocklist first.",
        inputSchema: { url: z.string().url() },
      },
      async ({ url }) => {
        const blocklist = await this.getBlocklistCached();
        const check = checkUrlAgainstBlocklist(url, blocklist);
        if (check.blocked) return blockedResult(check.reason!);

        try {
          const { links } = await fetchLinks(this.env, url);
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(links, null, 2) },
            ],
          };
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "fetch_youtube_transcript",
      {
        description:
          "Fetch the transcript/captions for a YouTube video via youtube-transcript.io. " +
          "Accepts a full YouTube URL (watch, shorts, youtu.be) or a bare 11-character video ID.",
        inputSchema: {
          video: z.string().describe("YouTube URL or video ID."),
        },
      },
      async ({ video }) => {
        try {
          const { title, language, text } = await fetchYoutubeTranscript(
            this.env,
            video,
          );
          const header = [title, language ? `[${language}]` : null]
            .filter(Boolean)
            .join(" ");
          return {
            content: [
              {
                type: "text" as const,
                text: header ? `${header}\n\n${text}` : text,
              },
            ],
          };
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    // ---------------------------------------------------------------
    // Crawling (async job: initiate -> poll -> results)
    // ---------------------------------------------------------------

    this.server.registerTool(
      "crawl_site",
      {
        description:
          "Crawl a site starting from a URL, following internal links up to a depth/page limit, and return " +
          "Markdown for each page. Runs as an async job: this tool waits briefly for it to finish and returns " +
          "a jobId you can poll with get_crawl_status if it's still running. The blocklist is only checked " +
          "against the starting URL — if includeExternalLinks is enabled the crawler can reach other domains, " +
          "so use excludePatterns for finer control in that case.",
        inputSchema: {
          url: z.string().url(),
          limit: z
            .number()
            .int()
            .min(1)
            .max(100000)
            .optional()
            .describe("Max pages to crawl. Default 10."),
          depth: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe("Max link depth from the start URL."),
          includePatterns: z.array(z.string()).optional(),
          excludePatterns: z.array(z.string()).optional(),
          includeExternalLinks: z.boolean().optional(),
          includeSubdomains: z.boolean().optional(),
        },
      },
      async ({
        url,
        limit,
        depth,
        includePatterns,
        excludePatterns,
        includeExternalLinks,
        includeSubdomains,
      }) => {
        const blocklist = await this.getBlocklistCached();
        const check = checkUrlAgainstBlocklist(url, blocklist);
        if (check.blocked) return blockedResult(check.reason!);

        try {
          const { jobId, result } = await startCrawlAndWait(this.env, url, {
            limit,
            depth,
            formats: ["markdown"],
            includePatterns,
            excludePatterns,
            includeExternalLinks,
            includeSubdomains,
          });

          if (!result) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Crawl job ${jobId} is still running. Check back with get_crawl_status({ jobId: "${jobId}" }).`,
                },
              ],
            };
          }

          const pages = result.records
            .filter((r) => r.status === "completed" && r.markdown)
            .map(
              (r) =>
                `## ${r.metadata?.title ?? r.url}\n${r.url}\n\n${r.markdown}`,
            )
            .join("\n\n---\n\n");

          const summary = `Crawl ${result.status} — ${result.finished}/${result.total} pages finished (jobId: ${jobId}).\n\n`;
          return {
            content: [
              {
                type: "text" as const,
                text: summary + (pages || "No completed pages with markdown."),
              },
            ],
          };
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "get_crawl_status",
      {
        description:
          "Check the status of (and fetch results from) a previously started crawl job.",
        inputSchema: {
          jobId: z.string(),
          status: z
            .enum([
              "queued",
              "completed",
              "disallowed",
              "skipped",
              "errored",
              "cancelled",
            ])
            .optional()
            .describe("Filter results to a specific URL status."),
          cursor: z.number().int().optional(),
          limit: z.number().int().optional(),
        },
      },
      async ({ jobId, status, cursor, limit }) => {
        try {
          const result = await getCrawlStatus(this.env, jobId, {
            status,
            cursor,
            limit,
          });
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result, null, 2) },
            ],
          };
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    this.server.registerTool(
      "cancel_crawl",
      {
        description: "Cancel a running crawl job.",
        inputSchema: { jobId: z.string() },
      },
      async ({ jobId }) => {
        try {
          await cancelCrawl(this.env, jobId);
          return {
            content: [
              { type: "text" as const, text: `Crawl job ${jobId} cancelled.` },
            ],
          };
        } catch (err) {
          return errorResult(err);
        }
      },
    );

    // ---------------------------------------------------------------
    // Blocklist management
    // ---------------------------------------------------------------

    this.server.registerTool(
      "list_blocklist",
      {
        description:
          "List every domain and Instagram username currently on the blocklist.",
        inputSchema: {},
      },
      async () => {
        const blocklist = await this.getBlocklistCached();
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(blocklist, null, 2) },
          ],
        };
      },
    );
  }
}
