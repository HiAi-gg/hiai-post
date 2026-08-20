<script lang="ts">
import type { SlideDocument } from "$lib/canvas/types";
import type { SlideHistory } from "$lib/canvas/history";
import {
	createTextElement,
	createArrowElement,
	createIconElement,
	createLineElement,
} from "$lib/canvas/defaults";
import type Konva from "konva";
import { nanoid } from "nanoid";

interface Props {
	slide: SlideDocument;
	selectedId: string | null;
	history: SlideHistory;
	stage: Konva.Stage | null;
	onExportPNG: () => void;
	onExportPDF: () => void;
	onExportZIP?: () => void;
	onRevert?: () => void;
}

let {
	slide = $bindable(),
	selectedId = $bindable(null),
	history,
	stage,
	onExportPNG,
	onExportPDF,
	onExportZIP,
	onRevert,
}: Props = $props();

const COMMON_ICONS = [
	{ name: "Star", icon: "star" },
	{ name: "Heart", icon: "heart" },
	{ name: "Check", icon: "check" },
	{ name: "Arrow Right", icon: "arrow-right" },
	{ name: "Plus", icon: "plus" },
	{ name: "Zap", icon: "zap" },
	{ name: "Target", icon: "target" },
	{ name: "Globe", icon: "globe" },
	{ name: "Mail", icon: "mail" },
	{ name: "Download", icon: "download" },
];

let undoVersion = $state(0);
let redoVersion = $state(0);

function forceUpdate() {
	undoVersion++;
	redoVersion++;
	// biome-ignore lint/correctness/noSelfAssign: Svelte 5 trigger reactivity
	slide = slide;
}

function addText() {
	slide.elements.push(
		createTextElement({
			x: 100,
			y: 100,
			width: 400,
			height: 80,
			text: "Double-click to edit",
			fontSize: 32,
			fill:
				slide.background.type === "solid" &&
				slide.background.color === "#0D0D0D"
					? "#FFFFFF"
					: "#1A1A1A",
		}),
	);
	pushHistory();
}

function addRect() {
	slide.elements.push({
		id: nanoid(),
		type: "rect",
		x: 200,
		y: 200,
		width: 200,
		height: 200,
		rotation: 0,
		opacity: 1,
		locked: false,
		visible: true,
		fill: "#667eea",
		cornerRadius: 0,
	});
	pushHistory();
}

function addCircle() {
	slide.elements.push({
		id: nanoid(),
		type: "circle",
		x: 300,
		y: 300,
		rotation: 0,
		opacity: 1,
		locked: false,
		visible: true,
		radius: 80,
		fill: "#FF3366",
	});
	pushHistory();
}

function addImage() {
	const input = document.createElement("input");
	input.type = "file";
	input.accept = "image/*";
	input.onchange = () => {
		const file = input.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			slide.elements.push({
				id: nanoid(),
				type: "image",
				x: 100,
				y: 100,
				width: 300,
				height: 300,
				rotation: 0,
				opacity: 1,
				locked: false,
				visible: true,
				src: reader.result as string,
				cornerRadius: 0,
			});
			pushHistory();
		};
		reader.readAsDataURL(file);
	};
	input.click();
}

function addArrow() {
	slide.elements.push(
		createArrowElement({
			x: 100,
			y: 400,
			points: [0, 0, 200, 0],
			stroke:
				slide.background.type === "solid" &&
				slide.background.color === "#0D0D0D"
					? "#FF3366"
					: "#1A1A1A",
			strokeWidth: 4,
			pointerLength: 15,
			pointerWidth: 15,
		}),
	);
	pushHistory();
}

function addIcon(iconName: string) {
	slide.elements.push(
		createIconElement({
			src: `https://unpkg.com/lucide-static@0.460.0/icons/${iconName}.svg`,
			x: Math.round(slide.width / 2 - 32),
			y: Math.round(slide.height / 2 - 32),
			width: 64,
			height: 64,
			fill: "#ffffff",
		}),
	);
	pushHistory();
}

function addLine() {
	slide.elements.push(
		createLineElement({
			x: 100,
			y: 300,
			points: [0, 0, 200, 0],
			stroke:
				slide.background.type === "solid" &&
				slide.background.color === "#0D0D0D"
					? "#00E5FF"
					: "#1A1A1A",
			strokeWidth: 4,
		}),
	);
	pushHistory();
}

