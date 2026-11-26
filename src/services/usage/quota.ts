export type UsageQuota = {
  used: number;
  total: number;
  remaining?: number;
  remainingPercentage?: number;
  resetAt: string | null;
  unlimited: boolean;
  displayName?: string;
};

export function parseResetTime(resetValue: unknown): string | null {
  if (!resetValue) return null;
  try {
    let date: Date;
    if (resetValue instanceof Date) {
      date = resetValue;
    } else if (typeof resetValue === "number") {
      date = new Date(resetValue < 1e12 ? resetValue * 1000 : resetValue);
    } else if (typeof resetValue === "string") {
      if (/^\d+$/.test(resetValue)) {
        const ts = Number(resetValue);
        date = new Date(ts < 1e12 ? ts * 1000 : ts);
      } else {
        date = new Date(resetValue);
      }
    } else {
      return null;
    }
    if (date.getTime() <= 0 || Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch {
    return null;
  }
}
