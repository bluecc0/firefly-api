import { existsSync, readFileSync } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAdobeCredentials, loadConfig, maskSecret, persistCredentialsToEnv } from "./config.ts";
import {
  handleImageGeneration,
  handleImageUpscale,
  handleListModels,
  handleUsage,
  handleVideoGeneration,
} from "./handlers/mediaHandlers.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_HTML_PATH = resolve(__dirname, "../public/index.html");

const config = loadConfig();
process.env.DATA_DIR = config.dataDir;

const MAX_BODY_BYTES = 50 * 1024 * 1024; // 50 MB for multipart/base64 reference images

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const json = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Adobe-Token, X-Adobe-Cookie",
  });
  res.end(json);
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.byteLength;
    if (total > MAX_BODY_BYTES) {
      throw new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * Parse either JSON or multipart/form-data (for OpenAI-compatible /v1/images/edits & upscale).
 */
async function parseRequestBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = String(req.headers["content-type"] || "");
  const raw = await readRawBody(req);
  if (raw.byteLength === 0) return {};

  if (contentType.includes("multipart/form-data")) {
    const request = new Request("http://localhost/", {
      method: "POST",
      headers: { "content-type": contentType },
      body: new Uint8Array(raw),
    });
    const formData = await request.formData();
    const out: Record<string, unknown> = {};
    const imageDataUrls: string[] = [];

    for (const [key, value] of formData.entries()) {
      if (typeof value === "string") {
        out[key] = value;
      } else {
        const bytes = Buffer.from(await value.arrayBuffer());
        const mime = value.type && value.type.startsWith("image/") ? value.type : "image/png";
        const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
        if (key === "image" || key === "image[]" || key === "images") {
          imageDataUrls.push(dataUrl);
        } else {
          out[key] = dataUrl;
        }
      }
    }
    if (imageDataUrls.length > 0) {
      out.image = imageDataUrls.length === 1 ? imageDataUrls[0] : imageDataUrls;
      out.image_url = imageDataUrls[0];
      out.images = imageDataUrls;
    }
    return out;
  }

  return JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
}

function isAuthorized(req: IncomingMessage): boolean {
  if (!config.apiKey) return true;
  const auth = String(req.headers["authorization"] || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token === config.apiKey;
}

function getCredentialsForRequest(req: IncomingMessage) {
  const headerToken = req.headers["x-adobe-token"];
  const headerCookie = req.headers["x-adobe-cookie"];
  return buildAdobeCredentials(config, {
    token: typeof headerToken === "string" && headerToken.trim() ? headerToken : undefined,
    cookie: typeof headerCookie === "string" && headerCookie.trim() ? headerCookie : undefined,
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Adobe-Token, X-Adobe-Cookie",
    });
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if ((req.method === "GET" || req.method === "HEAD") && (path === "/" || path === "/ui")) {
    if (existsSync(UI_HTML_PATH)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(req.method === "HEAD" ? undefined : readFileSync(UI_HTML_PATH, "utf8"));
      return;
    }
  }

  if (req.method === "GET" && path === "/health") {
    sendJson(res, 200, {
      status: "healthy",
      service: "firefly-api",
      credentials_configured: Boolean(config.adobeToken || config.adobeCookie),
      uptime_seconds: Math.round(process.uptime()),
    });
    return;
  }

  if (!isAuthorized(req)) {
    sendJson(res, 401, { error: { message: "Invalid or missing API key", type: "invalid_api_key" } });
    return;
  }

  try {
    if (req.method === "GET" && path === "/v1/models") {
      const modality = url.searchParams.get("modality") || undefined;
      const result = handleListModels(modality);
      sendJson(res, result.status, result.body);
      return;
    }

    if (req.method === "GET" && (path === "/v1/usage" || path === "/v1/quota")) {
      const result = await handleUsage(getCredentialsForRequest(req));
      sendJson(res, result.status, result.body);
      return;
    }

    if (req.method === "GET" && path === "/v1/credentials/status") {
      sendJson(res, 200, {
        has_token: Boolean(config.adobeToken),
        token_preview: maskSecret(config.adobeToken),
        has_cookie: Boolean(config.adobeCookie),
        cookie_preview: maskSecret(config.adobeCookie),
        api_key_required: Boolean(config.apiKey),
      });
      return;
    }

    if (req.method === "POST" && path === "/v1/credentials") {
      const body = await parseRequestBody(req);
      const persist = body.persist === true;
      const updates: { token?: string; cookie?: string } = {};
      if (typeof body.token === "string") {
        config.adobeToken = body.token.trim();
        updates.token = config.adobeToken;
      }
      if (typeof body.cookie === "string") {
        config.adobeCookie = body.cookie.trim();
        updates.cookie = config.adobeCookie;
      }
      if (persist && (updates.token !== undefined || updates.cookie !== undefined)) {
        persistCredentialsToEnv(updates);
      }
      sendJson(res, 200, {
        ok: true,
        persisted: persist,
        has_token: Boolean(config.adobeToken),
        token_preview: maskSecret(config.adobeToken),
        has_cookie: Boolean(config.adobeCookie),
        cookie_preview: maskSecret(config.adobeCookie),
      });
      return;
    }

    if (req.method === "POST" && (path === "/v1/images/generations" || path === "/v1/images/edits")) {
      const body = await parseRequestBody(req);
      const result = await handleImageGeneration(body, getCredentialsForRequest(req));
      sendJson(res, result.status, result.body);
      return;
    }

    if (req.method === "POST" && path === "/v1/images/upscale") {
      const body = await parseRequestBody(req);
      const result = await handleImageUpscale(body, getCredentialsForRequest(req));
      sendJson(res, result.status, result.body);
      return;
    }

    if (req.method === "POST" && path === "/v1/videos/generations") {
      const body = await parseRequestBody(req);
      const result = await handleVideoGeneration(body, getCredentialsForRequest(req));
      sendJson(res, result.status, result.body);
      return;
    }

    sendJson(res, 404, { error: { message: `Route not found: ${req.method} ${path}` } });
  } catch (err) {
    sendJson(res, 400, {
      error: { message: err instanceof Error ? err.message : String(err), type: "bad_request" },
    });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`🔥 firefly-api listening on http://${config.host}:${config.port}`);
  console.log(`   Endpoints:`);
  console.log(`     GET  /health`);
  console.log(`     GET  /v1/models[?modality=image|video|upscale]`);
  console.log(`     GET  /v1/usage`);
  console.log(`     POST /v1/images/generations`);
  console.log(`     POST /v1/images/edits`);
  console.log(`     POST /v1/images/upscale`);
  console.log(`     POST /v1/videos/generations`);
  console.log(`     POST /v1/credentials`);
  console.log(
    `   Adobe credentials: ${config.adobeToken || config.adobeCookie ? "configured" : "NOT SET (set ADOBE_FIREFLY_TOKEN in .env or pass X-Adobe-Token header)"}`
  );
});
