import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface AdobeCredentialsInput {
  apiKey?: string;
  accessToken?: string;
  providerSpecificData?: {
    cookie?: string;
    access_token?: string;
    accessToken?: string;
  } | null;
}

export interface AppConfig {
  port: number;
  host: string;
  apiKey: string;
  adobeToken: string;
  adobeCookie: string;
  dataDir: string;
}

export function loadDotEnv(envPath = resolve(process.cwd(), ".env")): void {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

export function loadConfig(): AppConfig {
  loadDotEnv();
  return {
    port: Number(process.env.PORT || 3080),
    host: process.env.HOST || "127.0.0.1",
    apiKey: (process.env.API_KEY || "").trim(),
    adobeToken: (process.env.ADOBE_FIREFLY_TOKEN || "").trim(),
    adobeCookie: (process.env.ADOBE_FIREFLY_COOKIE || "").trim(),
    dataDir: process.env.DATA_DIR || resolve(process.cwd(), ".data"),
  };
}

export function buildAdobeCredentials(
  config: AppConfig,
  overrides?: { token?: string; cookie?: string }
): AdobeCredentialsInput | null {
  const token = (overrides?.token ?? config.adobeToken).trim();
  const cookie = (overrides?.cookie ?? config.adobeCookie).trim();
  if (!token && !cookie) return null;

  return {
    apiKey: token || cookie,
    accessToken: token || undefined,
    providerSpecificData: {
      ...(cookie ? { cookie } : {}),
      ...(token ? { accessToken: token, access_token: token } : {}),
    },
  };
}
