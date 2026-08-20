<script lang="ts">
import { onMount, onDestroy } from "svelte";
import Konva from "konva";
import type { SlideDocument, SlideElement } from "$lib/canvas/types";
import {
	renderBackground,
	renderElement,
	preloadImages,
} from "$lib/canvas/renderer";

interface Props {
	slide: SlideDocument;
	selectedId?: string | null;
	readonly?: boolean;
	containerWidth?: number;
	containerHeight?: number;
	onMutate?: () => void;
	onTextEdit?: (id: string) => void;
}

let {
	slide = $bindable(),
	selectedId = $bindable(null),
	readonly = false,
	containerWidth = 800,
	containerHeight = 800,
	onMutate,
	onTextEdit,
}: Props = $props();

let container = $state<HTMLDivElement | undefined>(undefined);
let stage: Konva.Stage;
let layer: Konva.Layer;
let transformer: Konva.Transformer;
let bgRect: Konva.Shape | Konva.Group;

const scale = $derived(
	Math.min(containerWidth / slide.width, containerHeight / slide.height, 1),
);

export function getStage(): Konva.Stage {
	return stage;
}

function setupStage() {
	if (stage) stage.destroy();

	stage = new Konva.Stage({
		container,
		width: slide.width,
		height: slide.height,
	});

	if (container) {
		(container as any).__konvaStage = stage;
		if (container.parentElement) {
			(container.parentElement as any).__konvaStage = stage;
		}
	}

	layer = new Konva.Layer();
	stage.add(layer);

	bgRect = renderBackground(slide.background, slide.width, slide.height);
	bgRect.name("__background");
	layer.add(bgRect);

	renderElements();

	if (!readonly) {
		transformer = new Konva.Transformer({
			keepRatio: true,
			enabledAnchors: ["top-left", "top-right", "bottom-left", "bottom-right"],
			rotateEnabled: true,
			borderStroke: "#667eea",
			borderStrokeWidth: 2,
			anchorStroke: "#667eea",
			anchorFill: "#FFFFFF",
			anchorSize: 10,
			anchorCornerRadius: 2,
			boundBoxFunc: (_oldBox, newBox) => {
				if (newBox.width < 10 || newBox.height < 10) return _oldBox;
				return newBox;
			},
		});
		layer.add(transformer);
		setupInteraction();
	}

	layer.draw();
	applyScale();
}

function renderElements() {
	const toRemove = layer.getChildren(
		(node: Konva.Node) =>
			node.name() !== "__background" && !(node instanceof Konva.Transformer),
	);
	for (const node of toRemove) node.destroy();

	for (const el of slide.elements) {
		const node = renderElement(el, readonly);
		if (!node) continue;
		layer.add(node as Konva.Shape);
	}

	if (!readonly) attachNodeHandlers();

	if (transformer) transformer.moveToTop();
	layer.draw();
}

function attachNodeHandlers() {
	for (const node of layer.getChildren()) {
		if (node.name() === "__background" || node instanceof Konva.Transformer)
			continue;
		if (!node.hasChildren?.() || node instanceof Konva.Shape) {
			node.off("dragstart.transform");
			node.off("dragend.transform");
			node.off("transformstart.transform");
			node.off("transformend.transform");

			// Push history BEFORE mutation so undo captures pre-mutation state
			(node as Konva.Shape).on("dragstart.transform", () => {
				onMutate?.();
			});
			(node as Konva.Shape).on("transformstart.transform", () => {
				onMutate?.();
			});

			(node as Konva.Shape).on("dragend.transform", () => {
				const id = node.id();
				const idx = slide.elements.findIndex(
					(el: SlideElement) => el.id === id,
				);
				if (idx === -1) return;
				slide.elements[idx] = {
					...slide.elements[idx],
					x: Math.round(node.x()),
					y: Math.round(node.y()),
				} as SlideElement;
			});

			(node as Konva.Shape).on("transformend.transform", () => {
				const id = node.id();
				const idx = slide.elements.findIndex(
					(el: SlideElement) => el.id === id,
				);
				if (idx === -1) return;
				const el = slide.elements[idx];
				const sx = node.scaleX();
				const sy = node.scaleY();
				node.scaleX(1);
				node.scaleY(1);

				const updated: Record<string, unknown> = {
					...el,
					x: Math.round(node.x()),
					y: Math.round(node.y()),
					rotation: Math.round(node.rotation()),
				};

				if (el.type === "text" || el.type === "rect" || el.type === "image") {
					updated.width = Math.round((el as any).width * sx);
					updated.height = Math.round((el as any).height * sy);
				} else if (el.type === "circle") {
					updated.radius = Math.round(el.radius * sx);
				}

				slide.elements[idx] = updated as unknown as SlideElement;
			});
		}
	}
}

