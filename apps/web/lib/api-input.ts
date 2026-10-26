/** Bounded JSON parsing shared by mutation handlers. Types are validated at runtime. */
export class InputError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export async function readJsonObject(
  req: Request,
  maxBytes = 16_384,
): Promise<Record<string, unknown>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 1_048_576) {
    throw new TypeError("Invalid request body limit");
  }
  const declared = req.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    throw new InputError("request body too large", 413);
  }
  if (!req.body) throw new InputError("invalid json");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: ((error: InputError) => void) | undefined;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort?.(new InputError("request was cancelled", 408));
  req.signal.addEventListener("abort", onAbort, { once: true });
  if (req.signal.aborted) onAbort();
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new InputError("request body timed out", 408)),
      5_000,
    );
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline, aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new InputError("request body too large", 413);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let value: unknown;
    try {
      value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch {
      throw new InputError("invalid json");
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new InputError("JSON object required");
    return value as Record<string, unknown>;
  } finally {
    if (timer) clearTimeout(timer);
    req.signal.removeEventListener("abort", onAbort);
    // Also stop reading after an oversize body or timeout.
    // A custom/failed transport may never settle cancellation. Cleanup must
    // not turn the finite parsing deadline into an unbounded request.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function stringField(
  body: Record<string, unknown>,
  key: string,
  max: number,
  required = false,
): string {
  const value = body[key];
  if (value === undefined && !required) return "";
  if (typeof value !== "string")
    throw new InputError(`${key} must be a string`);
  const text = value.trim();
  if (required && !text) throw new InputError(`${key} is required`);
  if (text.length > max)
    throw new InputError(`${key} too long (max ${max} chars)`);
  return text;
}

export function errorResponse(err: unknown): Response {
  return Response.json(
    {
      ok: false,
      error: err instanceof InputError ? err.message : "invalid request",
    },
    {
      status: err instanceof InputError ? err.status : 400,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

export function isEmail(value: string): boolean {
  return (
    value.length <= 254 &&
    /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(value)
  );
}

/** Reports must never disclose configured credentials or database connection URLs. */
export function safeErrorMessage(error: unknown): string {
  let text = error instanceof Error ? error.message : String(error);
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value &&
      /SECRET|TOKEN|PASSWORD|API_KEY|DATABASE_URL|SERVICE_ROLE/i.test(key)
    ) {
      text = text.split(value).join("[redacted]");
    }
  }
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[database URL]")
    .replace(/\b(?:https?|rediss?):\/\/[^\s/@]+:[^\s/@]+@[^\s]+/gi, "[credential URL]")
    .replace(/\bBearer\s+[a-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .slice(0, 500);
}
