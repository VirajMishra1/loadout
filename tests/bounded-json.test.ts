import { describe, expect, it, vi } from "vitest";
import { boundedJson } from "../src/core/runtime/bounded-json.js";

describe("boundedJson", () => {
  it("rejects a declared body above the byte limit without reading it", async () => {
    let opened = false;
    const response = {
      headers: new Headers({ "content-length": "101" }),
      body: {
        getReader() {
          opened = true;
          throw new Error("body must not be opened");
        },
      },
    } as unknown as Response;
    const fetcher = vi.fn(async () => response);

    await expect(
      boundedJson(
        fetcher,
        "https://example.test/data",
        {},
        {
          timeoutMs: 1_000,
          maxBytes: 100,
          label: "Test API",
        },
      ),
    ).rejects.toThrow(/size limit/i);
    expect(opened).toBe(false);
  });

  it("cancels a streamed body as soon as it crosses the byte limit", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.enqueue(new Uint8Array(6));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetcher = vi.fn(async () => new Response(body));

    await expect(
      boundedJson(
        fetcher,
        "https://example.test/data",
        {},
        {
          timeoutMs: 1_000,
          maxBytes: 10,
          label: "Test API",
        },
      ),
    ).rejects.toThrow(/size limit/i);
    expect(cancelled).toBe(true);
  });

  it("accepts valid JSON whose encoded body is exactly at the limit", async () => {
    const encoded = new TextEncoder().encode('{"ok":true}');
    const result = await boundedJson(
      async () => new Response(encoded),
      "https://example.test/data",
      {},
      {
        timeoutMs: 1_000,
        maxBytes: encoded.byteLength,
        label: "Test API",
      },
    );
    expect(result.value).toEqual({ ok: true });
  });

  it("combines a caller abort signal with the timeout signal", async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | null | undefined;
    const promise = boundedJson(
      async (_input, init) => {
        requestSignal = init?.signal;
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        });
      },
      "https://example.test/data",
      { signal: controller.signal },
      { timeoutMs: 10_000, maxBytes: 100, label: "Test API" },
    );
    controller.abort(new Error("caller stopped"));

    await expect(promise).rejects.toThrow(/caller stopped/i);
    expect(requestSignal).not.toBe(controller.signal);
    expect(requestSignal?.aborted).toBe(true);
  });

  it("reports malformed JSON with the endpoint label", async () => {
    await expect(
      boundedJson(
        async () => new Response("{not json"),
        "https://example.test/data",
        {},
        { timeoutMs: 1_000, maxBytes: 100, label: "Test API" },
      ),
    ).rejects.toThrow(/Test API returned malformed JSON/i);
  });
});
