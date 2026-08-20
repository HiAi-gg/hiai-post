<script lang="ts">
import type {
	SlideElement,
	ShadowConfig,
	TextElement,
	RectElement,
	ImageElement,
	LineElement,
	ArrowElement,
	SlideDocument,
	BackgroundConfig,
} from "$lib/canvas/types";

interface Props {
	element: SlideElement | null;
	onUpdate: (el: SlideElement) => void;
	onDelete: () => void;
	slideWidth: number;
	slideHeight: number;
	slide?: SlideDocument | null;
	onBackgroundChange?: (background: BackgroundConfig) => void;
}

const { element, onUpdate, onDelete, slide = null, onBackgroundChange }: Props = $props();

const FONTS = [
	"Inter",
	"Roboto",
	"Open Sans",
	"Montserrat",
	"Poppins",
	"Lato",
	"Raleway",
	"PT Sans",
	"PT Serif",
	"Noto Sans",
	"Noto Serif",
	"Source Sans 3",
	"Nunito Sans",
	"Work Sans",
	"DM Sans",
	"Manrope",
	"Plus Jakarta Sans",
	"Space Grotesk",
	"Playfair Display",
	"EB Garamond",
];

/** Normalize fontFamily for dropdown matching — handles old format "Inter, system-ui, sans-serif" → "Inter" */
function normalizeFont(f: string): string {
	return f.split(",")[0].trim();
}

const TYPE_LABELS: Record<string, string> = {
	text: "Text",
	rect: "Rectangle",
	circle: "Circle",
	image: "Image",
	line: "Line",
	arrow: "Arrow",
	group: "Group",
};

const TYPE_ICONS: Record<string, string> = {
	text: "T",
	rect: "▬",
	circle: "●",
	image: "🖼",
	line: "╱",
	arrow: "➜",
	group: "⊞",
};

function cleanDashes(text: string): string {
	if (!text) return "";
	return text.replace(/[\u2012\u2013\u2014\u2015]/g, "-");
}

function patch(updates: Record<string, unknown>) {
	if (!element) return;
	const cleanUpdates = { ...updates };
	if (typeof cleanUpdates.text === "string") {
		cleanUpdates.text = cleanDashes(cleanUpdates.text);
	}
	onUpdate({ ...element, ...cleanUpdates } as SlideElement);
}

function patchShadow(updates: Partial<ShadowConfig>) {
	if (!element) return;
	const current = (element as any).shadow as ShadowConfig | undefined;
	patch({
		shadow: {
			color: "#000000",
			blur: 4,
			offsetX: 2,
			offsetY: 2,
			opacity: 0.3,
			...current,
			...updates,
		},
	});
}

function toggleShadow() {
	if (!element) return;
	const has = !!(element as any).shadow;
	patch({
		shadow: has
			? undefined
			: { color: "#000000", blur: 4, offsetX: 2, offsetY: 2, opacity: 0.3 },
	});
}

function getFill(): string {
	if (!element) return "#ffffff";
	const fill = (element as any).fill;
	return typeof fill === "string" ? fill : "#ffffff";
}

function getStroke(): string {
	return (element as any).stroke ?? "#000000";
}

function hasSize(): boolean {
	return (
		element?.type === "text" ||
		element?.type === "rect" ||
		element?.type === "image"
	);
}

function hasFill(): boolean {
	return (
		element?.type === "text" ||
		element?.type === "rect" ||
		element?.type === "circle" ||
		(element?.type === "image" &&
			(element.src?.includes("unpkg.com") ||
				element.src?.includes("lucide-static") ||
				element.src?.endsWith(".svg")))
	);
}

function hasStroke(): boolean {
	return (
		element?.type === "rect" ||
		element?.type === "line" ||
		element?.type === "arrow"
	);
}

function hasCornerRadius(): boolean {
	return element?.type === "rect" || element?.type === "image";
}

