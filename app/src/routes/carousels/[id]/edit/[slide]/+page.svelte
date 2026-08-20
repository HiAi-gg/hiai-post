<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import CanvasToolbar from "$lib/components/canvas/CanvasToolbar.svelte";
import ElementPanel from "$lib/components/canvas/ElementPanel.svelte";
import InlineTextEditor from "$lib/components/canvas/InlineTextEditor.svelte";
import SlideCanvas from "$lib/components/canvas/SlideCanvas.svelte";
import { createSlideDocument } from "$lib/canvas/defaults";
import { exportAllSlidesAsPDF, exportAllSlidesAsZIP, exportSlideAsPNG } from "$lib/canvas/exporter";
import { SlideHistory } from "$lib/canvas/history";
import type { SlideDocument, SlideElement, TextElement } from "$lib/canvas/types";
import {
  CarouselApiError,
  type CarouselItem,
  getCarousel,
  getCarouselSlideJson,
  saveCarouselSlideDocument,
  uploadCarouselSlidePng,
} from "$lib/features/carousels/api";

let item = $state<CarouselItem | null>(null);
let currentSlide = $state<SlideDocument | null>(null);
let originalSlide = $state<SlideDocument | null>(null);
let history = $state<SlideHistory | null>(null);
let selectedId = $state<string | null>(null);
let editingTextId = $state<string | null>(null);
let loadError = $state<string | null>(null);
let saveError = $state<string | null>(null);
let saving = $state(false);
let dirty = $state(false);
let canvasWidth = $state(800);
let canvasHeight = $state(800);
let slideCanvasRef: SlideCanvas | undefined = $state();
let canvasHost: HTMLDivElement | undefined = $state();

const id = $derived(page.params.id ?? "");
const slideNum = $derived(Math.max(1, Number(page.params.slide) || 1));

const selectedElement = $derived(
  currentSlide?.elements.find((el) => el.id === selectedId) ?? null
);
const editingText = $derived(
  editingTextId
    ? (currentSlide?.elements.find((el) => el.id === editingTextId) as TextElement | undefined) ??
      null
    : null
);

function errorText(err: unknown): string {
  if (err instanceof CarouselApiError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

function asSlideDoc(raw: unknown, width: number, height: number, preset: string): SlideDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as SlideDocument;
  if (!Array.isArray(doc.elements)) return null;
  return {
    ...doc,
    version: 1,
    width: doc.width || width,
    height: doc.height || height,
    background: doc.background ?? { type: "solid", color: "#ffffff" },
    elements: doc.elements,
  };
}

async function load() {
  loadError = null;
  try {
    const { item: loaded } = await getCarousel(id);
    item = loaded;
    const width = loaded.bodyJson.slideWidth ?? 1080;
    const height = loaded.bodyJson.slideHeight ?? 1350;
    const preset = loaded.bodyJson.designPreset;
    const canvasPreset = preset === "bold" || preset === "gradient" ? preset : "minimal";
    const persisted = asSlideDoc(loaded.bodyJson.slides[slideNum - 1]?.doc, width, height, preset);
    let doc = persisted;
    if (!doc) {
      try {
        doc = asSlideDoc((await getCarouselSlideJson(id, slideNum)).json, width, height, preset);
      } catch {
        doc = null;
      }
    }
    const initial = doc ?? createSlideDocument(width, height, canvasPreset);
    originalSlide = structuredClone(initial);
    history = new SlideHistory(initial);
    currentSlide = history.current;
    dirty = false;
  } catch (err) {
    loadError = errorText(err);
  }
}

$effect(() => {
  void id;
  void slideNum;
  void load();
});

$effect(() => {
  if (!canvasHost) return;
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      canvasWidth = entry.contentRect.width;
      canvasHeight = entry.contentRect.height;
    }
  });
  ro.observe(canvasHost);
  canvasWidth = canvasHost.clientWidth;
  canvasHeight = canvasHost.clientHeight;
  return () => ro.disconnect();
});

function pushHistory() {
  if (!history || !currentSlide) return;
  history.push(currentSlide);
  dirty = true;
}

function updateElement(el: SlideElement) {
  if (!currentSlide) return;
  pushHistory();
  currentSlide = {
    ...currentSlide,
    elements: currentSlide.elements.map((item) => (item.id === el.id ? el : item)),
  };
}

function deleteSelected() {
  if (!currentSlide || !selectedId) return;
  pushHistory();
  currentSlide = {
    ...currentSlide,
    elements: currentSlide.elements.filter((el) => el.id !== selectedId),
  };
  selectedId = null;
}

function updateBackground(background: SlideDocument["background"]) {
  if (!currentSlide) return;
  pushHistory();
  currentSlide = { ...currentSlide, background };
}

function handleRevert() {
  if (!originalSlide) return;
  if (!confirm("Revert to the last loaded original? Unsaved edits will be lost.")) return;
  history = new SlideHistory(originalSlide);
  currentSlide = history.current;
  selectedId = null;
  dirty = false;
}

