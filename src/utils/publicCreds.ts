/**
 * Public Adobe Firefly client identifiers (public SPA x-api-key / IMS client_id, not user secrets).
 * Adapted from OmniRoute's open-sse/utils/publicCreds.ts under MIT License.
 */

const MASK = "omniroute-public-v1";

function unmaskBytes(bytes: readonly number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i] ^ MASK.charCodeAt(i % MASK.length));
  }
  return out;
}

const EMBEDDED_DEFAULTS = {
  // clio-playground-web
  adobe_firefly_api_key: [12, 1, 7, 6, 95, 31, 25, 21, 28, 74, 2, 26, 23, 2, 13, 78, 90, 19, 83],
  // projectx_webapp
  adobe_firefly_express_client_id: [31, 31, 1, 3, 23, 12, 1, 12, 58, 90, 21, 23, 3, 28, 25],
  // SunbreakWebUI1
  adobe_firefly_balance_api_key: [60, 24, 0, 11, 0, 10, 20, 31, 50, 72, 18, 32, 43, 93],
} as const;

export type EmbeddedDefaultKey = keyof typeof EMBEDDED_DEFAULTS;

export function resolvePublicCred(key: EmbeddedDefaultKey, envName?: string): string {
  if (envName) {
    const fromEnv = process.env[envName];
    if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  }
  return unmaskBytes(EMBEDDED_DEFAULTS[key]);
}
