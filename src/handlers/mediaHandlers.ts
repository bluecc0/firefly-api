import {
  AdobeFireflyError,
  adobeFireflyGenerateImage,
  adobeFireflyGenerateVideo,
  resolveAdobeAccessToken,
  resolveAdobeImageModel,
  resolveAdobeSourceImageIds,
  resolveAdobeVideoModel,
} from "../services/adobeFireflyClient.ts";
import { ensureAdobeFireflySession } from "../services/adobeFireflySession.ts";
import {
  ADOBE_FIREFLY_UPSCALE_MODELS,
  adobeFireflyUpscaleImage,
  resolveAdobeUpscaleModel,
} from "../services/adobeFireflyUpscale.ts";
import { ADOBE_FIREFLY_FALLBACK_MODELS } from "../services/adobeFireflyModels.ts";
import { getAdobeFireflyUsage } from "../services/usage/adobeFirefly.ts";
import { sanitizeErrorMessage } from "../utils/error.ts";
import type { AdobeCredentialsInput } from "../config.ts";

export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

const logger = {
  info: (scope: string, msg: string) => console.log(`[${new Date().toISOString()}] [${scope}] ${msg}`),
  error: (scope: string, msg: string) => console.error(`[${new Date().toISOString()}] [${scope}] ${msg}`),
};

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseOptionalSeed(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function formatError(err: unknown): HandlerResult {
  if (err instanceof AdobeFireflyError) {
    return {
      status: err.status || 502,
      body: {
        error: {
          message: err.message,
          type: "adobe_firefly_error",
          code: err.code || `http_${err.status || 502}`,
        },
      },
    };
  }
  return {
    status: 500,
    body: {
      error: {
        message: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)),
        type: "internal_error",
      },
    },
  };
}

export function handleListModels(modalityFilter?: string): HandlerResult {
  const baseModels = ADOBE_FIREFLY_FALLBACK_MODELS;
  const upscaleModels = Object.entries(ADOBE_FIREFLY_UPSCALE_MODELS)
    .filter(([id]) => id !== "topaz")
    .map(([id, spec]) => ({
      id,
      name: id === "topaz-bloom" ? "Topaz Bloom (Creative Upscale)" : "Topaz Standard (Upscale)",
      modality: "upscale" as const,
      providerName: "Topaz Labs",
      factors: spec.factors,
      supports_creativity: spec.supportsCreativity,
    }));

  const all = [
    ...baseModels.map((m) => ({
      id: m.id,
      object: "model",
      owned_by: "adobe-firefly",
      name: m.name,
      modality: m.modality,
      provider_name: m.providerName,
      supported_sizes: m.capabilities.supportedSizes,
      supported_aspect_ratios: m.capabilities.supportedAspectRatios,
      supported_resolutions: m.capabilities.supportedResolutions,
      supported_durations: m.capabilities.supportedDurations,
    })),
    ...upscaleModels.map((m) => ({
      id: m.id,
      object: "model",
      owned_by: "adobe-firefly",
      name: m.name,
      modality: m.modality,
      provider_name: m.providerName,
      factors: m.factors,
      supports_creativity: m.supports_creativity,
    })),
  ];

  const filtered = modalityFilter
    ? all.filter((m) => m.modality === modalityFilter.toLowerCase())
    : all;

  return {
    status: 200,
    body: {
      object: "list",
      data: filtered,
    },
  };
}

export async function handleUsage(credentials: AdobeCredentialsInput | null): Promise<HandlerResult> {
  if (!credentials) {
    return {
      status: 401,
      body: { error: { message: "No Adobe Firefly credentials configured. Set ADOBE_FIREFLY_TOKEN or pass X-Adobe-Token." } },
    };
  }
  const usage = await getAdobeFireflyUsage(
    credentials.apiKey,
    credentials.accessToken,
    credentials.providerSpecificData ?? null
  );
  if ("message" in usage) {
    return { status: 400, body: { error: { message: usage.message } } };
  }
  return { status: 200, body: usage };
}

