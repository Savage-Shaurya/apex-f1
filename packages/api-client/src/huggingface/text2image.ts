/**
 * Explicitly requested image generation for authorized admin/worker flows.
 * Requires deployment opt-in, caller opt-in, model access and a valid token.
 * Returns a structurally checked PNG with dimensions read from the response; it does not
 * upload to R2. Filesystem output is a separate opt-in available only in dev.
 */

import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { hfInference } from './client';

export type T2IModelId =
  | 'black-forest-labs/FLUX.1-schnell'
  | 'stabilityai/stable-diffusion-xl-base-1.0';

/** Aspect → (width, height) at SDXL/FLUX-friendly multiples of 64. */
export type T2IAspect = '16:9' | '21:9' | '4:3' | '1:1' | '9:16';

interface Dims { width: number; height: number; }

function aspectToDims(aspect: T2IAspect): Dims {
  switch (aspect) {
    case '21:9':  return { width: 1344, height: 576 };
    case '16:9':  return { width: 1216, height: 704 };
    case '4:3':   return { width: 1152, height: 896 };
    case '1:1':   return { width: 1024, height: 1024 };
    case '9:16':  return { width: 704,  height: 1216 };
  }
}

/** Optional style hint appended to the prompt to push consistency. */
export type T2IStyle =
  | 'cinematic-telemetry'
  | 'editorial-monochrome'
  | 'high-contrast-pitlane'
  | 'soft-paddock-portrait'
  | 'raw';

const STYLE_SUFFIX: Record<T2IStyle, string> = {
  'cinematic-telemetry':
    'cinematic, dramatic rim lighting, telemetry-red highlights (#E10600), deep blacks, 35mm grain, shot on Arri Alexa, ultra-detailed, professional motorsport photography',
  'editorial-monochrome':
    'editorial, monochrome, high contrast, large negative space, magazine spread aesthetic, photographed on medium-format film',
  'high-contrast-pitlane':
    'pit lane at night, hot wet asphalt, sodium glow, motion-blurred crew, neon timing wall, ultra detailed',
  'soft-paddock-portrait':
    'shallow depth of field, golden hour paddock light, Leica 50mm, subtle film grain',
  raw: '',
};

export interface GenerateImageInput {
  /** Natural-language description. Required, non-empty after trim. */
  prompt: string;
  /** Visual treatment hint. Default 'cinematic-telemetry'. */
  style?: T2IStyle;
  /** Aspect ratio. Default '16:9' for hero rails. */
  aspect?: T2IAspect;
  /** Override the default model. */
  model?: T2IModelId;
  /** Override timeout (cold start can be slow). Default 30s. */
  timeoutMs?: number;
  /**
   * Negative prompt to push the model away from common motorsport AI
   * artefacts (blurry tires, mangled cockpits, fake sponsor logos).
   * SDXL respects this; FLUX-schnell mostly ignores it but it's harmless.
   */
  negativePrompt?: string;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Override token resolution. */
  token?: string;
  /** Cost-bearing generation requires explicit opt-in and deployment flag. */
  allowInference?: boolean;
  signal?: AbortSignal;
  /**
   * When true, also write the PNG to /tmp and return a `file://` url.
   * Defaults to false. Production never writes a temporary file.
   * Storage/upload remains the responsibility of an authorized caller.
   */
  writeToTmp?: boolean;
}

export interface GenerateImageResult {
  /** Raw PNG bytes. Always present on success. */
  pngBuffer: Buffer;
  /**
   * Convenience URL.
   *   · dev → file:///tmp/<uuid>.png (if writeToTmp)
   *   · prod → undefined; caller uploads + assigns.
   */
  url?: string;
  /** Echoes back so callers can log / cache by model. */
  model: T2IModelId;
  /** Actual dimensions read from the returned PNG header. */
  width: number;
  height: number;
}

const DEFAULT_MODEL: T2IModelId = 'black-forest-labs/FLUX.1-schnell';
const DEFAULT_NEGATIVE =
  'low quality, blurry, watermark, text, fake sponsor logos, mangled wheels, distorted cockpit, oversaturated';

/**
 * Build the body params block. FLUX-schnell wants `num_inference_steps: 4`
 * (it's a 4-step distillation). SDXL wants 25-40. We branch on model.
 */
function buildParameters(
  model: T2IModelId,
  dims: Dims,
  negativePrompt: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    width: dims.width,
    height: dims.height,
    guidance_scale: 0, // FLUX-schnell · 0 is intentional; SDXL overrides below.
    negative_prompt: negativePrompt,
  };
  if (model === 'stabilityai/stable-diffusion-xl-base-1.0') {
    base['num_inference_steps'] = 30;
    base['guidance_scale'] = 7.5;
  } else {
    base['num_inference_steps'] = 4;
  }
  return base;
}

/**
 * Generate one image. Returns null on missing token, network failure,
 * empty prompt, or model-stays-cold-past-timeout.
 */
export async function generateImage(
  input: GenerateImageInput,
): Promise<GenerateImageResult | null> {
  if (!input || typeof input.prompt !== 'string') return null;
  const prompt = input.prompt.trim();
  if (prompt.length === 0 || prompt.length > 2000) return null;

  const model = input.model ?? DEFAULT_MODEL;
  const aspect = input.aspect ?? '16:9';
  const style = input.style ?? 'cinematic-telemetry';
  if (!['black-forest-labs/FLUX.1-schnell', 'stabilityai/stable-diffusion-xl-base-1.0'].includes(model) ||
    !['16:9', '21:9', '4:3', '1:1', '9:16'].includes(aspect) || !Object.hasOwn(STYLE_SUFFIX, style)) return null;
  const dims = aspectToDims(aspect);
  const negativePrompt = input.negativePrompt ?? DEFAULT_NEGATIVE;
  if (typeof negativePrompt !== 'string' || negativePrompt.length > 2000) return null;

  const styledPrompt =
    style === 'raw' ? prompt : `${prompt}. ${STYLE_SUFFIX[style]}`;

  const buf = await hfInference<unknown>({
    model,
    inputs: styledPrompt,
    parameters: buildParameters(model, dims, negativePrompt),
    options: { wait_for_model: true, use_cache: false },
    responseKind: 'binary',
    timeoutMs: input.timeoutMs ?? 30_000,
    fetchImpl: input.fetchImpl,
    token: input.token,
    allowInference: input.allowInference,
    signal: input.signal,
  });

  if (!buf || !(buf instanceof Buffer) || buf.length < 24) return null;
  const actualWidth = buf.readUInt32BE(16);
  const actualHeight = buf.readUInt32BE(20);
  if (actualWidth < 1 || actualWidth > 4096 || actualHeight < 1 || actualHeight > 4096) return null;

  const result: GenerateImageResult = {
    pngBuffer: buf,
    model,
    width: actualWidth,
    height: actualHeight,
  };

  const writeToTmp = input.writeToTmp === true && process.env['NODE_ENV'] !== 'production';

  if (writeToTmp) {
    try {
      const filename = `apex-${randomUUID()}.png`;
      const path = join(tmpdir(), filename);
      await writeFile(path, buf);
      result.url = pathToFileURL(path).toString();
    } catch {
      // Filesystem failure must not break image generation. Caller still
      // has pngBuffer and can upload directly.
    }
  }

  return result;
}
