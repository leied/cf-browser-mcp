import type { BlocklistConfig, Env } from "./types";

const KV_KEY = "config:blocklist";

export const DEFAULT_BLOCKLIST: BlocklistConfig = {
  domains: [],
  instagramUsers: [],
};

const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com"]);

// Path segments on instagram.com that are never a username, so we don't
// mistake them for one (e.g. instagram.com/explore/ isn't anybody's profile).
const INSTAGRAM_RESERVED_PATHS = new Set([
  "p",
  "reel",
  "reels",
  "explore",
  "accounts",
  "direct",
  "directory",
  "tv",
  "about",
  "developer",
  "legal",
  "privacy",
  "api",
  "web",
  "_n",
]);

export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

export function normalizeInstagramUser(username: string): string {
  return username
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, "")
    .replace(/\/.*$/, "");
}

export async function getBlocklist(env: Env): Promise<BlocklistConfig> {
  const stored = await env.BLOCKLIST_KV.get<BlocklistConfig>(KV_KEY, "json");
  if (!stored) return { ...DEFAULT_BLOCKLIST };
  return {
    domains: Array.isArray(stored.domains) ? stored.domains : [],
    instagramUsers: Array.isArray(stored.instagramUsers)
      ? stored.instagramUsers
      : [],
  };
}

export async function saveBlocklist(
  env: Env,
  config: BlocklistConfig,
): Promise<void> {
  await env.BLOCKLIST_KV.put(KV_KEY, JSON.stringify(config));
}

export async function addDomain(
  env: Env,
  domain: string,
): Promise<BlocklistConfig> {
  const config = await getBlocklist(env);
  const normalized = normalizeDomain(domain);
  if (normalized && !config.domains.includes(normalized))
    config.domains.push(normalized);
  await saveBlocklist(env, config);
  return config;
}

export async function removeDomain(
  env: Env,
  domain: string,
): Promise<BlocklistConfig> {
  const config = await getBlocklist(env);
  const normalized = normalizeDomain(domain);
  config.domains = config.domains.filter((d) => d !== normalized);
  await saveBlocklist(env, config);
  return config;
}

export async function addInstagramUser(
  env: Env,
  username: string,
): Promise<BlocklistConfig> {
  const config = await getBlocklist(env);
  const normalized = normalizeInstagramUser(username);
  if (normalized && !config.instagramUsers.includes(normalized))
    config.instagramUsers.push(normalized);
  await saveBlocklist(env, config);
  return config;
}

export async function removeInstagramUser(
  env: Env,
  username: string,
): Promise<BlocklistConfig> {
  const config = await getBlocklist(env);
  const normalized = normalizeInstagramUser(username);
  config.instagramUsers = config.instagramUsers.filter((u) => u !== normalized);
  await saveBlocklist(env, config);
  return config;
}

function isDomainBlocked(hostname: string, domains: string[]): string | null {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  for (const blocked of domains) {
    if (host === blocked || host.endsWith(`.${blocked}`)) return blocked;
  }
  return null;
}

/**
 * Best-effort extraction of an Instagram username from a URL. Profile pages
 * (instagram.com/<user>) and story links (instagram.com/stories/<user>/...)
 * are covered. Posts and reels (instagram.com/p/<id>, /reel/<id>) can't be
 * reliably attributed to a user from the URL alone, so those are left alone —
 * worth knowing if you need a harder guarantee than this scaffold provides.
 */
function extractInstagramUsername(url: URL): string | null {
  if (!INSTAGRAM_HOSTS.has(url.hostname.toLowerCase())) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  let candidate = segments[0].toLowerCase();

  if (candidate === "stories" && segments[1]) {
    candidate = segments[1].toLowerCase();
  } else if (INSTAGRAM_RESERVED_PATHS.has(candidate)) {
    return null;
  }

  return candidate;
}

export interface BlockCheckResult {
  blocked: boolean;
  reason?: string;
}

export function checkUrlAgainstBlocklist(
  rawUrl: string,
  config: BlocklistConfig,
): BlockCheckResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { blocked: false };
  }

  const blockedDomain = isDomainBlocked(url.hostname, config.domains);
  if (blockedDomain) {
    return {
      blocked: true,
      reason: `Domain "${blockedDomain}" is on the blocklist.`,
    };
  }

  const igUser = extractInstagramUsername(url);
  if (igUser && config.instagramUsers.includes(igUser)) {
    return {
      blocked: true,
      reason: `Instagram user "@${igUser}" is on the blocklist.`,
    };
  }

  return { blocked: false };
}