function autoFitText() {
	if (!element || element.type !== "text") return;
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	const maxWidth = element.width - element.padding * 2;
	const maxHeight = element.height - element.padding * 2;
	const text = element.text;
	function measureAtSize(size: number): { width: number; height: number } {
		ctx.font = `${element!.type === "text" && element.fontWeight === "bold" ? "bold" : "normal"} ${size}px ${element!.type === "text" ? element.fontFamily : "Inter"}`;
		const words = text.split(" ");
		let lines = 1;
		let currentLine = "";
		for (const word of words) {
			const testLine = currentLine ? `${currentLine} ${word}` : word;
			if (ctx.measureText(testLine).width > maxWidth && currentLine) {
				lines += 1;
				currentLine = word;
			} else {
				currentLine = testLine;
			}
		}
		return { width: ctx.measureText(currentLine).width, height: lines * size * element.lineHeight };
	}
	let minSize = 8;
	let maxSize = 150;
	let bestSize = element.fontSize;
	while (minSize <= maxSize) {
		const mid = Math.floor((minSize + maxSize) / 2);
		const measure = measureAtSize(mid);
		if (measure.width <= maxWidth && measure.height <= maxHeight) {
			bestSize = mid;
			minSize = mid + 1;
		} else {
			maxSize = mid - 1;
		}
	}
	if (bestSize !== element.fontSize) patch({ fontSize: bestSize });
}

function setImageAsBackground() {
	if (!element || element.type !== "image" || !onBackgroundChange) return;
	onBackgroundChange({ type: "image", imageUrl: element.src });
}

function getShadow(): ShadowConfig {
	return (
		(element as any).shadow ?? {
			color: "#000000",
			blur: 0,
			offsetX: 0,
			offsetY: 0,
			opacity: 0,
		}
	);
}
</script>

