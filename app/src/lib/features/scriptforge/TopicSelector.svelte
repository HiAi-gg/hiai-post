<script lang="ts">
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
import type { TopicIdea } from "./types";

interface Props {
  topics: TopicIdea[];
  disabled?: boolean;
  onSelect: (selected: TopicIdea[]) => void;
}

let { topics, disabled = false, onSelect }: Props = $props();

let selectedIds = $state<string[]>([]);
let selectedHooks = $state<Record<string, number>>({});

const sorted = $derived(
  [...topics].sort((a, b) => (b.viralPotential ?? 0) - (a.viralPotential ?? 0))
);

function toggle(id: string) {
  if (disabled) return;
  if (selectedIds.includes(id)) {
    selectedIds = selectedIds.filter((item) => item !== id);
  } else {
    selectedIds = [...selectedIds, id];
    if (selectedHooks[id] === undefined) selectedHooks = { ...selectedHooks, [id]: 0 };
  }
}

function submit() {
  if (disabled || selectedIds.length === 0) return;
  const selected = topics
    .filter((topic) => selectedIds.includes(topic.id))
    .map((topic) => ({
      ...topic,
      selectedHook: topic.hookVariants?.[selectedHooks[topic.id] ?? 0] ?? topic.hookVariants?.[0] ?? "",
    }));
  onSelect(selected);
}
</script>

<Card>
  <CardHeader>
    <CardTitle>Choose topics</CardTitle>
    <CardDescription>
      Pick one or more generated topics and a hook variant each, then continue the pipeline.
    </CardDescription>
  </CardHeader>
  <CardContent class="space-y-3">
    {#each sorted as topic (topic.id)}
      {@const selected = selectedIds.includes(topic.id)}
      <div class="rounded-md border border-border p-3">
        <label class="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={selected}
            onclick={() => toggle(topic.id)}
            disabled={disabled}
            class="mt-1 h-4 w-4 accent-primary"
          />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">{topic.title}</p>
            {#if topic.angle || topic.description}
              <p class="mt-0.5 text-xs text-muted-foreground">{topic.angle ?? topic.description}</p>
            {/if}
            <div class="mt-2 flex flex-wrap gap-1.5">
              {#if typeof topic.viralPotential === "number"}
                <Badge variant="secondary">viral {topic.viralPotential}</Badge>
              {/if}
              {#if topic.difficulty}
                <Badge variant="secondary">{topic.difficulty}</Badge>
              {/if}
              {#if topic.targetEmotion}
                <Badge variant="secondary">{topic.targetEmotion}</Badge>
              {/if}
            </div>
          </div>
        </label>
        {#if selected && (topic.hookVariants?.length ?? 0) > 0}
          <div class="mt-3 space-y-1.5">
            {#each topic.hookVariants ?? [] as hook, hookIndex (hookIndex)}
              <label class="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2">
                <input
                  type="radio"
                  name="hook-{topic.id}"
                  checked={(selectedHooks[topic.id] ?? 0) === hookIndex}
                  onclick={() => (selectedHooks = { ...selectedHooks, [topic.id]: hookIndex })}
                  class="mt-0.5 h-3.5 w-3.5 accent-primary"
                />
                <span class="text-xs text-muted-foreground">“{hook}”</span>
              </label>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </CardContent>
  <CardFooter>
    <Button type="button" onclick={submit} disabled={disabled || selectedIds.length === 0}>
      Continue with selection
    </Button>
  </CardFooter>
</Card>