function setupInteraction() {
	if (!stage) return;
	stage.on("click tap", (e: Konva.KonvaEventObject<MouseEvent>) => {
		if (e.target === stage || e.target.name() === "__background") {
			selectedId = null;
			return;
		}
		const node = e.target;
		selectedId = node.id() || null;
	});
	stage.on("dblclick dbltap", (e: Konva.KonvaEventObject<MouseEvent>) => {
		const id = e.target.id();
		if (!id) return;
		const el = slide.elements.find((item) => item.id === id);
		if (el?.type === "text") onTextEdit?.(id);
	});
}

function applyScale() {
	if (!stage) return;
	stage.scale({ x: scale, y: scale });
	stage.size({
		width: Math.round(slide.width * scale),
		height: Math.round(slide.height * scale),
	});
}

$effect(() => {
	if (!stage || !layer || readonly) return;
	const id = selectedId;

	if (!id) {
		transformer.nodes([]);
		layer.draw();
		return;
	}

	const node = layer.findOne(`#${id}`);
	if (node) {
		transformer.nodes([node as Konva.Shape]);
		transformer.moveToTop();
		layer.draw();
	}
});

let lastSlideJson = "";

$effect(() => {
	const json = JSON.stringify(slide);
	if (json === lastSlideJson) return;
	lastSlideJson = json;

	if (stage) {
		renderElements();
		bgRect.destroy();
		bgRect = renderBackground(slide.background, slide.width, slide.height);
		bgRect.name("__background");
		layer.add(bgRect);
		bgRect.moveToBottom();
		if (transformer) transformer.moveToTop();
		layer.draw();
	}
});

$effect(() => {
	const _s = scale;
	if (stage) applyScale();
});

function handleKeydown(e: KeyboardEvent) {
	if (readonly || !selectedId) return;

	const tag = (e.target as HTMLElement)?.tagName;
	if (
		tag === "INPUT" ||
		tag === "TEXTAREA" ||
		(e.target as HTMLElement)?.isContentEditable
	)
		return;

	const idx = slide.elements.findIndex(
		(el: SlideElement) => el.id === selectedId,
	);
	if (idx === -1) return;

	if (e.key === "Delete" || e.key === "Backspace") {
		e.preventDefault();
		// Capture state before mutation for undo
		onMutate?.();
		slide.elements.splice(idx, 1);
		selectedId = null;
		renderElements();
		return;
	}

	const step = e.shiftKey ? 10 : 1;
	const el = slide.elements[idx];

	if (e.key === "ArrowLeft") {
		e.preventDefault();
		onMutate?.();
		slide.elements[idx] = { ...el, x: el.x - step } as SlideElement;
	} else if (e.key === "ArrowRight") {
		e.preventDefault();
		onMutate?.();
		slide.elements[idx] = { ...el, x: el.x + step } as SlideElement;
	} else if (e.key === "ArrowUp") {
		e.preventDefault();
		onMutate?.();
		slide.elements[idx] = { ...el, y: el.y - step } as SlideElement;
	} else if (e.key === "ArrowDown") {
		e.preventDefault();
		onMutate?.();
		slide.elements[idx] = { ...el, y: el.y + step } as SlideElement;
	}
}

onMount(() => {
	preloadImages(slide.elements).then(() => setupStage());
	window.addEventListener("keydown", handleKeydown);
});

onDestroy(() => {
	window.removeEventListener("keydown", handleKeydown);
	if (container) {
		(container as any).__konvaStage = undefined;
		if (container.parentElement) {
			(container.parentElement as any).__konvaStage = undefined;
		}
	}
	if (stage) stage.destroy();
});
</script>

<div
  bind:this={container}
  class="slide-canvas"
  style="width: {Math.round(slide.width * scale)}px; height: {Math.round(slide.height * scale)}px;"
  role="application"
  aria-label="Slide canvas"
  tabindex="0"
></div>

<style>
  .slide-canvas {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    outline: none;
  }
</style>
