<script lang="ts">
import { Badge } from "@hiai/ui/components/ui/badge/index.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@hiai/ui/components/ui/card/index.js";
import type { CritiqueCheckItem, CritiqueResult } from "./types";

interface Props {
  critique: CritiqueResult;
  title?: string;
}

let { critique, title = "Script critique" }: Props = $props();
let expanded = $state<number | null>(null);

const checks = $derived.by((): CritiqueCheckItem[] => {
  if (Array.isArray(critique.checks) && critique.checks.length > 0) return critique.checks;
  return (critique.issues ?? []).map((issue, index) => ({
    id: issue.id ?? index + 1,
    category: issue.category ?? "issue",
    passed: false,
    score: issue.priority === "high" ? 40 : 60,
    feedback: issue.problem ?? "",
    suggestion: issue.suggestion ?? "",
  }));
});

const passedCount = $derived(checks.filter((check) => check.passed).length);
const passRate = $derived(checks.length > 0 ? Math.round((passedCount / checks.length) * 100) : 0);

function grade(score: number): string {
  if (score >= 95) return "S";
  if (score >= 90) return "A+";
  if (score >= 85) return "A";
  if (score >= 80) return "A-";
  if (score >= 75) return "B+";
  if (score >= 70) return "B";
  if (score >= 65) return "B-";
  if (score >= 60) return "C+";
  return "C";
}
</script>

<Card>
  <CardHeader>
    <div class="flex items-start gap-4">
      <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-border">
        <div class="text-center">
          <p class="text-lg font-bold leading-none">{grade(critique.overallScore)}</p>
          <p class="text-[10px] text-muted-foreground">{critique.overallScore}</p>
        </div>
      </div>
      <div class="min-w-0 flex-1">
        <CardTitle class="flex items-center gap-2">
          {title}
          <Badge variant="secondary">{passedCount}/{checks.length}</Badge>
        </CardTitle>
        <CardDescription>{critique.summary}</CardDescription>
      </div>
      <Badge variant="secondary">pass {passRate}%</Badge>
    </div>
  </CardHeader>
  <CardContent class="space-y-4">
    {#if (critique.prioritizedFixes?.length ?? 0) > 0}
      <div>
        <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
          Prioritized fixes
        </p>
        <ol class="ml-4 list-decimal space-y-1">
          {#each critique.prioritizedFixes ?? [] as fix}
            <li class="text-sm">{fix}</li>
          {/each}
        </ol>
      </div>
    {/if}

    <div class="divide-y divide-border rounded-md border border-border">
      {#each checks as check (check.id)}
        {@const open = expanded === check.id}
        <div>
          <button
            type="button"
            class="flex w-full items-center gap-3 px-3 py-2 text-left"
            onclick={() => (expanded = open ? null : check.id)}
          >
            <span class="text-sm {check.passed ? 'text-green-600' : 'text-destructive'}">
              {check.passed ? "✓" : "✕"}
            </span>
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{check.category}</span>
            <span class="text-xs tabular-nums text-muted-foreground">{check.score}</span>
          </button>
          {#if open}
            <div class="space-y-2 border-t border-border px-3 py-2">
              <p class="text-sm text-muted-foreground">{check.feedback}</p>
              {#if check.suggestion}
                <p class="rounded-md bg-muted p-2 text-sm">{check.suggestion}</p>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>

    {#if (critique.strengths?.length ?? 0) > 0 || (critique.weaknesses?.length ?? 0) > 0}
      <div class="grid gap-4 sm:grid-cols-2">
        {#if (critique.strengths?.length ?? 0) > 0}
          <div>
            <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-green-700 dark:text-green-400">
              Strengths
            </p>
            <ul class="space-y-1">
              {#each critique.strengths ?? [] as item}
                <li class="text-xs text-muted-foreground">+ {item}</li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if (critique.weaknesses?.length ?? 0) > 0}
          <div>
            <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-destructive">Areas to improve</p>
            <ul class="space-y-1">
              {#each critique.weaknesses ?? [] as item}
                <li class="text-xs text-muted-foreground">− {item}</li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    {/if}
  </CardContent>
</Card>