function undo() {
  if (!history) return;
  const prev = history.undo();
  if (prev) currentSlide = prev;
}

function redo() {
  if (!history) return;
  const next = history.redo();
  if (next) currentSlide = next;
}

async function handleSave() {
  if (!currentSlide || !item || saving) return;
  saving = true;
  saveError = null;
  try {
    const res = await saveCarouselSlideDocument(item.id, slideNum, currentSlide);
    item = res.item;
    dirty = false;
  } catch (err) {
    saveError = errorText(err);
  } finally {
    saving = false;
  }
}

async function exportAndUploadPNG() {
  const stage = slideCanvasRef?.getStage();
  if (!stage || !item) return;
  await exportSlideAsPNG(stage, `slide_${slideNum}.png`);
  const dataUrl = stage.toDataURL({ pixelRatio: 2 });
  const res = await fetch(dataUrl);
  await uploadCarouselSlidePng(item.id, slideNum, new Uint8Array(await res.arrayBuffer()));
}

async function handleExportPDF() {
  const stage = slideCanvasRef?.getStage();
  if (!stage || !currentSlide) return;
  await exportAllSlidesAsPDF([stage], { width: currentSlide.width, height: currentSlide.height }, `slide_${slideNum}.pdf`);
}

async function handleExportZIP() {
  const stage = slideCanvasRef?.getStage();
  if (!stage) return;
  await exportAllSlidesAsZIP([stage], `slide_${slideNum}.zip`);
}

function handleTextSave(text: string) {
  if (!editingText) return;
  updateElement({ ...editingText, text });
  editingTextId = null;
}

$effect(() => {
  const onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    const isInput =
      tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement | null)?.isContentEditable;
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === "s") {
      e.preventDefault();
      void handleSave();
    } else if (e.key === "z" && !e.shiftKey && !isInput) {
      e.preventDefault();
      undo();
    } else if ((e.key === "z" && e.shiftKey && !isInput) || (e.key === "y" && !isInput)) {
      e.preventDefault();
      redo();
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
});
</script>

<svelte:head>
  <title>Edit slide {slideNum} — {item?.title ?? "Carousel"}</title>
</svelte:head>

<div class="fixed inset-0 z-50 flex flex-col bg-zinc-950 text-zinc-100">
  <header class="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-2">
    <button
      type="button"
      class="text-sm text-zinc-400 hover:text-white"
      onclick={() => goto(`/carousels/${id}`)}
    >
      ← Back to carousel
    </button>
    <p class="text-sm font-medium">
      Slide {slideNum}{item ? ` — ${item.title}` : ""}
      {#if dirty}<span class="ml-2 text-amber-400">unsaved</span>{/if}
    </p>
    <button
      type="button"
      class="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
      onclick={() => void handleSave()}
      disabled={saving}
    >
      {saving ? "Saving…" : "Save"}
    </button>
  </header>

  {#if loadError}
    <div class="bg-red-950 px-4 py-2 text-sm text-red-200" role="alert">{loadError}</div>
  {/if}
  {#if saveError}
    <div class="bg-red-950 px-4 py-2 text-sm text-red-200" role="alert">{saveError}</div>
  {/if}

  {#if currentSlide && history}
    <CanvasToolbar
      bind:slide={currentSlide}
      bind:selectedId
      {history}
      stage={null}
      onExportPNG={() => void exportAndUploadPNG()}
      onExportPDF={() => void handleExportPDF()}
      onExportZIP={() => void handleExportZIP()}
      onRevert={handleRevert}
    />

    <div class="flex min-h-0 flex-1">
      <div bind:this={canvasHost} class="relative flex flex-1 items-center justify-center overflow-auto p-4">
        <SlideCanvas
          bind:this={slideCanvasRef}
          bind:slide={currentSlide}
          bind:selectedId
          containerWidth={canvasWidth - 32}
          containerHeight={canvasHeight - 32}
          onMutate={pushHistory}
          onTextEdit={(elId) => (editingTextId = elId)}
        />
        {#if editingText}
          <InlineTextEditor
            element={editingText}
            onSave={handleTextSave}
            onCancel={() => (editingTextId = null)}
            scale={Math.min((canvasWidth - 32) / currentSlide.width, (canvasHeight - 32) / currentSlide.height, 1)}
          />
        {/if}
      </div>
      <ElementPanel
        element={selectedElement}
        onUpdate={updateElement}
        onDelete={deleteSelected}
        slide={currentSlide}
        onBackgroundChange={updateBackground}
        slideWidth={currentSlide.width}
        slideHeight={currentSlide.height}
      />
    </div>
  {:else if !loadError}
    <div class="flex flex-1 items-center justify-center text-sm text-zinc-400">Loading editor…</div>
  {/if}
</div>
