<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
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
import { Label } from "@hiai/ui/components/ui/label/index.js";
import { Textarea } from "@hiai/ui/components/ui/textarea/index.js";
import SlideCanvas from "$lib/components/canvas/SlideCanvas.svelte";
import { exportAllSlidesAsPDF, exportAllSlidesAsZIP, exportSlideAsPNG } from "$lib/canvas/exporter";
import type { SlideDocument } from "$lib/canvas/types";
import { createSlideDocument } from "$lib/canvas/defaults";
import {
  addCarouselBlankSlide,
  approveCarousel,
  CarouselApiError,
  type CarouselItem,
  type CarouselJob,
  type CarouselRevision,
  carouselCoverUrl,
  editCarouselCover,
  getCarousel,
  getCarouselJob,
  getCarouselRevisions,
  getCarouselSlideJson,
  MAX_CAROUSEL_SLIDES,
  regenerateCarouselSlide,
  requestCarouselChanges,
  submitCarouselForReview,
  uploadCarouselSlidePng,
} from "$lib/features/carousels/api";
import {
  canAddBlankSlide,
  canEditCover,
  isCoverSelected,
  slideIndexFromView,
  viewIndexFromSlide,
  viewItemCount,
} from "$lib/features/carousels/viewer";

let item = $state<CarouselItem | null>(null);
let job = $state<CarouselJob | null>(null);
let loadError = $state<string | null>(null);
let loading = $state(true);
let slides = $state<SlideDocument[]>([]);
let viewIndex = $state(0);
let coverFailed = $state(false);
let actionError = $state<string | null>(null);
let actionSuccess = $state<string | null>(null);
let exporting = $state(false);
let addingSlide = $state(false);
let canvasRefs = $state<Array<SlideCanvas | undefined>>([]);

let revisions = $state<CarouselRevision[]>([]);
let revisionsLoading = $state(false);
let approvalBusy = $state(false);
let changesOpen = $state(false);
let changesNote = $state("");

let coverEditOpen = $state(false);
let coverEditDescription = $state("");
let coverEditing = $state(false);
let coverVersion = $state(Date.now().toString());

const id = $derived(page.params.id ?? "");
const hasCover = $derived(!coverFailed);
const viewingCover = $derived(isCoverSelected(viewIndex, hasCover));
const activeSlide = $derived(slideIndexFromView(viewIndex, hasCover));
const jobDone = $derived((job?.status ?? item?.bodyJson.jobStatus) === "done");
const showEditCover = $derived(canEditCover({ viewingCover, jobDone, hasCover }));
const showAddSlide = $derived(jobDone && canAddBlankSlide(slides.length, MAX_CAROUSEL_SLIDES));
const totalViews = $derived(viewItemCount(slides.length, hasCover));