<div class="w-[280px] h-full bg-zinc-900 border-l border-zinc-700 overflow-y-auto text-sm text-zinc-300">
  {#if !element && slide}
    <div class="px-4 py-3 border-b border-zinc-700">
      <div class="text-xs uppercase tracking-wider text-zinc-500 mb-2">Slide Background</div>
      <label class="flex flex-col gap-0.5 mb-2">
        <span class="text-[10px] text-zinc-500">Type</span>
        <select
          class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs"
          value={slide.background.type}
          onchange={(e) => {
            const bgType = e.currentTarget.value as BackgroundConfig["type"];
            onBackgroundChange?.({
              ...slide.background,
              type: bgType,
              ...(bgType === "dots" || bgType === "stripes" || bgType === "grid"
                ? {
                    patternColor: slide.background.patternColor ?? "rgba(255,255,255,0.15)",
                    patternGap: slide.background.patternGap ?? 40,
                    patternSize: slide.background.patternSize ?? 3,
                  }
                : {}),
            });
          }}
        >
          <option value="solid">Solid</option>
          <option value="gradient">Gradient</option>
          <option value="dots">Dots</option>
          <option value="stripes">Stripes</option>
          <option value="grid">Grid</option>
        </select>
      </label>
      <label class="flex flex-col gap-0.5">
        <span class="text-[10px] text-zinc-500">Base Color</span>
        <input
          type="color"
          class="w-full h-8 rounded cursor-pointer"
          value={slide.background.color ?? "#FFFFFF"}
          onchange={(e) => onBackgroundChange?.({ ...slide.background, color: e.currentTarget.value })}
        />
      </label>
      <p class="text-[10px] text-zinc-600 mt-4">Click an element to edit its properties.</p>
    </div>
  {:else if !element}
    <div class="flex items-center justify-center h-full text-zinc-500 text-xs">
      No element selected
    </div>
  {:else}
    <!-- Header -->
    <div class="flex items-center gap-2 px-4 py-3 border-b border-zinc-700">
      <span class="text-lg">{TYPE_ICONS[element.type] ?? "?"}</span>
      <span class="font-semibold text-white">{TYPE_LABELS[element.type] ?? element.type}</span>
      <span class="ml-auto text-xs text-zinc-500 font-mono">{element.id.slice(0, 8)}</span>
    </div>

    <!-- Position & Size -->
    <div class="px-4 py-3 border-b border-zinc-700">
      <div class="text-xs uppercase tracking-wider text-zinc-500 mb-2">Position</div>
      <div class="grid grid-cols-2 gap-2">
        <label class="flex flex-col gap-0.5">
          <span class="text-[10px] text-zinc-500">X</span>
          <input type="number" class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs" value={Math.round(element.x)} onchange={(e) => patch({ x: Number(e.currentTarget.value) })} />
        </label>
        <label class="flex flex-col gap-0.5">
          <span class="text-[10px] text-zinc-500">Y</span>
          <input type="number" class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs" value={Math.round(element.y)} onchange={(e) => patch({ y: Number(e.currentTarget.value) })} />
        </label>
      </div>

      {#if hasSize()}
        <div class="grid grid-cols-2 gap-2 mt-2">
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] text-zinc-500">W</span>
            <input type="number" class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs" value={Math.round((element as any).width)} onchange={(e) => patch({ width: Number(e.currentTarget.value) })} />
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] text-zinc-500">H</span>
            <input type="number" class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs" value={Math.round((element as any).height)} onchange={(e) => patch({ height: Number(e.currentTarget.value) })} />
          </label>
        </div>
      {/if}

      {#if element.type === "circle"}
        <label class="flex flex-col gap-0.5 mt-2">
          <span class="text-[10px] text-zinc-500">Radius</span>
          <input type="number" class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs" value={Math.round(element.radius)} onchange={(e) => patch({ radius: Number(e.currentTarget.value) })} />
        </label>
      {/if}

      <label class="flex flex-col gap-0.5 mt-2">
        <span class="text-[10px] text-zinc-500">Rotation ({Math.round(element.rotation)}°)</span>
        <input type="range" min="0" max="360" class="w-full accent-violet-500" value={element.rotation} oninput={(e) => patch({ rotation: Number(e.currentTarget.value) })} />
      </label>

      <label class="flex flex-col gap-0.5 mt-2">
        <span class="text-[10px] text-zinc-500">Opacity ({Math.round(element.opacity * 100)}%)</span>
        <input type="range" min="0" max="1" step="0.01" class="w-full accent-violet-500" value={element.opacity} oninput={(e) => patch({ opacity: Number(e.currentTarget.value) })} />
      </label>
    </div>

    <!-- Text properties -->
    {#if element.type === "text"}
      <div class="px-4 py-3 border-b border-zinc-700">
        <div class="text-xs uppercase tracking-wider text-zinc-500 mb-2">Text</div>

        <textarea
          class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-white text-xs resize-y min-h-[60px]"
          value={element.text}
          oninput={(e) => patch({ text: e.currentTarget.value })}
        ></textarea>

        <label class="flex flex-col gap-0.5 mt-2">
          <span class="text-[10px] text-zinc-500">Font</span>
          <select class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs" value={normalizeFont(element.fontFamily)} onchange={(e) => patch({ fontFamily: e.currentTarget.value })}>
            {#each FONTS as font}
              <option value={font}>{font.split(",")[0]}</option>
            {/each}
          </select>
        </label>

        <div class="grid grid-cols-2 gap-2 mt-2">
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] text-zinc-500">Size</span>
            <input type="number" min="1" class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs" value={element.fontSize} onchange={(e) => patch({ fontSize: Number(e.currentTarget.value) })} />
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] text-zinc-500">Line H</span>
            <input type="number" min="0" step="0.1" class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs" value={element.lineHeight} onchange={(e) => patch({ lineHeight: Number(e.currentTarget.value) })} />
          </label>
        </div>

        <div class="flex gap-1 mt-2">
          <button class="px-2 py-1 rounded text-xs border" class:bg-violet-600={element.fontWeight === "bold"} class:border-violet-500={element.fontWeight === "bold"} class:border-zinc-700={element.fontWeight !== "bold"} onclick={() => patch({ fontWeight: element.fontWeight === "bold" ? "normal" : "bold" })}><b>B</b></button>
          <button class="px-2 py-1 rounded text-xs border" class:bg-violet-600={element.fontStyle === "italic"} class:border-violet-500={element.fontStyle === "italic"} class:border-zinc-700={element.fontStyle !== "italic"} onclick={() => patch({ fontStyle: element.fontStyle === "italic" ? "normal" : "italic" })}><i>I</i></button>
          <button class="px-2 py-1 rounded text-xs border" class:bg-violet-600={element.textDecoration === "underline"} class:border-violet-500={element.textDecoration === "underline"} class:border-zinc-700={element.textDecoration !== "underline"} onclick={() => patch({ textDecoration: element.textDecoration === "underline" ? "none" : "underline" })}><u>U</u></button>

          <span class="w-px bg-zinc-700 mx-1"></span>

          <button class="px-2 py-1 rounded text-xs border" class:bg-violet-600={element.align === "left"} class:border-violet-500={element.align === "left"} class:border-zinc-700={element.align !== "left"} onclick={() => patch({ align: "left" })}>≡</button>
          <button class="px-2 py-1 rounded text-xs border" class:bg-violet-600={element.align === "center"} class:border-violet-500={element.align === "center"} class:border-zinc-700={element.align !== "center"} onclick={() => patch({ align: "center" })}>≡</button>
          <button class="px-2 py-1 rounded text-xs border" class:bg-violet-600={element.align === "right"} class:border-violet-500={element.align === "right"} class:border-zinc-700={element.align !== "right"} onclick={() => patch({ align: "right" })}>≡</button>
        </div>

        <div class="flex gap-1 mt-2">
          {#each ["top", "middle", "bottom"] as vAlign (vAlign)}
            <button
              type="button"
              class="flex-1 py-1 text-xs rounded border"
              class:bg-violet-600={(element.verticalAlign || "top") === vAlign}
              class:border-violet-500={(element.verticalAlign || "top") === vAlign}
              class:border-zinc-700={(element.verticalAlign || "top") !== vAlign}
              onclick={() => patch({ verticalAlign: vAlign })}
            >{vAlign}</button>
          {/each}
        </div>
        <button
          type="button"
          class="w-full mt-2 px-2 py-1.5 rounded bg-zinc-800 hover:bg-violet-700 text-white text-xs"
          onclick={autoFitText}
        >Auto-fit Text</button>

        <div class="grid grid-cols-2 gap-2 mt-2">
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] text-zinc-500">Spacing</span>
            <input type="number" step="0.5" class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs" value={element.letterSpacing} onchange={(e) => patch({ letterSpacing: Number(e.currentTarget.value) })} />
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] text-zinc-500">Padding</span>
            <input type="number" min="0" class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs" value={element.padding} onchange={(e) => patch({ padding: Number(e.currentTarget.value) })} />
          </label>
        </div>

        <label class="flex flex-col gap-0.5 mt-2">
          <span class="text-[10px] text-zinc-500">Color</span>
          <input type="color" class="w-full h-8 rounded cursor-pointer" value={element.fill} oninput={(e) => patch({ fill: e.currentTarget.value })} />
        </label>
      </div>
    {/if}

    <!-- Fill (rect/circle) -->
    {#if element.type === "rect" || element.type === "circle"}
      <div class="px-4 py-3 border-b border-zinc-700">
        <div class="text-xs uppercase tracking-wider text-zinc-500 mb-2">Fill</div>
        <label class="flex flex-col gap-0.5">
          <span class="text-[10px] text-zinc-500">Color</span>
          <input type="color" class="w-full h-8 rounded cursor-pointer" value={getFill()} oninput={(e) => patch({ fill: e.currentTarget.value })} />
        </label>
        {#if hasCornerRadius()}
          <label class="flex flex-col gap-0.5 mt-2">
            <span class="text-[10px] text-zinc-500">Corner Radius</span>
            <input type="number" min="0" class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs" value={(element as RectElement).cornerRadius} onchange={(e) => patch({ cornerRadius: Number(e.currentTarget.value) })} />
          </label>
        {/if}
      </div>
    {/if}

    <!-- Icon Tint (image SVGs) -->
    {#if element.type === "image" && (element.src?.includes("unpkg.com") || element.src?.includes("lucide-static") || element.src?.endsWith(".svg"))}
      <div class="px-4 py-3 border-b border-zinc-700">
        <div class="text-xs uppercase tracking-wider text-zinc-500 mb-2">Icon Tint</div>
        <label class="flex flex-col gap-0.5">
          <span class="text-[10px] text-zinc-500">Color</span>
          <input type="color" class="w-full h-8 rounded cursor-pointer" value={(element as any).fill || "#ffffff"} oninput={(e) => patch({ fill: e.currentTarget.value })} />
        </label>
      </div>
    {/if}

    <!-- Stroke -->
    {#if hasStroke()}
      <div class="px-4 py-3 border-b border-zinc-700">
        <div class="text-xs uppercase tracking-wider text-zinc-500 mb-2">Stroke</div>
        <div class="grid grid-cols-2 gap-2">
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] text-zinc-500">Color</span>
            <input type="color" class="w-full h-8 rounded cursor-pointer" value={getStroke()} oninput={(e) => patch({ stroke: e.currentTarget.value })} />
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] text-zinc-500">Width</span>
            <input type="number" min="0" class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs" value={(element as any).strokeWidth ?? 0} onchange={(e) => patch({ strokeWidth: Number(e.currentTarget.value) })} />
          </label>
        </div>
      </div>
    {/if}

    <!-- Arrow -->
    {#if element.type === "arrow"}
      <div class="px-4 py-3 border-b border-zinc-700">
        <div class="text-xs uppercase tracking-wider text-zinc-500 mb-2">Arrow Settings</div>
        <div class="mb-3">
          <label class="text-[10px] text-zinc-500 block mb-1">Color & Width</label>
          <div class="flex gap-2">
            <input type="color" class="flex-1 h-8 bg-zinc-800 border border-zinc-700 rounded cursor-pointer"
              value={(element as ArrowElement).stroke}
              onchange={(e) => patch({ stroke: e.currentTarget.value })}
            />
            <input type="number" min="1" max="20" class="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white"
              value={(element as ArrowElement).strokeWidth}
              onchange={(e) => patch({ strokeWidth: Number(e.currentTarget.value) })}
            />
          </div>
        </div>

        <div class="mb-3">
          <label class="text-[10px] text-zinc-500 block mb-1">Pointer (Length & Width)</label>
          <div class="flex gap-2">
            <div class="flex-1">
              <span class="text-[10px] text-zinc-600">L</span>
              <input type="number" min="0" class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white"
                value={(element as ArrowElement).pointerLength}
                onchange={(e) => patch({ pointerLength: Number(e.currentTarget.value) })}
              />
            </div>
            <div class="flex-1">
              <span class="text-[10px] text-zinc-600">W</span>
              <input type="number" min="0" class="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white"
                value={(element as ArrowElement).pointerWidth}
                onchange={(e) => patch({ pointerWidth: Number(e.currentTarget.value) })}
              />
            </div>
          </div>
        </div>

        <div class="mb-3 flex items-center gap-1.5 text-xs text-zinc-300">
          <input type="checkbox" class="accent-violet-500"
            checked={(element as ArrowElement).pointerAtBeginning ?? false}
            onchange={(e) => patch({ pointerAtBeginning: e.currentTarget.checked })}
          />
          <span class="cursor-pointer">Pointer at Start</span>
        </div>

        <div class="mb-3">
          <label class="flex items-center gap-1.5 text-xs text-zinc-300 cursor-pointer mb-1">
            <input type="checkbox" class="accent-violet-500"
              checked={(element as ArrowElement).points.length > 4}
              onchange={(e) => {
                const isCurved = e.currentTarget.checked;
                const points = [...(element as ArrowElement).points];
                if (isCurved && points.length === 4) {
                  const x_mid = Math.round((points[0] + points[2]) / 2);
                  const y_mid = Math.round((points[1] + points[3]) / 2 - 50);
                  patch({
                    points: [points[0], points[1], x_mid, y_mid, points[2], points[3]],
                    tension: (element as ArrowElement).tension ?? 0.4
                  });
                } else if (!isCurved && points.length > 4) {
                  const x_end = points[points.length - 2];
                  const y_end = points[points.length - 1];
                  patch({
                    points: [points[0], points[1], x_end, y_end],
                    tension: 0
                  });
                }
              }}
            />
            <span>Curved (Comic / Wave)</span>
          </label>
          {#if (element as ArrowElement).points.length > 4}
            <div class="mt-1">
              <span class="text-[10px] text-zinc-500">Tension: {(element as ArrowElement).tension ?? 0.4}</span>
              <input type="range" min="0.1" max="1" step="0.05" class="w-full accent-violet-500"
                value={(element as ArrowElement).tension ?? 0.4}
                oninput={(e) => patch({ tension: Number(e.currentTarget.value) })}
              />
            </div>
          {/if}
        </div>

        <div class="mb-3 flex items-center gap-1.5 text-xs text-zinc-300">
          <input type="checkbox" class="accent-violet-500"
            checked={!!(element as ArrowElement).dash}
            onchange={(e) => patch({ dash: e.currentTarget.checked ? [10, 10] : undefined })}
          />
          <span class="cursor-pointer">Dashed Line</span>
        </div>

        <div class="mb-2">
          <span class="text-[10px] text-zinc-500 block">Start Point</span>
          <div class="grid grid-cols-2 gap-2 mt-1">
            <label class="flex flex-col gap-0.5">
              <span class="text-[9px] text-zinc-600">X1</span>
              <input type="number" class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs"
                value={(element as ArrowElement).points[0]}
                onchange={(e) => {
                  const pts = [...(element as ArrowElement).points];
                  pts[0] = Number(e.currentTarget.value);
                  patch({ points: pts });
                }}
              />
            </label>
            <label class="flex flex-col gap-0.5">
              <span class="text-[9px] text-zinc-600">Y1</span>
              <input type="number" class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs"
                value={(element as ArrowElement).points[1]}
                onchange={(e) => {
                  const pts = [...(element as ArrowElement).points];
                  pts[1] = Number(e.currentTarget.value);
                  patch({ points: pts });
                }}
              />
            </label>
          </div>
        </div>

        <div class="mb-2">
          <span class="text-[10px] text-zinc-500 block">End Point</span>
          <div class="grid grid-cols-2 gap-2 mt-1">
            <label class="flex flex-col gap-0.5">
              <span class="text-[9px] text-zinc-600">X2</span>
              <input type="number" class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs"
                value={(element as ArrowElement).points[(element as ArrowElement).points.length - 2]}
                onchange={(e) => {
                  const pts = [...(element as ArrowElement).points];
                  pts[pts.length - 2] = Number(e.currentTarget.value);
                  patch({ points: pts });
                }}
              />
            </label>
            <label class="flex flex-col gap-0.5">
              <span class="text-[9px] text-zinc-600">Y2</span>
              <input type="number" class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs"
                value={(element as ArrowElement).points[(element as ArrowElement).points.length - 1]}
                onchange={(e) => {
                  const pts = [...(element as ArrowElement).points];
                  pts[pts.length - 1] = Number(e.currentTarget.value);
                  patch({ points: pts });
                }}
              />
            </label>
          </div>
        </div>

        {#if (element as ArrowElement).points.length > 4}
          <div class="mb-2">
            <span class="text-[10px] text-zinc-500 block">Arc Midpoint</span>
            <div class="grid grid-cols-2 gap-2 mt-1">
              <label class="flex flex-col gap-0.5">
                <span class="text-[9px] text-zinc-600">Mid X</span>
                <input type="number" class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs"
                  value={(element as ArrowElement).points[2]}
                  onchange={(e) => {
                    const pts = [...(element as ArrowElement).points];
                    pts[2] = Number(e.currentTarget.value);
                    patch({ points: pts });
                  }}
                />
              </label>
              <label class="flex flex-col gap-0.5">
                <span class="text-[9px] text-zinc-600">Mid Y</span>
                <input type="number" class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs"
                  value={(element as ArrowElement).points[3]}
                  onchange={(e) => {
                    const pts = [...(element as ArrowElement).points];
                    pts[3] = Number(e.currentTarget.value);
                    patch({ points: pts });
                  }}
                />
              </label>
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Image -->
    {#if element.type === "image"}
      <div class="px-4 py-3 border-b border-zinc-700">
        <div class="text-xs uppercase tracking-wider text-zinc-500 mb-2">Image</div>
        <div class="text-[10px] text-zinc-500 mb-1">Source</div>
        <div class="text-xs text-zinc-400 break-all bg-zinc-800 rounded px-2 py-1 max-h-16 overflow-hidden">{element.src}</div>
        <label class="flex flex-col gap-0.5 mt-2">
          <span class="text-[10px] text-zinc-500">Corner Radius</span>
          <input type="number" min="0" class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs" value={element.cornerRadius} onchange={(e) => patch({ cornerRadius: Number(e.currentTarget.value) })} />
        </label>
        <button
          type="button"
          class="w-full mt-2 px-2 py-1.5 rounded bg-zinc-800 hover:bg-violet-700 text-white text-xs"
          onclick={setImageAsBackground}
        >Set as Background</button>
      </div>
    {/if}

    <!-- Shadow -->
    <div class="px-4 py-3 border-b border-zinc-700">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs uppercase tracking-wider text-zinc-500">Shadow</span>
        <button class="text-xs px-2 py-0.5 rounded border" class:bg-violet-600={!!(element as any).shadow} class:border-violet-500={!!(element as any).shadow} class:border-zinc-700={!(element as any).shadow} onclick={toggleShadow}>
          {#if (element as any).shadow}On{:else}Off{/if}
        </button>
      </div>
      {#if (element as any).shadow}
        {@const s = getShadow()}
        <div class="grid grid-cols-2 gap-2">
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] text-zinc-500">Color</span>
            <input type="color" class="w-full h-7 rounded cursor-pointer" value={s.color} oninput={(e) => patchShadow({ color: e.currentTarget.value })} />
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] text-zinc-500">Blur ({s.blur})</span>
            <input type="range" min="0" max="50" class="w-full accent-violet-500" value={s.blur} oninput={(e) => patchShadow({ blur: Number(e.currentTarget.value) })} />
          </label>
        </div>
        <div class="grid grid-cols-3 gap-2 mt-2">
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] text-zinc-500">X</span>
            <input type="number" class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs" value={s.offsetX} onchange={(e) => patchShadow({ offsetX: Number(e.currentTarget.value) })} />
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] text-zinc-500">Y</span>
            <input type="number" class="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-white text-xs" value={s.offsetY} onchange={(e) => patchShadow({ offsetY: Number(e.currentTarget.value) })} />
          </label>
          <label class="flex flex-col gap-0.5">
            <span class="text-[10px] text-zinc-500">Opacity</span>
            <input type="range" min="0" max="1" step="0.05" class="w-full accent-violet-500" value={s.opacity} oninput={(e) => patchShadow({ opacity: Number(e.currentTarget.value) })} />
          </label>
        </div>
      {/if}
    </div>

    <!-- Toggles & Delete -->
    <div class="px-4 py-3">
      <div class="flex gap-3 mb-3">
        <label class="flex items-center gap-1.5 text-xs cursor-pointer">
          <input type="checkbox" class="accent-violet-500" checked={element.locked} onchange={(e) => patch({ locked: e.currentTarget.checked })} /> Locked
        </label>
        <label class="flex items-center gap-1.5 text-xs cursor-pointer">
          <input type="checkbox" class="accent-violet-500" checked={element.visible} onchange={(e) => patch({ visible: e.currentTarget.checked })} /> Visible
        </label>
      </div>
      <button class="w-full py-2 rounded bg-red-900/60 hover:bg-red-800 text-red-300 text-xs font-semibold border border-red-800 transition-colors" onclick={onDelete}>
        Delete Element
      </button>
    </div>
  {/if}
</div>
