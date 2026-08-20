<script lang="ts">
import { onMount } from "svelte";
import type { TextElement } from "$lib/canvas/types";

interface Props {
	element: TextElement | null;
	onSave: (text: string) => void;
	onCancel: () => void;
	scale?: number;
}

const { element, onSave, onCancel, scale = 1 }: Props = $props();

let editorEl = $state<HTMLDivElement | undefined>(undefined);

onMount(() => {
	if (editorEl) {
		editorEl.focus();
		// Select all text
		const range = document.createRange();
		range.selectNodeContents(editorEl);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
	}
});

function handleKeydown(e: KeyboardEvent) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		onSave(editorEl?.innerText ?? "");
	} else if (e.key === "Escape") {
		e.preventDefault();
		onCancel();
	}
}

function handleBlur() {
	onSave(editorEl?.innerText ?? "");
}
</script>

{#if element}
  <div
    bind:this={editorEl}
    contenteditable="true"
    class="inline-text-editor"
    style="
      position: absolute;
      left: {element.x * scale}px;
      top: {element.y * scale}px;
      width: {element.width * scale}px;
      min-height: {element.height * scale}px;
      font-size: {element.fontSize * scale}px;
      font-family: {element.fontFamily};
      font-weight: {element.fontWeight};
      font-style: {element.fontStyle};
      text-decoration: {element.textDecoration};
      color: {element.fill};
      text-align: {element.align};
      line-height: {element.lineHeight};
      letter-spacing: {element.letterSpacing}px;
      padding: {element.padding * scale}px;
      white-space: pre-wrap;
      word-break: break-word;
      transform: rotate({element.rotation}deg);
      opacity: {element.opacity};
    "
    onkeydown={handleKeydown}
    onblur={handleBlur}
    role="textbox"
    aria-label="Edit text"
    tabindex="0"
  >{element.text}</div>
{/if}

<style>
  .inline-text-editor {
    outline: none;
    border: 2px dashed #667eea;
    border-radius: 4px;
    background: rgba(102, 126, 234, 0.05);
    z-index: 100;
    cursor: text;
    box-sizing: border-box;
  }
  .inline-text-editor:focus {
    border-color: #667eea;
    box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.3);
  }
</style>
