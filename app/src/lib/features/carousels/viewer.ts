/** Viewer helpers for the unified carousel canvas (cover + slides). */

export const COVER_VIEW_INDEX = 0;

export function hasCoverImage(coverFailed: boolean, jobHasCover: boolean): boolean {
  return !coverFailed && jobHasCover;
}

/** Cover is always the first item when a cover exists. */
export function isCoverSelected(viewIndex: number, hasCover: boolean): boolean {
  return hasCover && viewIndex === COVER_VIEW_INDEX;
}

/** 0-based slide index for the current view, or -1 when the cover is selected. */
export function slideIndexFromView(viewIndex: number, hasCover: boolean): number {
  if (!hasCover) return viewIndex;
  return viewIndex - 1;
}

export function viewIndexFromSlide(slideIndex: number, hasCover: boolean): number {
  return hasCover ? slideIndex + 1 : slideIndex;
}

export function viewItemCount(slideCount: number, hasCover: boolean): number {
  return slideCount + (hasCover ? 1 : 0);
}

export function canEditCover(opts: {
  viewingCover: boolean;
  jobDone: boolean;
  hasCover: boolean;
}): boolean {
  return opts.viewingCover && opts.jobDone && opts.hasCover;
}

export function canAddBlankSlide(slideCount: number, maxSlides: number): boolean {
  return slideCount < maxSlides;
}
