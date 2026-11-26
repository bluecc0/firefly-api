/**
 * Minimal error message sanitizer (replaces OmniRoute's utils/error.ts).
 */

const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
];

export function sanitizeErrorMessage(message: unknown): string {
  let text = typeof message === "string" ? message : String(message ?? "");
  for (const re of SECRET_PATTERNS) {
    text = text.replace(re, "[REDACTED]");
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 1000);
}
