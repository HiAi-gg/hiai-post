import { jsPDF } from "jspdf";
import JSZip from "jszip";

export const PX_TO_MM = 0.264583;

export interface StageLike {
  toDataURL(config?: { pixelRatio?: number }): string;
}

export async function exportStageToBlob(stage: StageLike, pixelRatio?: number): Promise<Blob> {
  const dataUrl = stage.toDataURL({ pixelRatio: pixelRatio ?? 2 });
  const res = await fetch(dataUrl);
  return res.blob();
}

export async function exportStageToPngBytes(
  stage: StageLike,
  pixelRatio?: number
): Promise<Uint8Array> {
  const blob = await exportStageToBlob(stage, pixelRatio);
  return new Uint8Array(await blob.arrayBuffer());
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportSlideAsPNG(stage: StageLike, filename?: string): Promise<Blob> {
  const blob = await exportStageToBlob(stage);
  downloadBlob(blob, filename ?? "slide.png");
  return blob;
}

export async function exportAllSlidesAsPDF(
  stages: StageLike[],
  dimensions: { width: number; height: number },
  filename?: string
): Promise<void> {
  const pdfW = dimensions.width * PX_TO_MM;
  const pdfH = dimensions.height * PX_TO_MM;
  const orientation = pdfW > pdfH ? "landscape" : "portrait";
  const pdf = new jsPDF({ orientation, unit: "mm", format: [pdfW, pdfH] });

  for (let i = 0; i < stages.length; i++) {
    if (i > 0) pdf.addPage([pdfW, pdfH], orientation);
    const dataUrl = stages[i].toDataURL({ pixelRatio: 2 });
    pdf.addImage(dataUrl, "PNG", 0, 0, pdfW, pdfH);
  }

  pdf.save(filename ?? "carousel.pdf");
}

export async function exportAllSlidesAsZIP(stages: StageLike[], filename?: string): Promise<Blob> {
  const zip = new JSZip();
  for (let i = 0; i < stages.length; i++) {
    const bytes = await exportStageToPngBytes(stages[i]);
    zip.file(`slide_${i + 1}.png`, bytes);
  }
  const out = await zip.generateAsync({ type: "blob" });
  downloadBlob(out, filename ?? "carousel.zip");
  return out;
}

/** Build a ZIP blob without triggering a download (for tests / upload). */
export async function zipPngBlobs(
  files: Array<{ name: string; data: Blob | Uint8Array }>
): Promise<Blob> {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.name, file.data);
  }
  const bytes = await zip.generateAsync({ type: "arraybuffer" });
  return new Blob([bytes]);
}
