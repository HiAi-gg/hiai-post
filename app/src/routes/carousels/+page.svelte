<script lang="ts">
import { PageHeader } from "@hiai/ui";
import { Badge } from "@hiai/ui/components/ui/badge/index.js";
import { Button } from "@hiai/ui/components/ui/button/index.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@hiai/ui/components/ui/card/index.js";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@hiai/ui/components/ui/dialog/index.js";
import { Input } from "@hiai/ui/components/ui/input/index.js";
import { Label } from "@hiai/ui/components/ui/label/index.js";
import {
  SelectContent,
  SelectItem,
  SelectRoot,
  SelectTrigger,
  SelectValue,
} from "@hiai/ui/components/ui/select/index.js";
import { Textarea } from "@hiai/ui/components/ui/textarea/index.js";
import {
  approveCarousel,
  CAROUSEL_PRESETS,
  CarouselApiError,
  type CarouselDesignPreset,
  type CarouselItem,
  type CarouselJob,
  type CarouselRevision,
  type CarouselSlideData,
  createCarousel,
  getCarousel,
  getCarouselJob,
  getCarouselRevisions,
  getCarouselSlideJson,
  listCarousels,
  MAX_CAROUSEL_SLIDES,
  regenerateCarousel,
  regenerateCarouselSlide,
  requestCarouselChanges,
  saveCarouselSlideDocument,
  submitCarouselForReview,
} from "$lib/features/carousels/api";

// ── Slide document shape (hiai-kit slide JSON) ──────────────────────────
interface SlideDocBackground {
  type?: string;
  color?: string;
  imageUrl?: string;
  patternColor?: string;
  patternGap?: number;
  patternSize?: number;
  gradient?: { type?: string; angle?: number; stops?: Array<{ offset: number; color: string }> };
}

interface SlideDocElement {
  id: string;
  type: string;
  x: number;
  y: number;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  width?: number;
  height?: number;
  fill?: string | SlideDocBackground;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  textDecoration?: string;
  align?: string;
  lineHeight?: number;
  letterSpacing?: number;
  padding?: number;
  cornerRadius?: number;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  src?: string;
  children?: SlideDocElement[];
}

interface SlideDoc {
  version?: 1;
  width: number;
  height: number;
  background?: SlideDocBackground;
  elements?: SlideDocElement[];
}

interface RenderEl {
  id: string;
  kind: "text" | "rect" | "circle" | "image";
  left: string;
  top: string;
  width: string;
  height: string;
  style: string;
  content?: string;
}

// ── Create form state ────────────────────────────────────────────────────
let carouselTitle = $state("");
let slides = $state<CarouselSlideData[]>([
  { title: "", content: "" },
  { title: "", content: "" },
]);
let designPreset = $state<string>(CAROUSEL_PRESETS[0]);
let handle = $state("");
let ctaText = $state("");
let styleDescription = $state("");

let creating = $state(false);
let createError = $state<string | null>(null);

// ── List state ───────────────────────────────────────────────────────────
let items = $state<CarouselItem[]>([]);
let itemsLoading = $state(true);
let itemsError = $state<string | null>(null);

// ── Workspace state ──────────────────────────────────────────────────────
let workspaceId = $state<string | null>(null);
let item = $state<CarouselItem | null>(null);
let workspaceLoading = $state(false);
let workspaceError = $state<string | null>(null);

let activeSlide = $state(0);
let slideEdits = $state<CarouselSlideData[]>([]);

let revisions = $state<CarouselRevision[]>([]);
let revisionsLoading = $state(false);
let revisionsError = $state<string | null>(null);

// ── Live job state (polling) ─────────────────────────────────────────────
let liveJob = $state<CarouselJob | null>(null);
let liveJobError = $state<string | null>(null);

// ── Preview state ────────────────────────────────────────────────────────
let previewDocs = $state<Record<number, unknown>>({});
let previewLoading = $state(false);
let previewError = $state<string | null>(null);

// ── Action state ─────────────────────────────────────────────────────────
let fullRegenBusy = $state(false);
let slideRegenBusy = $state(false);
let slideDocSaveBusy = $state(false);
let slideRegenDescription = $state("");
let approvalBusy = $state(false);
let actionError = $state<string | null>(null);
let actionSuccess = $state<string | null>(null);
let changesOpen = $state(false);
let changesNote = $state("");

