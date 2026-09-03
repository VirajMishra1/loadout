export interface BoundedJsonLimits {
  timeoutMs: number;
  maxBytes: number;
  label: string;
}

export interface BoundedJsonResult {
  response: Response;
  value: unknown;
}

function combinedSignal(
  caller: AbortSignal | null | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return caller ? AbortSignal.any([caller, timeout]) : timeout;
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  label: string,
): Promise<Uint8Array> {
  const length = response.headers.get("content-length");
  if (length !== null && /^\d+$/.test(length) && Number(length) > maxBytes) {
    throw new Error(`${label} response exceeds the size limit`);
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes)
      throw new Error(`${label} response exceeds the size limit`);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel(`${label} response exceeds the size limit`);
        throw new Error(`${label} response exceeds the size limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Fetch and parse untrusted JSON without allowing an unbounded wait or body. */
export async function boundedJson(
  fetcher: typeof fetch,
  input: string | URL | Request,
  init: RequestInit,
  limits: BoundedJsonLimits,
): Promise<BoundedJsonResult> {
  if (!Number.isFinite(limits.timeoutMs) || limits.timeoutMs <= 0)
    throw new Error("JSON request timeout must be greater than zero");
  if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes <= 0)
    throw new Error("JSON response byte limit must be a positive integer");

  const response = await fetcher(input, {
    ...init,
    signal: combinedSignal(init.signal, limits.timeoutMs),
  });
  const body = await readBoundedBody(response, limits.maxBytes, limits.label);
  if (!response.ok) return { response, value: undefined };
  try {
    return {
      response,
      value: JSON.parse(new TextDecoder().decode(body)) as unknown,
    };
  } catch {
    throw new Error(`${limits.label} returned malformed JSON`);
  }
}