export async function handleImageGeneration(
  body: Record<string, unknown>,
  credentials: AdobeCredentialsInput | null
): Promise<HandlerResult> {
  if (!credentials) {
    return {
      status: 401,
      body: { error: { message: "No Adobe Firefly credentials configured. Set ADOBE_FIREFLY_TOKEN or pass X-Adobe-Token." } },
    };
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return { status: 400, body: { error: { message: "Field 'prompt' is required" } } };
  }
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : "flux-2";

  try {
    const session = await ensureAdobeFireflySession({ credentials, log: logger });
    const { id: resolvedId } = resolveAdobeImageModel(model);
    const maxRefs = resolvedId.includes("nano-banana") || resolvedId.includes("gpt-image") ? 4 : 2;
    const sourceImageIds = await resolveAdobeSourceImageIds({
      accessToken: session.accessToken,
      body,
      max: maxRefs,
      sessionCookie: session.cookie || undefined,
      arpSessionId: session.arpSessionId,
      prompt,
      log: logger,
    });

    logger.info("IMAGE", `${model} | prompt="${prompt.slice(0, 60)}" | refs=${sourceImageIds.length} | session=${session.source}`);

    const result = await adobeFireflyGenerateImage({
      accessToken: session.accessToken,
      prompt,
      model,
      size: body.size,
      aspectRatio: body.aspect_ratio ?? body.aspectRatio ?? body.size,
      quality: body.quality,
      seed: parseOptionalSeed(body.seed),
      negativePrompt: typeof body.negative_prompt === "string" ? body.negative_prompt : undefined,
      sourceImageIds: sourceImageIds.length ? sourceImageIds : undefined,
      sessionCookie: session.cookie || undefined,
      arpSessionId: session.arpSessionId,
      sessionFingerprint: session.fingerprint,
      sessionBrowserKey: session.browserSessionKey,
      timeoutMs: normalizePositiveNumber(body.timeout_ms, 180_000),
      log: logger,
    });

    return {
      status: 200,
      body: {
        created: Math.floor(Date.now() / 1000),
        model: resolvedId,
        data: [{ url: result.url }],
      },
    };
  } catch (err) {
    logger.error("IMAGE", err instanceof Error ? err.message : String(err));
    return formatError(err);
  }
}

export async function handleImageUpscale(
  body: Record<string, unknown>,
  credentials: AdobeCredentialsInput | null
): Promise<HandlerResult> {
  if (!credentials) {
    return {
      status: 401,
      body: { error: { message: "No Adobe Firefly credentials configured. Set ADOBE_FIREFLY_TOKEN or pass X-Adobe-Token." } },
    };
  }
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : "topaz-standard";
  const resolved = resolveAdobeUpscaleModel(model);
  if (!resolved) {
    return {
      status: 400,
      body: { error: { message: `Unsupported upscale model '${model}'. Use topaz-standard or topaz-bloom.` } },
    };
  }

  try {
    const accessToken = await resolveAdobeAccessToken(credentials);
    const sessionCookie =
      credentials.providerSpecificData?.cookie ||
      (credentials.apiKey?.includes(";") ? credentials.apiKey : undefined);

    const blobIds = await resolveAdobeSourceImageIds({
      accessToken,
      body,
      max: 1,
      sessionCookie,
      prompt: "upsample",
      log: logger,
    });
    if (blobIds.length === 0) {
      return { status: 400, body: { error: { message: "Source image is required (field 'image' or 'image_url')" } } };
    }

    const factor =
      body.factor ?? body.scale ?? body.upscale_factor ?? body.upscaleFactor ?? body.upsampler_factor;
    const rawCreativity = body.creativity ?? body.creativity_percent ?? body.creativityPercent;
    let creativityPercent: number | undefined;
    if (rawCreativity !== undefined && rawCreativity !== null) {
      const n = Number(String(rawCreativity).replace("%", "").trim());
      if (Number.isFinite(n)) {
        creativityPercent = n > 0 && n < 1 ? Math.max(0, Math.min(100, n * 100)) : Math.max(0, Math.min(100, n));
      }
    }

    const timeoutMs = normalizePositiveNumber(body.timeout_ms, 0);
    const result = await adobeFireflyUpscaleImage({
      accessToken,
      model,
      blobId: blobIds[0]!,
      upsamplerFactor: factor,
      creativityPercent,
      creativityLevel: body.creativity_level ?? body.creativityLevel,
      sessionCookie,
      ...(timeoutMs > 0 ? { timeoutMs } : {}),
      log: logger,
    });

    logger.info("UPSCALE", `${model} | ${result.factor}x`);
    return {
      status: 200,
      body: {
        created: Math.floor(Date.now() / 1000),
        model: resolved.id,
        factor: result.factor,
        ...(resolved.spec.supportsCreativity ? { creativity_level: result.creativityLevel } : {}),
        data: [{ url: result.url }],
      },
    };
  } catch (err) {
    logger.error("UPSCALE", err instanceof Error ? err.message : String(err));
    return formatError(err);
  }
}

