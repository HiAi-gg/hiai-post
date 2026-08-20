<script lang="ts">
import { onMount } from "svelte";
import { PageHeader } from "@hiai/ui";
import { Button } from "@hiai/ui/components/ui/button/index.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@hiai/ui/components/ui/card/index.js";
import { Input } from "@hiai/ui/components/ui/input/index.js";
import { Label } from "@hiai/ui/components/ui/label/index.js";
import {
  getEngagement,
  listTrends,
  type MarketingEngagement,
  type MarketingPipelineResult,
  type MarketingTrend,
  runPipeline,
} from "$lib/features/marketing/api";

let topic = $state("");
let chatId = $state("");
let preview = $state<MarketingPipelineResult | null>(null);
let running = $state(false);
let publishing = $state(false);
let error = $state<string | null>(null);

let trends = $state<MarketingTrend[]>([]);
let engagement = $state<MarketingEngagement | null>(null);
let listsLoading = $state(true);

const voiceScoreLabel = $derived(
  preview ? `Brand-voice score: ${preview.voiceScore.toFixed(2)}` : "No preview yet",
);

async function refreshLists(): Promise<void> {
  listsLoading = true;
  try {
    const [t, e] = await Promise.all([listTrends(20), getEngagement(5)]);
    trends = t;
    engagement = e;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    listsLoading = false;
  }
}

async function runPreview(): Promise<void> {
  if (!chatId.trim()) {
    error = "Chat id is required (used for idempotency even in preview).";
    return;
  }
  running = true;
  error = null;
  try {
    preview = await runPipeline({
      topic: topic.trim() || undefined,
      chatId: Number.isFinite(Number(chatId)) ? Number(chatId) : chatId.trim(),
      skipPublish: true,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    running = false;
  }
}

async function publishPreview(): Promise<void> {
  if (!preview || !chatId.trim()) return;
  publishing = true;
  error = null;
  try {
    preview = await runPipeline({
      topic: preview.topic,
      chatId: Number.isFinite(Number(chatId)) ? Number(chatId) : chatId.trim(),
      skipPublish: false,
    });
    await refreshLists();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    publishing = false;
  }
}

onMount(() => {
  void refreshLists();
});
</script>

<svelte:head>
  <title>Marketing pipeline — HiAi Post</title>
</svelte:head>

<PageHeader title="Marketing pipeline" description="Preview, score, then publish through hiai-kit." />

<div class="mt-6 grid gap-6 lg:grid-cols-2">
  <Card>
    <CardHeader>
      <CardTitle>Run pipeline</CardTitle>
      <CardDescription>Topic optional — kit falls back to the latest trend.</CardDescription>
    </CardHeader>
    <CardContent class="space-y-4">
      <div class="space-y-2">
        <Label for="topic">Topic</Label>
        <Input id="topic" bind:value={topic} placeholder="AI tooling trends" />
      </div>
      <div class="space-y-2">
        <Label for="chatId">Telegram chat id</Label>
        <Input id="chatId" bind:value={chatId} placeholder="123456789" />
      </div>
      <div class="flex flex-wrap gap-2">
        <Button onclick={runPreview} disabled={running || publishing}>
          {running ? "Previewing…" : "Preview (skip publish)"}
        </Button>
        <Button
          variant="secondary"
          onclick={publishPreview}
          disabled={!preview || publishing || running || !preview.complianceOk}
        >
          {publishing ? "Publishing…" : "Publish"}
        </Button>
      </div>
      {#if error}
        <p class="text-sm text-destructive">{error}</p>
      {/if}
    </CardContent>
  </Card>

  <Card>
    <CardHeader>
      <CardTitle>Preview</CardTitle>
      <CardDescription>{voiceScoreLabel}</CardDescription>
    </CardHeader>
    <CardContent class="space-y-3">
      {#if preview}
        {#if !preview.complianceOk}
          <p class="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            Blocked: {preview.blockedReason ?? "compliance-fail"}
          </p>
        {:else if preview.published}
          <p class="text-sm text-muted-foreground">Published messageId={preview.messageId}</p>
        {:else}
          <p class="text-sm text-muted-foreground">
            Preview ready. {preview.charsUsed} chars. Duplicate={String(preview.duplicate)}.
          </p>
        {/if}
        <p class="whitespace-pre-wrap text-sm leading-relaxed">{preview.finalText}</p>
      {:else}
        <p class="text-sm text-muted-foreground">Run a preview to see the draft here.</p>
      {/if}
    </CardContent>
  </Card>
</div>

<div class="mt-6 grid gap-6 lg:grid-cols-2">
  <Card>
    <CardHeader>
      <CardTitle>Trends cache</CardTitle>
      <CardDescription>Latest rows from kit trends_cache.</CardDescription>
    </CardHeader>
    <CardContent>
      {#if listsLoading}
        <p class="text-sm text-muted-foreground">Loading…</p>
      {:else if trends.length === 0}
        <p class="text-sm text-muted-foreground">No trends yet.</p>
      {:else}
        <ul class="space-y-2 text-sm">
          {#each trends as row (row.id)}
            <li>
              <span class="font-medium">{row.topic}</span>
              <span class="text-muted-foreground"> — {row.source}{row.score ? ` (${row.score})` : ""}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </CardContent>
  </Card>

  <Card>
    <CardHeader>
      <CardTitle>Engagement top-N</CardTitle>
      <CardDescription>Most-engaged published messages.</CardDescription>
    </CardHeader>
    <CardContent>
      {#if listsLoading}
        <p class="text-sm text-muted-foreground">Loading…</p>
      {:else if !engagement || engagement.top.length === 0}
        <p class="text-sm text-muted-foreground">No engagement rows yet.</p>
      {:else}
        <ul class="space-y-2 text-sm">
          {#each engagement.top as item (item.idempotencyKey)}
            <li>
              {item.idempotencyKey}
              <span class="text-muted-foreground">
                — replies {item.replyCount}, views {item.viewCount}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </CardContent>
  </Card>
</div>
