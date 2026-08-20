import { describe, expect, it } from "vitest";
import { addCarouselBlankSlide, editCarouselCover } from "./api";

const originalFetch = globalThis.fetch;

async function withFetch<T>(mock: typeof fetch, run: () => Promise<T>): Promise<T> {
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("addCarouselBlankSlide", () => {
  it("POSTs /slides/add and returns the new slide number", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const mock: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        item: { id: "c1" },
        revision: { revisionNumber: 2 },
        slideNumber: 3,
        slide: { title: "New Slide", content: "Add your content here" },
      });
    };
    const result = await withFetch(mock, () => addCarouselBlankSlide("c1"));
    expect(result.slideNumber).toBe(3);
    expect(calls[0]?.url).toBe("/api/v1/carousels/c1/slides/add");
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("surfaces a kit/product error instead of inventing a slide", async () => {
    const mock: typeof fetch = async () => jsonResponse({ message: "Maximum 10 slides reached" }, 400);
    await expect(withFetch(mock, () => addCarouselBlankSlide("c1"))).rejects.toMatchObject({
      status: 400,
      message: "Maximum 10 slides reached",
    });
  });
});

describe("editCarouselCover", () => {
  it("POSTs /cover/edit with the description", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const mock: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        item: { id: "c1" },
        coverImagePath: "cover.png",
        updatedAt: "2026-01-02T00:00:00.000Z",
      });
    };
    const result = await withFetch(mock, () => editCarouselCover("c1", "make the sky darker"));
    expect(result.coverImagePath).toBe("cover.png");
    expect(calls[0]?.url).toBe("/api/v1/carousels/c1/cover/edit");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ description: "make the sky darker" }));
  });

  it("does not swallow a missing-cover error", async () => {
    const mock: typeof fetch = async () =>
      jsonResponse({ message: "No cover image exists for this job" }, 400);
    await expect(withFetch(mock, () => editCarouselCover("c1", "darker"))).rejects.toMatchObject({
      status: 400,
      message: "No cover image exists for this job",
    });
  });
});
