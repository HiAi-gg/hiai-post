<script lang="ts">
import { goto } from "$app/navigation";
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
import { SLIDE_SIZES } from "$lib/canvas/sizes";
import {
  CAROUSEL_PRESETS,
  CarouselApiError,
  type CarouselDesignPreset,
  type CarouselItem,
  type CarouselSlideData,
  createCarousel,
  listCarousels,
  MAX_CAROUSEL_SLIDES,
} from "$lib/features/carousels/api";

let carouselTitle = $state("");
let slides = $state<CarouselSlideData[]>([
  { title: "", content: "" },
  { title: "", content: "" },
]);
let designPreset = $state<string>("minimal");
let slideSize = $state<string>("4:5");
let handle = $state("");
let ctaText = $state("");
let styleDescription = $state("");
let creating = $state(false);
let createError = $state<string | null>(null);

let items = $state<CarouselItem[]>([]);
let itemsLoading = $state(true);
let itemsError = $state<string | null>(null);

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

async function handleCreate() {
  if (creating || !canSubmit) return;
  createError = null;
  creating = true;
  try {
    const size = SLIDE_SIZES.find((s) => s.id === slideSize) ?? SLIDE_SIZES[1];
    const res = await createCarousel({
      carouselTitle: carouselTitle.trim(),
      slides: slides
        .map((s) => ({ title: s.title.trim(), content: s.content.trim() }))
        .filter((s) => s.title || s.content),
      designPreset: designPreset as CarouselDesignPreset,
      slideWidth: size.width,
      slideHeight: size.height,
      handle: handle.trim() || undefined,
      ctaText: ctaText.trim() || undefined,
      styleDescription: styleDescription.trim() || undefined,
    });
    await goto(`/carousels/${res.item.id}`);
  } catch (err) {
    createError = errorText(err);
  } finally {
    creating = false;
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
    description="Generate a deck, then open the canvas to edit slides, cover, and export."
  />

  <div class="grid gap-6 lg:grid-cols-5">
    <Card class="lg:col-span-2 self-start">
      <CardHeader>
        <CardTitle>New carousel</CardTitle>
        <CardDescription>
          Title, slides and preset go to the kit job. After generation you edit on the canvas — not a second workspace.
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
          <Label for="slide-size">Canvas size</Label>
          <SelectRoot type="single" bind:value={slideSize}>
            <SelectTrigger id="slide-size" class="w-full">
              <SelectValue placeholder="Choose a size" />
            </SelectTrigger>
            <SelectContent>
              {#each SLIDE_SIZES as size (size.id)}
                <SelectItem value={size.id}>{size.label} ({size.width}×{size.height})</SelectItem>
              {/each}
            </SelectContent>
          </SelectRoot>
        </div>

        <div class="space-y-2">
          <Label for="design-preset">Design preset (Minimal / Bold / Gradient first)</Label>
          <SelectRoot type="single" bind:value={designPreset}>
            <SelectTrigger id="design-preset" class="w-full">
              <SelectValue placeholder="Choose a preset" />
            </SelectTrigger>
            <SelectContent>
              {#each CAROUSEL_PRESETS as preset (preset)}
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

    <div class="lg:col-span-3 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Carousels</CardTitle>
          <CardDescription>Open a deck to edit the canvas, cover, and export.</CardDescription>
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
                  <Button variant="outline" size="sm" onclick={() => void goto(`/carousels/${c.id}`)}>
                    Open canvas
                  </Button>
                </div>
              </div>
            {/each}
          {/if}
        </CardContent>
      </Card>
    </div>
  </div>
</div>
