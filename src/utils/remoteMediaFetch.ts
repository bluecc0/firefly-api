/**
 * Lightweight SSRF-safe remote image fetcher for reference image uploads.
 */

import dns from "node:dns";
import { isIP } from "node:net";

export interface RemoteImageFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface RemoteImageFetchResult {
  buffer: Buffer<ArrayBuffer>;
  contentType: string;
  url: string;
}

function isPrivateIp(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:")) {
    return true;
  }
  const v4 = lower.startsWith("::ffff:") ? lower.slice(7) : lower;
  const parts = v4.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export async function fetchUntrustedRemoteImage(
  input: string | URL,
  options: RemoteImageFetchOptions = {}
): Promise<RemoteImageFetchResult> {
  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const fetchImpl = options.fetchImpl ?? fetch;

  const url = typeof input === "string" ? new URL(input) : input;
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported remote media protocol: ${url.protocol}`);
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Blocked private remote media host");
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Blocked private IP address");
  } else {
    const records = await dns.promises.lookup(host, { all: true });
    for (const r of records) {
      if (isPrivateIp(r.address)) {
        throw new Error("Remote media host resolved to a private IP address");
      }
    }
  }

  const res = await fetchImpl(url.toString(), {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Remote image fetch failed with HTTP ${res.status}`);
  }

  const contentLength = Number(res.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    throw new Error(`Remote image exceeds max size (${maxBytes} bytes)`);
  }

  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) {
    throw new Error(`Remote image exceeds max size (${maxBytes} bytes)`);
  }

  const contentType = (res.headers.get("content-type") || "image/png").split(";")[0].trim();
  return {
    buffer: Buffer.from(arrayBuffer) as Buffer<ArrayBuffer>,
    contentType,
    url: res.url || url.toString(),
  };
}