function deleteSelected() {
	if (!selectedId) return;
	const idx = slide.elements.findIndex((e) => e.id === selectedId);
	if (idx === -1) return;
	slide.elements.splice(idx, 1);
	selectedId = null;
	pushHistory();
}

function undo() {
	const state = history.undo();
	if (state) {
		slide.elements = state.elements;
		slide.background = state.background;
		forceUpdate();
	}
}

function redo() {
	const state = history.redo();
	if (state) {
		slide.elements = state.elements;
		slide.background = state.background;
		forceUpdate();
	}
}

function pushHistory() {
	history.push({ ...slide, elements: [...slide.elements] });
	forceUpdate();
}
</script>

<div class="flex items-center gap-1 px-3 py-2 bg-zinc-900 border-b border-zinc-700 flex-wrap">
  <!-- Add elements -->
  <div class="flex items-center gap-1 mr-3">
    <span class="text-[10px] uppercase text-zinc-500 tracking-wider mr-1">Add</span>
    <button type="button" onclick={addText} class="px-2 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 cursor-pointer border-none" title="Add Text">Text</button>
    <button onclick={addImage} class="px-2 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 cursor-pointer border-none" title="Add Image">Image</button>
    
    <!-- Shape Dropdown -->
    <select 
      class="px-2 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 cursor-pointer border-none focus:outline-none"
      onchange={(e) => {
        const val = e.currentTarget.value;
        if (val === 'rect') addRect();
        else if (val === 'circle') addCircle();
        else if (val === 'line') addLine();
        else if (val === 'arrow') addArrow();
        e.currentTarget.value = ''; // reset selection
      }}
    >
      <option value="" disabled selected>+ Shape...</option>
      <option value="rect">■ Rectangle</option>
      <option value="circle">● Circle</option>
      <option value="line">─ Line</option>
      <option value="arrow">➜ Arrow</option>
    </select>
    <select
      class="px-2 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 cursor-pointer border-none focus:outline-none max-w-[120px]"
      onchange={(e) => {
        const val = e.currentTarget.value;
        if (val) addIcon(val);
        e.currentTarget.value = "";
      }}
    >
      <option value="" disabled selected>+ Icon...</option>
      {#each COMMON_ICONS as icon (icon.icon)}
        <option value={icon.icon}>{icon.name}</option>
      {/each}
    </select>
  </div>

  <!-- Separator -->
  <div class="w-px h-5 bg-zinc-700 mr-3"></div>

  <!-- Undo/Redo -->
  <div class="flex items-center gap-1 mr-3">
    <button
      onclick={undo}
      disabled={!history.canUndo}
      class="px-2 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 cursor-pointer border-none disabled:opacity-30 disabled:cursor-not-allowed"
      title="Undo (Ctrl+Z)"
    >&#x21A9;</button>
    <button
      onclick={redo}
      disabled={!history.canRedo}
      class="px-2 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 cursor-pointer border-none disabled:opacity-30 disabled:cursor-not-allowed"
      title="Redo (Ctrl+Y)"
    >&#x21AA;</button>
  </div>

  <!-- Delete -->
  <button
    onclick={deleteSelected}
    disabled={!selectedId}
    class="px-2 py-1 text-xs rounded bg-red-900/50 hover:bg-red-800/60 text-red-300 cursor-pointer border-none disabled:opacity-30 disabled:cursor-not-allowed mr-3"
    title="Delete selected (Del)"
  >Delete</button>

  <!-- Spacer -->
  <div class="flex-1"></div>

  <!-- Export -->
  <div class="flex items-center gap-1">
    <span class="text-[10px] uppercase text-zinc-500 tracking-wider mr-1">Export</span>
    <button onclick={onExportPNG} class="px-2 py-1 text-xs rounded bg-violet-700 hover:bg-violet-600 text-white cursor-pointer border-none">PNG</button>
    <button onclick={onExportPDF} class="px-2 py-1 text-xs rounded bg-violet-700 hover:bg-violet-600 text-white cursor-pointer border-none">PDF</button>
    {#if onExportZIP}
      <button onclick={onExportZIP} class="px-2 py-1 text-xs rounded bg-violet-700 hover:bg-violet-600 text-white cursor-pointer border-none">ZIP</button>
    {/if}
    {#if onRevert}
      <button type="button" onclick={onRevert} class="px-2 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 cursor-pointer border-none">Revert</button>
    {/if}
  </div>
</div>
