import { NextResponse } from "next/server";
import {
  generateImage,
  type T2IAspect,
  type T2IStyle,
} from "@apex/api-client/huggingface";
import { authorizeAdminRequest } from "@/lib/admin-auth";
import { rateLimit, tooMany } from "@/lib/rate-limit";
import {
  rateLimitShared,
  rateLimitUnavailable,
} from "@/lib/distributed-rate-limit";
import { validateJsonMutationRequest } from "@/lib/mutation-guard";
import {
  readJsonObject,
  stringField,
  InputError,
  errorResponse,
} from "@/lib/api-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const json = (body: unknown, init: ResponseInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'private, no-store');
  return NextResponse.json(body, { ...init, headers });
};

const ASPECTS = new Set(["16:9", "21:9", "4:3", "1:1", "9:16"]);
const STYLES = new Set([
  "cinematic-telemetry",
  "editorial-monochrome",
  "high-contrast-pitlane",
  "soft-paddock-portrait",
  "raw",
]);

/** Explicitly authorized generation. Returned images are inline; no storage upload is claimed. */
export async function POST(req: Request) {
  const authorization = await authorizeAdminRequest(req, 'image');
  if (authorization.response) return authorization.response;
  const guard = validateJsonMutationRequest(req);
  if (guard) return guard;
  const rl = rateLimit(req, {
    limit: 30,
    windowMs: 60_000,
    bucket: "generate-image-parse",
  });
  if (!rl.ok) return tooMany(rl);
  let prompt: string, aspect: T2IAspect, style: T2IStyle;
  try {
    const body = await readJsonObject(req);
    prompt = stringField(body, "prompt", 2_000, true);
    const aspectValue = stringField(body, "aspect", 10) || "16:9";
    const styleValue = stringField(body, "style", 50) || "cinematic-telemetry";
    if (!ASPECTS.has(aspectValue)) throw new InputError("invalid aspect");
    if (!STYLES.has(styleValue)) throw new InputError("invalid style");
    aspect = aspectValue as T2IAspect;
    style = styleValue as T2IStyle;
  } catch (err) {
    return errorResponse(err);
  }
  if (
    !process.env.HUGGINGFACE_TOKEN ||
    process.env.HUGGINGFACE_INFERENCE_ENABLED !== "true"
  ) {
    return json(
      {
        ok: false,
        error:
          "Image generation is unavailable. Configure HUGGINGFACE_TOKEN and enable HUGGINGFACE_INFERENCE_ENABLED.",
      },
      { status: 503 },
    );
  }
  const shared = await rateLimitShared(req, {
    limit: 10,
    windowMs: 60_000,
    bucket: "generate-image",
  });
  if (!shared.available) return rateLimitUnavailable(shared);
  if (!shared.ok) return tooMany(shared);
  try {
    const result = await generateImage({
      prompt,
      aspect,
      style,
      writeToTmp: false,
      allowInference: true,
    });
    if (!result)
      return json(
        { ok: false, error: "Image generation failed or timed out." },
        { status: 502 },
      );
    return json({
      ok: true,
      url: `data:image/png;base64,${result.pngBuffer.toString("base64")}`,
      source: "inline",
      width: result.width,
      height: result.height,
      model: result.model,
    });
  } catch {
    return json(
      { ok: false, error: "Image generation failed or timed out." },
      { status: 502 },
    );
  }
}

export async function GET(req: Request) {
  const authorization = await authorizeAdminRequest(req, 'image');
  if (authorization.response) return authorization.response;
  return json(
    { ok: false, error: "POST only" },
    { status: 405, headers: { Allow: "POST" } },
  );
}
