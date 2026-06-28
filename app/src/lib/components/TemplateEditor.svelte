<script lang="ts">
interface TemplateData {
  name: string;
  platform: string;
  contentText: string;
  aiPrompt: string;
  variables?: Array<{ name: string; type: string; defaultValue: string }>;
}

let {
  template = $bindable({
    name: "",
    platform: "instagram",
    contentText: "",
    aiPrompt: "",
    variables: [],
  }),
} = $props();

const _PLATFORMS = ["instagram", "tiktok", "x", "linkedin", "facebook", "telegram", "multi"];
const _platformIcons: Record<string, string> = {
  instagram: "📸",
  tiktok: "🎵",
  x: "𝕏",
  linkedin: "💼",
  facebook: "📘",
  telegram: "✈️",
  multi: "🌐",
};

let _showVariables = $state(false);
let newVarName = $state("");
let newVarType = $state("text");

const _detectedVariables = $derived.by(() => {
  const matches = template.contentText.match(/\{\{(\w+)\}\}/g) || [];
  return [...new Set(matches.map((m: string) => m.replace(/[{}]/g, "")))];
});

const _previewContent = $derived.by(() => {
  let result = template.contentText;
  for (const v of template.variables || []) {
    result = result.replaceAll(`{{${v.name}}}`, v.defaultValue || `[${v.name}]`);
  }
  return result;
});

function _addVariable() {
  if (!newVarName) return;
  const vars = template.variables || [];
  if (!vars.find((v: any) => v.name === newVarName)) {
    template.variables = [...vars, { name: newVarName, type: newVarType, defaultValue: "" }];
  }
  newVarName = "";
}

function _removeVariable(name: string) {
  template.variables = (template.variables || []).filter((v: any) => v.name !== name);
}
</script>

<div class="space-y-4">
  <div>
    <label for="tpl-name" class="block text-sm font-medium mb-1">Template Name</label>
    <input id="tpl-name" bind:value={template.name} class="w-full px-3 py-2 border border-border rounded-md text-sm bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors" placeholder="e.g., Product Announcement" />
  </div>

  <div>
    <label for="tpl-platform" class="block text-sm font-medium mb-1">Platform</label>
    <div class="flex flex-wrap gap-2">
      {#each PLATFORMS as p}
        <button
          onclick={() => template.platform = p}
          class="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
          class:bg-primary={template.platform === p}
          class:text-primary-foreground={template.platform === p}
          class:border-border={template.platform !== p}
          class:hover:border-muted-foreground={template.platform !== p}
        >
          <span>{platformIcons[p]}</span>
          <span class="capitalize">{p}</span>
        </button>
      {/each}
    </div>
  </div>

  <div>
    <label for="tpl-content" class="block text-sm font-medium mb-1">
      Content Template
      <span class="text-muted-foreground font-normal ml-1">— use {`{{variable}}`} for dynamic values</span>
    </label>
    <textarea id="tpl-content" bind:value={template.contentText} rows={8} class="w-full px-3 py-2 border border-border rounded-md text-sm bg-background font-mono resize-y focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors" placeholder="Hey {{customer_name}}! Check out our new {{product_name}} at {{price}}..."></textarea>
    {#if detectedVariables.length > 0}
      <div class="flex flex-wrap gap-1 mt-1">
        {#each detectedVariables as v}
          <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{`{{${v}}}`}</span>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Variables Section -->
  <div>
    <button onclick={() => showVariables = !showVariables} class="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
      <span class="transition-transform" class:rotate-90={showVariables}>▶</span>
      Variables ({(template.variables || []).length})
    </button>
    {#if showVariables}
      <div class="mt-2 space-y-2 border border-border rounded-lg p-3">
        {#each (template.variables || []) as v}
          <div class="flex items-center gap-2">
            <span class="text-xs font-mono bg-muted px-2 py-1 rounded">{`{{${v.name}}}`}</span>
            <select bind:value={v.type} class="px-2 py-1 border border-border rounded text-xs bg-background">
              <option value="text">text</option>
              <option value="number">number</option>
              <option value="date">date</option>
              <option value="url">url</option>
            </select>
            <input bind:value={v.defaultValue} placeholder="default value" class="flex-1 px-2 py-1 border border-border rounded text-xs bg-background" />
            <button onclick={() => removeVariable(v.name)} class="text-destructive hover:text-destructive/80 text-xs">✕</button>
          </div>
        {/each}
        <div class="flex gap-2">
          <input bind:value={newVarName} placeholder="variable_name" class="flex-1 px-2 py-1 border border-border rounded text-xs bg-background" />
          <select bind:value={newVarType} class="px-2 py-1 border border-border rounded text-xs bg-background">
            <option value="text">text</option>
            <option value="number">number</option>
            <option value="date">date</option>
            <option value="url">url</option>
          </select>
          <button onclick={addVariable} class="px-2 py-1 bg-primary text-primary-foreground rounded text-xs">+ Add</button>
        </div>
      </div>
    {/if}
  </div>

  <div>
    <label for="tpl-prompt" class="block text-sm font-medium mb-1">AI Prompt</label>
    <textarea id="tpl-prompt" bind:value={template.aiPrompt} rows={4} class="w-full px-3 py-2 border border-border rounded-md text-sm bg-background resize-y focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors" placeholder="Instructions for AI when generating from this template..."></textarea>
  </div>

  <!-- Preview -->
  {#if previewContent}
    <div>
      <p class="text-sm font-medium mb-1">Preview</p>
      <div class="border border-border rounded-lg p-3 bg-muted/30">
        <p class="text-sm whitespace-pre-wrap">{previewContent}</p>
      </div>
    </div>
  {/if}
</div>
