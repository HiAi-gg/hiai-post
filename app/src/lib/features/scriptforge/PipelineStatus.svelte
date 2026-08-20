<script lang="ts">
import { Badge } from "@hiai/ui/components/ui/badge/index.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@hiai/ui/components/ui/card/index.js";
import type { PipelineStage } from "./types";

interface Props {
  stages: PipelineStage[];
  currentStage: string | null;
  progress: Record<string, number>;
  messages: Record<string, string>;
  running?: boolean;
}

let { stages, currentStage, progress, messages, running = false }: Props = $props();

function statusOf(stage: PipelineStage): PipelineStage["status"] {
  if (stage.status === "error" || stage.status === "completed" || stage.status === "active") {
    return stage.status;
  }
  if (!currentStage) return "pending";
  const idx = stages.findIndex((item) => item.id === stage.id);
  const cur = stages.findIndex((item) => item.id === currentStage);
  if (idx < cur) return "completed";
  if (idx === cur) return "active";
  return "pending";
}
</script>

<Card>
  <CardHeader>
    <CardTitle>Pipeline stages</CardTitle>
    <CardDescription>
      {#if running}
        Streaming events live from the hiai-kit backend…
      {:else if stages.every((stage) => stage.status === "pending")}
        No pipeline has been run yet.
      {:else}
        {stages.filter((stage) => stage.status !== "pending").length} stage(s) recorded.
      {/if}
    </CardDescription>
  </CardHeader>
  <CardContent>
    <ol class="space-y-2">
      {#each stages as stage (stage.id)}
        {@const status = statusOf(stage)}
        {@const prog = progress[stage.id] ?? stage.progress}
        <li class="flex items-center gap-3 rounded-md border border-border p-3">
          <span class="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
            {#if status === "active"}
              <span class="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></span>
            {:else if status === "completed"}
              <span class="text-sm font-bold text-green-600">✓</span>
            {:else if status === "error"}
              <span class="text-sm font-bold text-destructive">✕</span>
            {:else}
              <span class="h-2 w-2 rounded-full bg-muted-foreground/40"></span>
            {/if}
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{stage.label}</p>
            {#if status !== "pending" && (messages[stage.id] || stage.message)}
              <p class="truncate text-xs text-muted-foreground">{messages[stage.id] ?? stage.message}</p>
            {/if}
            {#if status !== "pending"}
              <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  class="h-full rounded-full {status === 'completed' ? 'bg-green-600' : 'bg-primary'}"
                  style="width: {Math.min(100, Math.max(0, prog))}%"
                ></div>
              </div>
            {/if}
          </div>
          {#if status === "active"}
            <Badge variant="secondary">{Math.round(prog)}%</Badge>
          {:else}
            <Badge variant={status === "error" ? "destructive" : "secondary"}>{status}</Badge>
          {/if}
        </li>
      {/each}
    </ol>
  </CardContent>
</Card>