function errorText(err: unknown): string {
  if (err instanceof CarouselApiError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

function asSlideDoc(raw: unknown, width: number, height: number): SlideDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as SlideDocument;
  if (!Array.isArray(doc.elements) || typeof doc.width !== "number") return null;
  return {
    ...doc,
    version: 1,
    width: doc.width || width,
    height: doc.height || height,
    background: doc.background ?? { type: "solid", color: "#ffffff" },
    elements: doc.elements,
  };
}

async function loadRevisions(contentId: string) {
  revisionsLoading = true;
  try {
    const { revisions: revs } = await getCarouselRevisions(contentId);
    revisions = revs;
  } catch {
    revisions = [];
  } finally {
    revisionsLoading = false;
  }
}

async function load() {
  if (!id) return;
  loading = true;
  loadError = null;
  try {
    const { item: loaded } = await getCarousel(id);
    item = loaded;
    const width = loaded.bodyJson.slideWidth ?? 1080;
    const height = loaded.bodyJson.slideHeight ?? 1350;
    const preset = loaded.bodyJson.designPreset;
    const canvasPreset = preset === "bold" || preset === "gradient" ? preset : "minimal";
    const docs: SlideDocument[] = [];
    const count = Math.min(loaded.bodyJson.slides.length, MAX_CAROUSEL_SLIDES);
    for (let n = 1; n <= count; n += 1) {
      const persisted = asSlideDoc(loaded.bodyJson.slides[n - 1]?.doc, width, height);
      if (persisted) {
        docs.push(persisted);
        continue;
      }
      try {
        const remote = asSlideDoc((await getCarouselSlideJson(id, n)).json, width, height);
        docs.push(remote ?? createSlideDocument(width, height, canvasPreset));
      } catch {
        docs.push(createSlideDocument(width, height, canvasPreset));
      }
    }
    slides = docs;
    void loadRevisions(id);
  } catch (err) {
    loadError = errorText(err);
  } finally {
    loading = false;
  }
}

$effect(() => {
  void load();
});

$effect(() => {
  const contentId = id;
  if (!contentId) return;
  let stopped = false;
  const poll = async () => {
    try {
      const { job: next } = await getCarouselJob(contentId);
      if (!stopped) job = next;
    } catch {
      /* job status is optional on the viewer */
    }
  };
  void poll();
  const timer = setInterval(() => void poll(), 2500);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
});

function collectStages() {
  return canvasRefs
    .map((ref) => {
      try {
        return ref?.getStage() ?? null;
      } catch {
        return null;
      }
    })
    .filter((stage): stage is NonNullable<typeof stage> => stage != null);
}

async function uploadExportedPngs() {
  const stages = collectStages();
  for (let i = 0; i < stages.length; i += 1) {
    const dataUrl = stages[i].toDataURL({ pixelRatio: 2 });
    const res = await fetch(dataUrl);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await uploadCarouselSlidePng(id, i + 1, bytes);
  }
}

async function handleExportPNG() {
  if (viewingCover) {
    actionError = null;
    try {
      const res = await fetch(`${carouselCoverUrl(id)}?v=${coverVersion}`);
      if (!res.ok) throw new Error("Cover PNG is not available yet");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${item?.bodyJson.slug ?? "carousel"}_cover.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      actionError = errorText(err);
    }
    return;
  }
  const stages = collectStages();
  const stage = stages[activeSlide];
  if (!stage) return;
  exporting = true;
  actionError = null;
  try {
    await exportSlideAsPNG(stage, `slide_${activeSlide + 1}.png`);
    const dataUrl = stage.toDataURL({ pixelRatio: 2 });
    const res = await fetch(dataUrl);
    await uploadCarouselSlidePng(id, activeSlide + 1, new Uint8Array(await res.arrayBuffer()));
  } catch (err) {
    actionError = errorText(err);
  } finally {
    exporting = false;
  }
}

async function handleExportZIP() {
  const stages = collectStages();
  if (stages.length === 0) return;
  exporting = true;
  actionError = null;
  try {
    await exportAllSlidesAsZIP(stages, `${item?.bodyJson.slug ?? "carousel"}.zip`);
    await uploadExportedPngs();
  } catch (err) {
    actionError = errorText(err);
  } finally {
    exporting = false;
  }
}

async function handleExportPDF() {
  const stages = collectStages();
  const current = slides[Math.max(activeSlide, 0)] ?? slides[0];
  if (stages.length === 0 || !current) return;
  exporting = true;
  actionError = null;
  try {
    await exportAllSlidesAsPDF(stages, { width: current.width, height: current.height }, `${item?.bodyJson.slug ?? "carousel"}.pdf`);
    await uploadExportedPngs();
  } catch (err) {
    actionError = errorText(err);
  } finally {
    exporting = false;
  }
}

async function handleRegenerate() {
  if (!item || viewingCover) return;
  actionError = null;
  try {
    await regenerateCarouselSlide(item.id, activeSlide + 1);
    await load();
  } catch (err) {
    actionError = errorText(err);
  }
}

async function handleAddBlankSlide() {
  if (!item || addingSlide || !showAddSlide) return;
  addingSlide = true;
  actionError = null;
  try {
    const res = await addCarouselBlankSlide(item.id);
    item = res.item;
    await load();
    viewIndex = viewIndexFromSlide(res.slideNumber - 1, hasCover);
    await goto(`/carousels/${id}/edit/${res.slideNumber}`);
  } catch (err) {
    actionError = errorText(err);
  } finally {
    addingSlide = false;
  }
}

async function submitCoverEdit() {
  if (!item || coverEditing || !coverEditDescription.trim()) return;
  coverEditing = true;
  actionError = null;
  actionSuccess = null;
  try {
    await editCarouselCover(item.id, coverEditDescription.trim());
    coverVersion = Date.now().toString();
    coverFailed = false;
    coverEditOpen = false;
    coverEditDescription = "";
    actionSuccess = "Cover regenerated.";
  } catch (err) {
    actionError = errorText(err);
  } finally {
    coverEditing = false;
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
    actionSuccess = "Changes requested.";
    changesOpen = false;
    changesNote = "";
    void loadRevisions(item.id);
  } catch (err) {
    actionError = errorText(err);
  } finally {
    approvalBusy = false;
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
  <title>{item?.title ?? "Carousel"} — HiAi Post</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6">
  <PageHeader title={item?.title ?? "Carousel"} description="One path: canvas edit, cover, export, and approval.">
    {#snippet actions()}
      <Button variant="outline" size="sm" onclick={() => goto("/carousels")}>Back to list</Button>
    {/snippet}
  </PageHeader>

  {#if loading}
    <Card>
      <CardContent class="py-10 text-center text-sm text-muted-foreground">Loading carousel…</CardContent>
    </Card>
  {:else if loadError}
    <Card>
      <CardContent class="py-10 text-center space-y-3">
        <p class="text-sm text-destructive" role="alert">{loadError}</p>
        <Button variant="outline" size="sm" onclick={() => void load()}>Retry</Button>
      </CardContent>
    </Card>
  {:else if item}
    <div class="flex flex-wrap items-center gap-2">
      <Badge variant={approvalBadge(item.status)}>{statusLabel(item.status)}</Badge>
      <Badge variant="secondary">job: {job?.status ?? item.bodyJson.jobStatus}</Badge>
      <Badge variant="secondary">{item.bodyJson.designPreset}</Badge>
      <Badge variant="outline">{item.bodyJson.slideWidth ?? 1080}×{item.bodyJson.slideHeight ?? 1350}</Badge>
      <Badge variant="outline">{slides.length} slides</Badge>
    </div>

    {#if item.reviewNote}
      <p class="rounded-md border border-border p-3 text-sm">Reviewer: {item.reviewNote}</p>
    {/if}

    {#if job?.status === "running"}
      <p class="text-sm text-muted-foreground">
        Generation still running (step {job.step}). JSON slides appear as each file is written — PNGs are not claimed until export.
      </p>
    {/if}

    <Card>
      <CardHeader>
        <CardTitle>{viewingCover ? "Cover" : `Slide ${activeSlide + 1}`}</CardTitle>
        <CardDescription>
          Cover is first. Edit Cover only appears on the cover. Slides open the Konva editor.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <div class="flex flex-wrap items-center gap-2">
          {#if hasCover}
            <Button size="sm" variant={viewingCover ? "default" : "outline"} onclick={() => (viewIndex = 0)}>
              Cover
            </Button>
          {/if}
          {#each slides as _, i (i)}
            <Button
              size="sm"
              variant={!viewingCover && activeSlide === i ? "default" : "outline"}
              onclick={() => (viewIndex = viewIndexFromSlide(i, hasCover))}
            >
              {i + 1}
            </Button>
          {/each}
        </div>

        <div class="flex flex-wrap gap-2">
          {#if showEditCover}
            <Button size="sm" onclick={() => (coverEditOpen = true)}>Edit Cover</Button>
          {/if}
          {#if !viewingCover}
            <Button size="sm" onclick={() => goto(`/carousels/${id}/edit/${activeSlide + 1}`)}>
              Edit slide {activeSlide + 1}
            </Button>
            <Button size="sm" variant="outline" onclick={() => void handleRegenerate()}>Regenerate slide</Button>
          {/if}
          <Button size="sm" variant="outline" onclick={() => void handleExportPNG()} disabled={exporting}>PNG</Button>
          <Button size="sm" variant="outline" onclick={() => void handleExportZIP()} disabled={exporting}>ZIP</Button>
          <Button size="sm" variant="outline" onclick={() => void handleExportPDF()} disabled={exporting}>PDF</Button>
        </div>

        {#if actionError}
          <p class="text-sm text-destructive" role="alert">{actionError}</p>
        {/if}
        {#if actionSuccess}
          <p class="text-sm text-green-600" role="status">{actionSuccess}</p>
        {/if}

        <div class="flex justify-center overflow-auto rounded-lg border border-border bg-muted/30 p-4">
          {#if viewingCover}
            <img
              src="{carouselCoverUrl(item.id)}?v={coverVersion}"
              alt="Carousel cover"
              class="mx-auto max-h-[40rem] rounded-md object-contain"
              onerror={() => (coverFailed = true)}
            />
          {:else if slides[activeSlide]}
            <SlideCanvas
              bind:this={canvasRefs[activeSlide]}
              slide={slides[activeSlide]}
              readonly
              containerWidth={640}
              containerHeight={640}
            />
          {/if}
        </div>

        <div class="sr-only" aria-hidden="true">
          {#each slides as slide, i (i)}
            {#if viewingCover || i !== activeSlide}
              <SlideCanvas
                bind:this={canvasRefs[i]}
                {slide}
                readonly
                containerWidth={slide.width}
                containerHeight={slide.height}
              />
            {/if}
          {/each}
        </div>

        {#if showAddSlide}
          <Button
            type="button"
            variant="outline"
            class="w-full border-dashed"
            onclick={() => void handleAddBlankSlide()}
            disabled={addingSlide}
          >
            {addingSlide ? "Adding…" : "+ Add slide"}
          </Button>
        {/if}

        {#if totalViews > 1}
          <p class="text-center text-xs text-muted-foreground">
            {viewingCover ? "Cover" : `Slide ${activeSlide + 1}`} · {slides.length} slide(s)
          </p>
        {/if}
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Approval</CardTitle>
        <CardDescription>Review lives on this canvas, not a second workspace.</CardDescription>
      </CardHeader>
      <CardFooter class="flex flex-wrap gap-2">
        {#if item.status === "draft" || item.status === "changes_requested"}
          <Button size="sm" onclick={() => void handleSubmitReview()} disabled={approvalBusy}>
            {approvalBusy ? "Working…" : "Submit for review"}
          </Button>
        {/if}
        {#if item.status === "in_review"}
          <Button size="sm" variant="outline" onclick={() => (changesOpen = true)} disabled={approvalBusy}>
            Request changes
          </Button>
          <Button size="sm" onclick={() => void handleApprove()} disabled={approvalBusy}>
            {approvalBusy ? "Working…" : "Approve"}
          </Button>
        {/if}
      </CardFooter>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Revision history</CardTitle>
      </CardHeader>
      <CardContent class="space-y-2">
        {#if revisionsLoading}
          <p class="text-sm text-muted-foreground">Loading revisions…</p>
        {:else if revisions.length === 0}
          <p class="text-sm text-muted-foreground">No revisions yet.</p>
        {:else}
          {#each revisions as rev (rev.id)}
            <div class="rounded-md border border-border p-3">
              <div class="flex items-center justify-between gap-2">
                <p class="text-sm font-medium">Revision #{rev.revisionNumber}</p>
                <span class="text-xs text-muted-foreground">{timeLabel(rev.createdAt)}</span>
              </div>
              <p class="mt-0.5 text-xs text-muted-foreground">{rev.changeNote ?? "No note"}</p>
            </div>
          {/each}
        {/if}
      </CardContent>
    </Card>
  {/if}
</div>

<Dialog bind:open={coverEditOpen}>
  <DialogHeader>
    <DialogTitle>Edit Cover</DialogTitle>
    <DialogDescription>Describe the change. Kit rewrites cover.png from the current image.</DialogDescription>
  </DialogHeader>
  <div class="space-y-2">
    <Label for="cover-edit-description">What should change?</Label>
    <Textarea
      id="cover-edit-description"
      bind:value={coverEditDescription}
      placeholder="e.g. darker sky, larger title, remove the extra logo…"
      rows={4}
      maxlength={2000}
    />
  </div>
  <DialogFooter>
    <Button variant="outline" onclick={() => (coverEditOpen = false)} disabled={coverEditing}>Cancel</Button>
    <Button
      type="button"
      onclick={() => void submitCoverEdit()}
      disabled={coverEditing || !coverEditDescription.trim()}
    >
      {coverEditing ? "Regenerating…" : "Regenerate Cover"}
    </Button>
  </DialogFooter>
</Dialog>

<Dialog bind:open={changesOpen}>
  <DialogHeader>
    <DialogTitle>Request changes</DialogTitle>
    <DialogDescription>Explain what to revise. The editor can resubmit after changes.</DialogDescription>
  </DialogHeader>
  <div class="space-y-2">
    <Label for="changes-note">Reviewer note</Label>
    <Textarea id="changes-note" bind:value={changesNote} rows={4} />
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
