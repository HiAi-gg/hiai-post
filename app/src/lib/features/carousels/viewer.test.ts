import { describe, expect, it } from "vitest";
import {
  canAddBlankSlide,
  canEditCover,
  isCoverSelected,
  slideIndexFromView,
  viewIndexFromSlide,
  viewItemCount,
} from "./viewer";

describe("cover-edit visibility", () => {
  it("is only true on the cover item when the job is done", () => {
    expect(isCoverSelected(0, true)).toBe(true);
    expect(isCoverSelected(1, true)).toBe(false);
    expect(isCoverSelected(0, false)).toBe(false);
    expect(
      canEditCover({ viewingCover: true, jobDone: true, hasCover: true })
    ).toBe(true);
    expect(
      canEditCover({ viewingCover: false, jobDone: true, hasCover: true })
    ).toBe(false);
    expect(
      canEditCover({ viewingCover: true, jobDone: false, hasCover: true })
    ).toBe(false);
  });
});

describe("add-blank-slide", () => {
  it("is allowed until the deck hits the max", () => {
    expect(canAddBlankSlide(2, 10)).toBe(true);
    expect(canAddBlankSlide(10, 10)).toBe(false);
    expect(canAddBlankSlide(9, 10)).toBe(true);
  });
});

describe("cover-first view mapping", () => {
  it("maps cover + slides so slide 0 is view index 1", () => {
    expect(slideIndexFromView(0, true)).toBe(-1);
    expect(slideIndexFromView(1, true)).toBe(0);
    expect(slideIndexFromView(0, false)).toBe(0);
    expect(viewIndexFromSlide(0, true)).toBe(1);
    expect(viewItemCount(3, true)).toBe(4);
    expect(viewItemCount(3, false)).toBe(3);
  });
});
