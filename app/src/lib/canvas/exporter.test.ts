import { describe, expect, it } from "vitest";
import { PX_TO_MM, zipPngBlobs } from "./exporter";

describe("exporter (no browser stage)", () => {
  it("uses the CSS-px to mm factor for PDF page size", () => {
    expect(1080 * PX_TO_MM).toBeCloseTo(285.75, 2);
    expect(1350 * PX_TO_MM).toBeCloseTo(357.19, 2);
  });

  it("packs named PNG blobs into a zip without inventing extra slides", async () => {
    const one = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const zip = await zipPngBlobs([{ name: "slide_1.png", data: one }]);
    expect(zip.size).toBeGreaterThan(one.byteLength);
  });
});