export async function handleVideoGeneration(
  body: Record<string, unknown>,
  credentials: AdobeCredentialsInput | null
): Promise<HandlerResult> {
  if (!credentials) {
    return {
      status: 401,
      body: { error: { message: "No Adobe Firefly credentials configured. Set ADOBE_FIREFLY_TOKEN or pass X-Adobe-Token." } },
    };
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return { status: 400, body: { error: { message: "Field 'prompt' is required" } } };
  }
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : "veo-3.1-fast-generate";

  try {
    const session = await ensureAdobeFireflySession({ credentials, log: logger });
    const { id: videoModelId } = resolveAdobeVideoModel(model);
    const maxFrames = videoModelId.includes("kling") || videoModelId.includes("sora") ? 2 : 3;
    const sourceImageIds = await resolveAdobeSourceImageIds({
      accessToken: session.accessToken,
      body,
      max: maxFrames,
      sessionCookie: session.cookie || undefined,
      arpSessionId: session.arpSessionId,
      prompt,
      log: logger,
    });

    logger.info("VIDEO", `${model} | prompt="${prompt.slice(0, 60)}" | frames=${sourceImageIds.length} | session=${session.source}`);

    const result = await adobeFireflyGenerateVideo({
      accessToken: session.accessToken,
      prompt,
      model,
      size: body.size,
      aspectRatio: body.aspect_ratio ?? body.aspectRatio ?? body.ratio ?? body.size,
      duration: body.duration ?? body.durationSeconds,
      quality: body.quality,
      resolution: body.resolution ?? body.quality,
      seed: parseOptionalSeed(body.seed),
      negativePrompt:
        typeof body.negative_prompt === "string"
          ? body.negative_prompt
          : typeof body.negativePrompt === "string"
            ? body.negativePrompt
            : undefined,
      generateAudio: body.generate_audio !== false && body.generateAudio !== false,
      sourceImageIds: sourceImageIds.length ? sourceImageIds : undefined,
      sessionCookie: session.cookie || undefined,
      arpSessionId: session.arpSessionId,
      sessionFingerprint: session.fingerprint,
      sessionBrowserKey: session.browserSessionKey,
      timeoutMs: normalizePositiveNumber(body.timeout_ms, 300_000),
      log: logger,
    });

    return {
      status: 200,
      body: {
        created: Math.floor(Date.now() / 1000),
        model: videoModelId,
        data: [{ url: result.url, format: result.format || "mp4" }],
      },
    };
  } catch (err) {
    logger.error("VIDEO", err instanceof Error ? err.message : String(err));
    return formatError(err);
  }
}