function errorText(err: unknown): string {
  if (err instanceof CarouselApiError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

const canSubmit = $derived(
  carouselTitle.trim().length > 0 && slides.some((s) => s.title.trim() || s.content.trim())
);

function addSlide() {
  if (slides.length >= MAX_CAROUSEL_SLIDES) return;
  slides = [...slides, { title: "", content: "" }];
}

function removeSlide(index: number) {
  if (slides.length <= 1) return;
  slides = slides.filter((_, i) => i !== index);
}

async function loadItems() {
  itemsLoading = true;
  itemsError = null;
  try {
    const { items: loaded } = await listCarousels();
    items = loaded;
  } catch (err) {
    itemsError = errorText(err);
  } finally {
    itemsLoading = false;
  }
}

$effect(() => {
  void loadItems();
});

function resetWorkspace() {
  item = null;
  liveJob = null;
  liveJobError = null;
  previewDocs = {};
  previewError = null;
  revisions = [];
  revisionsError = null;
  actionError = null;
  actionSuccess = null;
  slideRegenDescription = "";
  slideDocSaveBusy = false;
  activeSlide = 0;
}

async function openWorkspace(id: string) {
  resetWorkspace();
  workspaceId = id;
  workspaceLoading = true;
  workspaceError = null;
  try {
    const { item: loaded } = await getCarousel(id);
    item = loaded;
    slideEdits = loaded.bodyJson.slides.map((s) => ({ ...s }));
    void loadRevisions(id);
  } catch (err) {
    workspaceError = errorText(err);
  } finally {
    workspaceLoading = false;
  }
}

function closeWorkspace() {
  workspaceId = null;
  resetWorkspace();
}

async function loadRevisions(id: string) {
  revisionsLoading = true;
  revisionsError = null;
  try {
    const { revisions: revs } = await getCarouselRevisions(id);
    revisions = revs;
  } catch (err) {
    revisionsError = errorText(err);
  } finally {
    revisionsLoading = false;
  }
}

// ── Create ───────────────────────────────────────────────────────────────
async function handleCreate() {
  if (creating || !canSubmit) return;
  createError = null;
  creating = true;
  try {
    const res = await createCarousel({
      carouselTitle: carouselTitle.trim(),
      slides: slides
        .map((s) => ({ title: s.title.trim(), content: s.content.trim() }))
        .filter((s) => s.title || s.content),
      designPreset: designPreset as CarouselDesignPreset,
      handle: handle.trim() || undefined,
      ctaText: ctaText.trim() || undefined,
      styleDescription: styleDescription.trim() || undefined,
    });
    carouselTitle = "";
    handle = "";
    ctaText = "";
    styleDescription = "";
    slides = [
      { title: "", content: "" },
      { title: "", content: "" },
    ];
    void loadItems();
    await openWorkspace(res.item.id);
  } catch (err) {
    createError = errorText(err);
  } finally {
    creating = false;
  }
}

// ── Live job polling (while the workspace is open) ───────────────────────
$effect(() => {
  const id = workspaceId;
  if (!id) return;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const poll = async () => {
    try {
      const { job } = await getCarouselJob(id);
      if (stopped) return;
      liveJob = job;
      liveJobError = null;
      if (job.status === "done" || job.status === "failed") {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        if (job.status === "done") void loadPreviewDocs(id);
      }
    } catch (err) {
      if (stopped) return;
      liveJobError = errorText(err);
    }
  };
  void poll();
  timer = setInterval(() => void poll(), 2000);
  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
});

async function loadPreviewDocs(id: string) {
  const count = Math.min(item?.bodyJson.slides.length ?? 0, MAX_CAROUSEL_SLIDES);
  previewLoading = true;
  previewError = null;
  try {
    const docs: Record<number, unknown> = {};
    for (let i = 1; i <= count; i += 1) {
      try {
        docs[i] = (await getCarouselSlideJson(id, i)).json;
      } catch {
        // A missing slide doc keeps the source copy fallback — never fake a render.
      }
    }
    previewDocs = docs;
  } catch (err) {
    previewError = errorText(err);
  } finally {
    previewLoading = false;
  }
}

// ── Workspace actions ────────────────────────────────────────────────────
const isRunning = $derived(liveJob?.status === "running" || item?.bodyJson.jobStatus === "running");

async function handleFullRegenerate() {
  if (!item || fullRegenBusy) return;
  fullRegenBusy = true;
  actionError = null;
  actionSuccess = null;
  try {
    const res = await regenerateCarousel(item.id, {
      carouselTitle: item.title,
      slides: slideEdits.map((s) => ({ title: s.title, content: s.content })),
      designPreset: item.bodyJson.designPreset as CarouselDesignPreset,
      handle: item.bodyJson.handle ?? undefined,
      ctaText: item.bodyJson.ctaText ?? undefined,
      styleDescription: item.bodyJson.styleDescription ?? undefined,
    });
    item = res.item;
    slideEdits = res.item.bodyJson.slides.map((s) => ({ ...s }));
    previewDocs = {};
    liveJob = null;
    actionSuccess = `Carousel regenerated — new job ${res.job.jobId.slice(0, 8)}… queued (revision #${res.revision.revisionNumber}).`;
    void loadRevisions(item.id);
  } catch (err) {
    actionError = `Full regeneration failed: ${errorText(err)}`;
  } finally {
    fullRegenBusy = false;
  }
}

async function handleSlideRegenerate() {
  if (!item || slideRegenBusy) return;
  const index = activeSlide;
  const edit = slideEdits[index];
  slideRegenBusy = true;
  actionError = null;
  actionSuccess = null;
  try {
    const copyHint = [
      edit?.title ? `New title: ${edit.title}` : "",
      edit?.content ? `New copy: ${edit.content}` : "",
      slideRegenDescription.trim(),
    ]
      .filter(Boolean)
      .join(". ");
    const res = await regenerateCarouselSlide(item.id, index + 1, copyHint || undefined);
    item = res.item;
    slideEdits = res.item.bodyJson.slides.map((s) => ({ ...s }));
    // Reflect the actual regenerated document immediately.
    previewDocs = { ...previewDocs, [index + 1]: res.slide.doc };
    actionSuccess = `Slide ${index + 1} regenerated (revision #${res.revision.revisionNumber}).`;
    slideRegenDescription = "";
    void loadRevisions(item.id);
  } catch (err) {
    actionError = `Slide regeneration failed: ${errorText(err)}`;
  } finally {
    slideRegenBusy = false;
  }
}

async function runApproval(fn: () => Promise<{ item: CarouselItem }>, success: string) {
  if (!item || approvalBusy) return;
  approvalBusy = true;
  actionError = null;
  actionSuccess = null;
  try {
    const res = await fn();
    item = res.item;
    actionSuccess = success;
    void loadRevisions(item.id);
  } catch (err) {
    actionError = errorText(err);
  } finally {
    approvalBusy = false;
  }
}

function handleSubmitReview() {
  return runApproval(() => submitCarouselForReview(item!.id), "Submitted for review.");
}

function handleApprove() {
  return runApproval(() => approveCarousel(item!.id), "Carousel approved.");
}

async function handleRequestChanges() {
  if (!item || approvalBusy || changesNote.trim().length === 0) return;
  approvalBusy = true;
  actionError = null;
  actionSuccess = null;
  try {
    const res = await requestCarouselChanges(item.id, changesNote.trim());
    item = res.item;
    actionSuccess = "Changes requested — the editor can resubmit after revising.";
    changesOpen = false;
    changesNote = "";
    void loadRevisions(item.id);
  } catch (err) {
    actionError = errorText(err);
  } finally {
    approvalBusy = false;
  }
}

// ── Slide preview rendering helpers ──────────────────────────────────────
function clampPercent(n: number): string {
  return `${Number.isFinite(n) ? n : 0}%`;
}

function toGradient(bg: SlideDocBackground): string {
  const stops = (bg.gradient?.stops ?? []).map((s) => `${s.color} ${s.offset}%`).join(", ");
  if (bg.gradient?.type === "radial") return `radial-gradient(circle, ${stops})`;
  return `linear-gradient(${bg.gradient?.angle ?? 135}deg, ${stops})`;
}

function fillStyle(fill: unknown): string {
  if (typeof fill === "string") return fill;
  if (fill && typeof fill === "object" && (fill as SlideDocBackground).gradient) {
    return toGradient(fill as SlideDocBackground);
  }
  return "transparent";
}

function backgroundStyle(bg: SlideDocBackground | undefined): string {
  if (!bg) return "#ffffff";
  switch (bg.type) {
    case "gradient":
      return toGradient(bg);
    case "image":
      return bg.imageUrl
        ? `url("${bg.imageUrl}") center / cover no-repeat`
        : (bg.color ?? "#ffffff");
    case "dots": {
      const gap = bg.patternGap ?? 20;
      const size = bg.patternSize ?? 2;
      return `radial-gradient(${bg.patternColor ?? "#d4d4d8"} ${size}px, transparent ${size}px) 0 0 / ${gap}px ${gap}px`;
    }
    case "stripes": {
      const gap = bg.patternGap ?? 16;
      const size = bg.patternSize ?? 4;
      return `repeating-linear-gradient(45deg, ${bg.patternColor ?? "#d4d4d8"} 0 ${size}px, transparent ${size}px ${gap}px)`;
    }
    case "grid": {
      const gap = bg.patternGap ?? 20;
      const size = bg.patternSize ?? 1;
      const inner = Math.max(gap - size, 1);
      return [
        `repeating-linear-gradient(0deg, transparent 0 ${inner}px, ${bg.patternColor ?? "#d4d4d8"} ${inner}px ${gap}px)`,
        `repeating-linear-gradient(90deg, transparent 0 ${inner}px, ${bg.patternColor ?? "#d4d4d8"} ${inner}px ${gap}px)`,
      ].join(", ");
    }
    default:
      return bg.color ?? "#ffffff";
  }
}

function flatten(elements: SlideDocElement[], parentX: number, parentY: number): SlideDocElement[] {
  const out: SlideDocElement[] = [];
  for (const el of elements) {
    const abs = { ...el, x: el.x + parentX, y: el.y + parentY };
    if (el.type === "group" && Array.isArray(el.children)) {
      out.push(...flatten(el.children, abs.x, abs.y));
    } else {
      out.push(abs);
    }
  }
  return out;
}

function qw(doc: SlideDoc, value: number): string {
  return `calc(${value} / ${doc.width} * 100cqw)`;
}

function normalizeElements(doc: SlideDoc): RenderEl[] {
  const w = doc.width || 1080;
  const h = doc.height || 1350;
  const els: RenderEl[] = [];
  for (const el of flatten(doc.elements ?? [], 0, 0)) {
    if (el.visible === false) continue;
    const base = `left: ${clampPercent((el.x / w) * 100)}; top: ${clampPercent((el.y / h) * 100)}; opacity: ${el.opacity ?? 1}; transform: rotate(${el.rotation ?? 0}deg);`;
    if (el.type === "text") {
      els.push({
        id: el.id,
        kind: "text",
        left: clampPercent((el.x / w) * 100),
        top: clampPercent((el.y / h) * 100),
        width: clampPercent(((el.width ?? 200) / w) * 100),
        height: clampPercent(((el.height ?? 60) / h) * 100),
        style:
          `${base} width: ${clampPercent(((el.width ?? 200) / w) * 100)}; ` +
          `height: ${clampPercent(((el.height ?? 60) / h) * 100)}; color: ${el.fill ?? "#111111"}; ` +
          `font-size: ${qw(doc, el.fontSize ?? 20)}; font-family: ${el.fontFamily ?? "sans-serif"}; ` +
          `font-weight: ${el.fontWeight ?? "normal"}; font-style: ${el.fontStyle ?? "normal"}; ` +
          `text-decoration: ${el.textDecoration ?? "none"}; text-align: ${el.align ?? "left"}; ` +
          `line-height: ${el.lineHeight ?? 1.2}; letter-spacing: ${qw(doc, el.letterSpacing ?? 0)}; ` +
          `padding: ${qw(doc, el.padding ?? 0)};`,
        content: el.text ?? "",
      });
    } else if (el.type === "rect") {
      const border =
        el.stroke && el.strokeWidth
          ? ` border: ${qw(doc, el.strokeWidth)} solid ${el.stroke};`
          : "";
      els.push({
        id: el.id,
        kind: "rect",
        left: clampPercent((el.x / w) * 100),
        top: clampPercent((el.y / h) * 100),
        width: clampPercent(((el.width ?? 0) / w) * 100),
        height: clampPercent(((el.height ?? 0) / h) * 100),
        style:
          `${base} width: ${clampPercent(((el.width ?? 0) / w) * 100)}; ` +
          `height: ${clampPercent(((el.height ?? 0) / h) * 100)}; background: ${fillStyle(el.fill)}; ` +
          `border-radius: ${qw(doc, el.cornerRadius ?? 0)};${border}`,
      });
    } else if (el.type === "circle") {
      const radius = el.radius ?? 10;
      els.push({
        id: el.id,
        kind: "circle",
        left: clampPercent((el.x / w) * 100),
        top: clampPercent((el.y / h) * 100),
        width: clampPercent(((radius * 2) / w) * 100),
        height: clampPercent(((radius * 2) / h) * 100),
        style:
          `${base} width: ${clampPercent(((radius * 2) / w) * 100)}; ` +
          `height: ${clampPercent(((radius * 2) / h) * 100)}; background: ${fillStyle(el.fill)}; border-radius: 9999px;`,
      });
    } else if (el.type === "image") {
      els.push({
        id: el.id,
        kind: "image",
        left: clampPercent((el.x / w) * 100),
        top: clampPercent((el.y / h) * 100),
        width: clampPercent(((el.width ?? 0) / w) * 100),
        height: clampPercent(((el.height ?? 0) / h) * 100),
        style:
          `${base} width: ${clampPercent(((el.width ?? 0) / w) * 100)}; ` +
          `height: ${clampPercent(((el.height ?? 0) / h) * 100)}; border-radius: ${qw(doc, el.cornerRadius ?? 0)};`,
        content: el.src ?? "",
      });
    }
  }
  return els;
}

function slideDocFor(index: number): SlideDoc | undefined {
  const num = index + 1;
  const doc = previewDocs[num] ?? item?.bodyJson.slides[index]?.doc;
  if (!doc || typeof doc !== "object") return undefined;
  return doc as SlideDoc;
}

// ── Save-as-document (copy → hiai-kit slide document) ────────────────────
const PRESET_BACKGROUND: Record<string, { bg: string; fg: string }> = {
  minimal: { bg: "#ffffff", fg: "#1a1a1a" },
  bold: { bg: "#0d0d0d", fg: "#ffffff" },
  gradient: { bg: "#667eea", fg: "#ffffff" },
  elegant: { bg: "#1a1a2e", fg: "#ffffff" },
  playful: { bg: "#fff8f0", fg: "#1a1a1a" },
  corporate: { bg: "#f5f7fa", fg: "#111827" },
  custom: { bg: "#ffffff", fg: "#1a1a1a" },
};

/**
 * Build a valid hiai-kit slide document from the current source copy. This is
 * the save path for the workspace's supported copy editor: no Konva-style
 * canvas editor is ported here — the copy (title/content) is composed into a
 * `{ version: 1, width, height, background, elements }` document the preview
 * renderer can draw, then persisted via `PUT /carousels/:id/slides/:n/json`.
 */
function buildSlideDocument(
  slide: CarouselSlideData,
  width: number,
  height: number,
  preset: string
): SlideDoc {
  const palette = PRESET_BACKGROUND[preset] ?? PRESET_BACKGROUND.minimal;
  const pad = Math.max(Math.round(width * 0.08), 40);
  const innerWidth = width - pad * 2;
  const titleSize = Math.max(Math.round(height * 0.09), 44);
  const bodySize = Math.max(Math.round(height * 0.04), 22);
  const titleY = Math.round(height * 0.1);
  const bodyY = titleY + Math.round(titleSize * 1.4);
  const title = slide.title.trim() || "Untitled slide";
  const body = slide.content.trim() || "Add slide content in the editor, then save the document.";

  const elements: SlideDocElement[] = [
    {
      id: "title",
      type: "text",
      x: pad,
      y: titleY,
      rotation: 0,
      opacity: 1,
      visible: true,
      width: innerWidth,
      height: Math.round(titleSize * 1.4),
      text: title,
      fontSize: titleSize,
      fontFamily: "Inter",
      fontWeight: "bold",
      fontStyle: "normal",
      textDecoration: "none",
      fill: palette.fg,
      align: "left",
      lineHeight: 1.15,
      letterSpacing: 0,
      padding: 0,
    },
    {
      id: "body",
      type: "text",
      x: pad,
      y: bodyY,
      rotation: 0,
      opacity: 1,
      visible: true,
      width: innerWidth,
      height: height - bodyY - pad,
      text: body,
      fontSize: bodySize,
      fontFamily: "Inter",
      fontWeight: "normal",
      fontStyle: "normal",
      textDecoration: "none",
      fill: palette.fg,
      align: "left",
      lineHeight: 1.45,
      letterSpacing: 0,
      padding: 0,
    },
  ];

  return {
    version: 1,
    width,
    height,
    background: { type: "solid", color: palette.bg },
    elements,
  };
}

async function handleSaveSlideDocument() {
  if (!item || slideDocSaveBusy) return;
  const index = activeSlide;
  const edit = slideEdits[index];
  slideDocSaveBusy = true;
  actionError = null;
  actionSuccess = null;
  try {
    const width = item.bodyJson.slideWidth ?? 1080;
    const height = item.bodyJson.slideHeight ?? 1350;
    const doc = buildSlideDocument(edit, width, height, item.bodyJson.designPreset);
    const res = await saveCarouselSlideDocument(item.id, index + 1, doc);
    item = res.item;
    slideEdits = res.item.bodyJson.slides.map((s) => ({ ...s }));
    // Reflect the persisted document immediately in the preview.
    previewDocs = { ...previewDocs, [index + 1]: res.slide.doc };
    actionSuccess = `Slide ${index + 1} document saved (revision #${res.revision.revisionNumber}).`;
    void loadRevisions(item.id);
  } catch (err) {
    actionError = `Saving slide document failed: ${errorText(err)}`;
  } finally {
    slideDocSaveBusy = false;
  }
}

function approvalBadge(status: string): string {
  switch (status) {
    case "in_review":
      return "default";
    case "approved":
      return "outline";
    case "changes_requested":
      return "destructive";
    default:
      return "secondary";
  }
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

function timeLabel(value: string | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}
</script>

<svelte:head>
  <title>Carousels — HiAi Post</title>
</svelte:head>

<div class="mx-auto max-w-7xl space-y-6">
  <PageHeader
    title="Carousels"
    description="Generate branded carousel decks, edit slide copy, regenerate slides or the whole deck, and track approval history — all stored as versioned content items."
  >
    {#snippet actions()}
      {#if workspaceId}
        <Button variant="outline" size="sm" onclick={closeWorkspace}>Back to list</Button>
      {/if}
    {/snippet}
  </PageHeader>

  {#if workspaceId}
    <!-- ── Workspace ─────────────────────────────────────────────── -->
    {#if workspaceLoading}
      <Card>
        <CardContent class="py-10 text-center text-sm text-muted-foreground">
          Loading carousel workspace…
        </CardContent>
      </Card>
    {:else if workspaceError}
      <Card>
        <CardContent class="py-10 text-center space-y-3">
          <p class="text-sm text-destructive" role="alert">Failed to load carousel: {workspaceError}</p>
          <Button variant="outline" size="sm" onclick={() => void openWorkspace(workspaceId!)}>
            Retry
          </Button>
        </CardContent>
      </Card>
    {:else if item}
      <div class="grid gap-6 lg:grid-cols-5">
        <!-- Left column: edit + actions -->
        <div class="space-y-6 lg:col-span-2 self-start">
          <Card>
            <CardHeader>
              <div class="flex items-center justify-between gap-2">
                <CardTitle class="truncate">{item.title}</CardTitle>
                <Badge variant={approvalBadge(item.status)}>{statusLabel(item.status)}</Badge>
              </div>
              <CardDescription>
                Job <span class="font-mono text-xs">{item.bodyJson.slug}</span> · created
                {timeLabel(item.createdAt)}
              </CardDescription>
            </CardHeader>
            <CardContent class="space-y-3">
              <div class="flex flex-wrap items-center gap-2">
                <Badge variant={isRunning ? "secondary" : "outline"}>
                  job: {liveJob?.status ?? item.bodyJson.jobStatus}
                </Badge>
                <Badge variant="secondary">preset: {item.bodyJson.designPreset}</Badge>
                {#if item.bodyJson.slideWidth && item.bodyJson.slideHeight}
                  <Badge variant="secondary">
                    {item.bodyJson.slideWidth}×{item.bodyJson.slideHeight}
                  </Badge>
                {/if}
              </div>

              {#if item.reviewNote}
                <div class="rounded-md border border-border p-3">
                  <p class="text-xs font-medium text-muted-foreground">Reviewer feedback</p>
                  <p class="mt-1 text-sm">{item.reviewNote}</p>
                </div>
              {/if}

              {#if liveJobError}
                <p class="text-sm text-destructive" role="alert">
                  Live status unavailable: {liveJobError}
                </p>
              {/if}
            </CardContent>
            <CardFooter class="flex flex-wrap gap-2">
              {#if item.status === "draft" || item.status === "changes_requested"}
                <Button
                  type="button"
                  size="sm"
                  onclick={() => void handleSubmitReview()}
                  disabled={approvalBusy || isRunning}
                >
                  {approvalBusy ? "Working…" : "Submit for review"}
                </Button>
              {/if}
              {#if item.status === "in_review"}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onclick={() => (changesOpen = true)}
                  disabled={approvalBusy}
                >
                  Request changes
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onclick={() => void handleApprove()}
                  disabled={approvalBusy}
                >
                  {approvalBusy ? "Working…" : "Approve"}
                </Button>
              {/if}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onclick={() => void handleFullRegenerate()}
                disabled={fullRegenBusy || isRunning}
              >
                {fullRegenBusy ? "Regenerating…" : "Regenerate carousel"}
              </Button>
            </CardFooter>
          </Card>

          <!-- Slide editor -->
          <Card>
            <CardHeader>
              <CardTitle>Slide {activeSlide + 1} — copy</CardTitle>
              <CardDescription>
                Edit the slide source copy, then save it as a document revision, or redraw the
                slide with “Regenerate slide” (LLM). Saving composes the copy into an actual
                hiai-kit slide document and appends an immutable revision.
              </CardDescription>
            </CardHeader>
            <CardContent class="space-y-3">
              <div class="space-y-2">
                <Label for="slide-edit-title">Slide title</Label>
                <Input
                  id="slide-edit-title"
                  bind:value={slideEdits[activeSlide].title}
                  placeholder="Slide title"
                />
              </div>
              <div class="space-y-2">
                <Label for="slide-edit-content">Slide copy</Label>
                <Textarea
                  id="slide-edit-content"
                  bind:value={slideEdits[activeSlide].content}
                  placeholder="Slide content / copy"
                  rows={4}
                />
              </div>
              <div class="space-y-2">
                <Label for="slide-regen-description">Regeneration guidance (optional)</Label>
                <Textarea
                  id="slide-regen-description"
                  bind:value={slideRegenDescription}
                  placeholder="e.g. make the hook punchier, use fewer words…"
                  rows={2}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button
                type="button"
                onclick={() => void handleSlideRegenerate()}
                disabled={slideRegenBusy || isRunning}
              >
                {slideRegenBusy ? "Regenerating…" : "Regenerate slide"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onclick={() => void handleSaveSlideDocument()}
                disabled={slideDocSaveBusy}
              >
                {slideDocSaveBusy ? "Saving…" : "Save slide document"}
              </Button>
            </CardFooter>
          </Card>

          {#if actionError}
            <p class="text-sm text-destructive" role="alert">{actionError}</p>
          {/if}
          {#if actionSuccess}
            <p class="text-sm text-green-600" role="status">{actionSuccess}</p>
          {/if}

          <!-- Revisions -->
          <Card>
            <CardHeader>
              <CardTitle>Revision history</CardTitle>
              <CardDescription>Append-only; regenerations always add a new revision.</CardDescription>
            </CardHeader>
            <CardContent class="space-y-2">
              {#if revisionsLoading}
                <p class="text-sm text-muted-foreground py-4 text-center">Loading revisions…</p>
              {:else if revisionsError}
                <p class="text-sm text-destructive" role="alert">Failed to load revisions: {revisionsError}</p>
              {:else if revisions.length === 0}
                <p class="text-sm text-muted-foreground py-4 text-center">No revisions yet.</p>
              {:else}
                {#each revisions as rev (rev.id)}
                  <div class="rounded-md border border-border p-3">
                    <div class="flex items-center justify-between gap-2">
                      <p class="text-sm font-medium">Revision #{rev.revisionNumber}</p>
                      <span class="text-xs text-muted-foreground">{timeLabel(rev.createdAt)}</span>
                    </div>
                    <p class="mt-0.5 text-xs text-muted-foreground">
                      {rev.changeNote ?? "No note"}
                    </p>
                    {#if rev.bodyJson}
                      <p class="mt-1 font-mono text-[11px] text-muted-foreground">
                        job {rev.bodyJson.jobId.slice(0, 8)}… · {rev.bodyJson.slides.length} slide(s)
                      </p>
                    {/if}
                  </div>
                {/each}
              {/if}
            </CardContent>
          </Card>
        </div>

        <!-- Right column: navigation + render -->
        <div class="space-y-6 lg:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>Slides</CardTitle>
              <CardDescription>
                {#if isRunning}
                  Rendering in the background — progress updates automatically.
                {:else}
                  {item.bodyJson.slides.length} slide(s). Select a slide to inspect or edit it.
                {/if}
              </CardDescription>
            </CardHeader>
            <CardContent class="space-y-4">
              {#if isRunning && liveJob}
                <div>
                  <p class="text-sm">
                    Step {Math.min(liveJob.stepIndex + 1, liveJob.totalSteps)}/{liveJob.totalSteps}:
                    <span class="font-medium">{liveJob.step}</span>
                  </p>
                  <div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      class="h-full rounded-full bg-primary transition-all"
                      style="width: {Math.round(((liveJob.stepIndex + 1) / liveJob.totalSteps) * 100)}%"
                    ></div>
                  </div>
                  {#if liveJob.progress}
                    <p class="mt-2 text-sm text-muted-foreground">{liveJob.progress.stepDetail}</p>
                    {#if liveJob.progress.slideProgress}
                      <p class="text-xs text-muted-foreground">
                        Slide {liveJob.progress.slideProgress.current}/{liveJob.progress.slideProgress.total}
                      </p>
                    {/if}
                    {#if liveJob.progress.estimatedRemaining != null}
                      <p class="text-xs text-muted-foreground">
                        ~{liveJob.progress.estimatedRemaining}s remaining
                      </p>
                    {/if}
                  {/if}
                </div>
              {:else if liveJob?.status === "failed"}
                <p class="text-sm text-destructive" role="alert">
                  {liveJob.error ?? "The job failed without a detailed error."}
                </p>
              {/if}

              <!-- Slide navigation -->
              <div class="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onclick={() => (activeSlide = Math.max(0, activeSlide - 1))}
                  disabled={activeSlide === 0}
                >
                  ← Prev
                </Button>
                {#each item.bodyJson.slides as slide, i (i)}
                  <button
                    type="button"
                    class:border-primary={activeSlide === i}
                    class="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary/60"
                    onclick={() => (activeSlide = i)}
                  >
                    {i + 1}
                  </button>
                {/each}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onclick={() =>
                    (activeSlide = Math.min(item.bodyJson.slides.length - 1, activeSlide + 1))}
                  disabled={activeSlide >= item.bodyJson.slides.length - 1}
                >
                  Next →
                </Button>
              </div>

              <!-- Rendered slide -->
              <div>
                {#if previewLoading}
                  <p class="text-sm text-muted-foreground py-6 text-center">
                    Loading actual slide documents…
                  </p>
                {:else if previewError}
                  <p class="text-sm text-destructive" role="alert">
                    Failed to load slide documents: {previewError}
                  </p>
                {:else}
                  {@const doc = slideDocFor(activeSlide)}
                  <div
                    class="mx-auto w-full max-w-sm overflow-hidden rounded-lg border border-border"
                    style="container-type: inline-size; aspect-ratio: {(doc?.width ?? 1080)} / {(doc?.height ?? 1350)}; background: {backgroundStyle(doc?.background)};"
                  >
                    {#if doc && (doc.elements?.length ?? 0) > 0}
                      <div class="relative h-full w-full">
                        {#each normalizeElements(doc) as el (el.id)}
                          {#if el.kind === "text"}
                            <div class="absolute overflow-hidden" style={el.style}>{el.content}</div>
                          {:else if el.kind === "image"}
                            <img class="absolute object-cover" src={el.content} alt="" style={el.style} />
                          {:else}
                            <div class="absolute" style={el.style}></div>
                          {/if}
                        {/each}
                      </div>
                    {:else}
                      <div class="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
                        <p class="text-lg font-semibold">{slideEdits[activeSlide].title || "Untitled slide"}</p>
                        <p class="text-sm text-muted-foreground">{slideEdits[activeSlide].content}</p>
                        <p class="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground/70">
                          Source copy preview — generated document appears after the job finishes
                        </p>
                      </div>
                    {/if}
                  </div>
                  <p class="mt-2 text-center text-xs text-muted-foreground">
                    Slide {activeSlide + 1} of {item.bodyJson.slides.length}
                  </p>
                {/if}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    {/if}
  {:else}
    <!-- ── List + create ─────────────────────────────────────────── -->
    <div class="grid gap-6 lg:grid-cols-5">
      <!-- Create form -->
      <Card class="lg:col-span-2 self-start">
        <CardHeader>
          <CardTitle>New carousel</CardTitle>
          <CardDescription>
            Define the deck title, slides and design preset. The backend dispatches a render job and
            stores everything as a versioned content item.
          </CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="space-y-2">
            <Label for="carousel-title">Carousel title</Label>
            <Input id="carousel-title" bind:value={carouselTitle} placeholder="10 AI tools I use daily" />
          </div>

          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <Label>Slides ({slides.length}/{MAX_CAROUSEL_SLIDES})</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onclick={addSlide}
                disabled={slides.length >= MAX_CAROUSEL_SLIDES}
              >+ Add slide</Button>
            </div>
            {#each slides as slide, i (i)}
              <div class="rounded-md border border-border p-3 space-y-2">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-xs font-medium text-muted-foreground">Slide {i + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onclick={() => removeSlide(i)}
                    disabled={slides.length <= 1}
                  >Remove</Button>
                </div>
                <Input bind:value={slide.title} placeholder="Slide title" />
                <Textarea bind:value={slide.content} placeholder="Slide content / copy" rows={3} />
              </div>
            {/each}
          </div>

          <div class="space-y-2">
            <Label for="design-preset">Design preset</Label>
            <SelectRoot type="single" bind:value={designPreset}>
              <SelectTrigger id="design-preset" class="w-full">
                <SelectValue placeholder="Choose a preset" />
              </SelectTrigger>
              <SelectContent>
                {#each CAROUSEL_PRESETS as preset}
                  <SelectItem value={preset}>{preset}</SelectItem>
                {/each}
              </SelectContent>
            </SelectRoot>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-2">
              <Label for="carousel-handle">Handle (optional)</Label>
              <Input id="carousel-handle" bind:value={handle} placeholder="@brand" />
            </div>
            <div class="space-y-2">
              <Label for="carousel-cta">CTA text (optional)</Label>
              <Input id="carousel-cta" bind:value={ctaText} placeholder="Follow for more" />
            </div>
          </div>

          <div class="space-y-2">
            <Label for="carousel-style">Style description (optional)</Label>
            <Textarea
              id="carousel-style"
              bind:value={styleDescription}
              placeholder="Describe the look: colors, mood, fonts…"
              rows={2}
            />
          </div>

          {#if createError}
            <p class="text-sm text-destructive" role="alert">Failed to create carousel: {createError}</p>
          {/if}
        </CardContent>
        <CardFooter>
          <Button type="button" onclick={() => void handleCreate()} disabled={creating || !canSubmit}>
            {creating ? "Creating…" : "Create carousel"}
          </Button>
        </CardFooter>
      </Card>

      <!-- Carousel list -->
      <div class="lg:col-span-3 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Carousels</CardTitle>
            <CardDescription>Versioned decks in this workspace, newest first.</CardDescription>
          </CardHeader>
          <CardContent class="space-y-3">
            {#if itemsLoading}
              <p class="text-sm text-muted-foreground py-6 text-center">Loading carousels…</p>
            {:else if itemsError}
              <div class="py-6 text-center space-y-3">
                <p class="text-sm text-destructive" role="alert">Failed to load carousels: {itemsError}</p>
                <Button variant="outline" size="sm" onclick={() => void loadItems()}>Retry</Button>
              </div>
            {:else if items.length === 0}
              <p class="text-sm text-muted-foreground py-6 text-center">
                No carousels yet. Create your first deck to see it here.
              </p>
            {:else}
              {#each items as c (c.id)}
                <div class="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium">{c.title}</p>
                    <p class="mt-0.5 text-xs text-muted-foreground">
                      {timeLabel(c.createdAt)} · {c.bodyJson.slides.length} slide(s) · job
                      {c.bodyJson.jobId.slice(0, 8)}…
                    </p>
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    <Badge variant={approvalBadge(c.status)}>{statusLabel(c.status)}</Badge>
                    <Badge variant={c.bodyJson.jobStatus === "failed" ? "destructive" : "secondary"}>
                      {c.bodyJson.jobStatus}
                    </Badge>
                    <Button variant="outline" size="sm" onclick={() => void openWorkspace(c.id)}>
                      Open
                    </Button>
                  </div>
                </div>
              {/each}
            {/if}
          </CardContent>
        </Card>
      </div>
    </div>
  {/if}
</div>

<!-- Request changes dialog -->
<Dialog bind:open={changesOpen}>
  <DialogHeader>
    <DialogTitle>Request changes</DialogTitle>
    <DialogDescription>
      Explain what to revise. The carousel returns to the editor who can resubmit after changes.
    </DialogDescription>
  </DialogHeader>
  <div class="space-y-2">
    <Label for="changes-note">Reviewer note</Label>
    <Textarea
      id="changes-note"
      bind:value={changesNote}
      placeholder="e.g. tone down the hype, fix the third slide's math…"
      rows={4}
    />
  </div>
  <DialogFooter>
    <Button variant="outline" onclick={() => (changesOpen = false)}>Cancel</Button>
    <Button
      type="button"
      onclick={() => void handleRequestChanges()}
      disabled={approvalBusy || changesNote.trim().length === 0}
    >
      {approvalBusy ? "Sending…" : "Request changes"}
    </Button>
  </DialogFooter>
</Dialog>
