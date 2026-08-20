import Konva from "konva";
import type {
	SlideElement,
	TextElement,
	ImageElement,
	RectElement,
	CircleElement,
	LineElement,
	ArrowElement,
	GroupElement,
	BackgroundConfig,
	GradientConfig,
	ShadowConfig,
} from "./types";

// ── Gradient helpers ──────────────────────────────────────────────────────

function isGradientConfig(
	fill: string | GradientConfig,
): fill is GradientConfig {
	return typeof fill === "object" && "type" in fill && "stops" in fill;
}

function applyGradientFill(
	node: Konva.Shape,
	grad: GradientConfig,
	width: number,
	height: number,
) {
	const colorStops = grad.stops.flatMap((s) => [
		s.offset,
		s.color,
	]) as unknown as number[];

	if (grad.type === "radial") {
		node.fillRadialGradientStartPoint({ x: width / 2, y: height / 2 });
		node.fillRadialGradientStartRadius(0);
		node.fillRadialGradientEndPoint({ x: width / 2, y: height / 2 });
		node.fillRadialGradientEndRadius(Math.max(width, height) / 2);
		node.fillRadialGradientColorStops(colorStops);
	} else {
		const angle = ((grad.angle ?? 0) * Math.PI) / 180;
		node.fillLinearGradientStartPoint({
			x: (-Math.sin(angle) * width) / 2,
			y: (Math.cos(angle) * height) / 2,
		});
		node.fillLinearGradientEndPoint({
			x: (Math.sin(angle) * width) / 2,
			y: (-Math.cos(angle) * height) / 2,
		});
		node.fillLinearGradientColorStops(colorStops);
	}
}

// ── Shadow helper ─────────────────────────────────────────────────────────

function applyShadow(node: Konva.Shape, shadow?: ShadowConfig) {
	if (!shadow) return;
	node.shadowColor(shadow.color);
	node.shadowBlur(shadow.blur);
	node.shadowOffset({ x: shadow.offsetX, y: shadow.offsetY });
	node.shadowOpacity(shadow.opacity);
}

// ── Element rendering ─────────────────────────────────────────────────────

function renderTextElement(el: TextElement): Konva.Text {
	const node = new Konva.Text({
		id: el.id,
		x: el.x,
		y: el.y,
		width: el.width,
		height:
			el.verticalAlign === "middle" || el.verticalAlign === "bottom"
				? el.height
				: undefined,
		rotation: el.rotation,
		opacity: el.opacity,
		visible: el.visible,
		draggable: !el.locked,
		text: el.text,
		fontSize: el.fontSize,
		fontFamily: el.fontFamily,
		fontStyle:
			el.fontWeight === "bold" && el.fontStyle === "italic"
				? "bold italic"
				: el.fontWeight === "bold"
					? "bold"
					: el.fontStyle === "italic"
						? "italic"
						: "normal",
		textDecoration: el.textDecoration,
		fill: el.fill,
		align: el.align,
		verticalAlign: el.verticalAlign ?? "top",
		lineHeight: el.lineHeight,
		letterSpacing: el.letterSpacing,
		padding: el.padding,
		wrap: "word",
	});
	applyShadow(node, el.shadow);
	return node;
}

function getColoredImage(
	img: HTMLImageElement,
	fill?: string,
	isSvg = false,
	targetWidth = 100,
	targetHeight = 100,
): HTMLImageElement | HTMLCanvasElement {
	if (!fill || !isSvg) return img;
	const canvas = document.createElement("canvas");
	canvas.width = targetWidth;
	canvas.height = targetHeight;
	const ctx = canvas.getContext("2d");
	if (ctx) {
		ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
		ctx.globalCompositeOperation = "source-in";
		ctx.fillStyle = fill;
		ctx.fillRect(0, 0, targetWidth, targetHeight);
		return canvas;
	}
	return img;
}

function renderImageElement(el: ImageElement): Konva.Image {
	const placeholder = new Konva.Image({
		id: el.id,
		x: el.x,
		y: el.y,
		width: el.width,
		height: el.height,
		rotation: el.rotation,
		opacity: el.opacity,
		visible: el.visible,
		draggable: !el.locked,
		cornerRadius: el.cornerRadius,
		image: undefined as unknown as HTMLImageElement,
	});
	applyShadow(placeholder, el.shadow);

	const img = new window.Image();
	img.crossOrigin = "anonymous";
	img.onload = () => {
		const isSvg =
			el.src.includes("unpkg.com") ||
			el.src.includes("lucide-static") ||
			el.src.endsWith(".svg");
		placeholder.image(
			getColoredImage(img, el.fill, isSvg, el.width, el.height) as any,
		);
		placeholder.getLayer()?.batchDraw();
	};
	img.src = el.src;

	return placeholder;
}

function renderRectElement(el: RectElement): Konva.Rect {
	const node = new Konva.Rect({
		id: el.id,
		x: el.x,
		y: el.y,
		width: el.width,
		height: el.height,
		rotation: el.rotation,
		opacity: el.opacity,
		visible: el.visible,
		draggable: !el.locked,
		cornerRadius: el.cornerRadius,
		stroke: el.stroke,
		strokeWidth: el.strokeWidth,
	});

	if (isGradientConfig(el.fill)) {
		applyGradientFill(node, el.fill, el.width, el.height);
	} else {
		node.fill(el.fill);
	}

	applyShadow(node, el.shadow);
	return node;
}

function renderCircleElement(el: CircleElement): Konva.Circle {
	const node = new Konva.Circle({
		id: el.id,
		x: el.x,
		y: el.y,
		radius: el.radius,
		rotation: el.rotation,
		opacity: el.opacity,
		visible: el.visible,
		draggable: !el.locked,
	});

	if (isGradientConfig(el.fill)) {
		applyGradientFill(node, el.fill, el.radius * 2, el.radius * 2);
	} else {
		node.fill(el.fill);
	}

	applyShadow(node, el.shadow);
	return node;
}

function renderLineElement(el: LineElement): Konva.Line {
	return new Konva.Line({
		id: el.id,
		x: el.x,
		y: el.y,
		points: el.points,
		rotation: el.rotation,
		opacity: el.opacity,
		visible: el.visible,
		draggable: !el.locked,
		stroke: el.stroke,
		strokeWidth: el.strokeWidth,
	});
}

function renderArrowElement(el: ArrowElement): Konva.Arrow {
	return new Konva.Arrow({
		id: el.id,
		x: el.x,
		y: el.y,
		points: el.points,
		rotation: el.rotation,
		opacity: el.opacity,
		visible: el.visible,
		draggable: !el.locked,
		stroke: el.stroke,
		strokeWidth: el.strokeWidth,
		pointerLength: el.pointerLength,
		pointerWidth: el.pointerWidth,
		pointerAtBeginning: el.pointerAtBeginning ?? false,
		tension: el.tension ?? 0,
		dash: el.dash ?? undefined,
	});
}

function renderGroupElement(el: GroupElement): Konva.Group {
	const group = new Konva.Group({
		id: el.id,
		x: el.x,
		y: el.y,
		rotation: el.rotation,
		opacity: el.opacity,
		visible: el.visible,
		draggable: !el.locked,
	});

	for (const child of el.children) {
		const node = renderElement(child);
		if (node) group.add(node as unknown as Konva.Shape);
	}

	return group;
}

/**
 * Render a SlideElement into a Konva node.
 * Returns null for unknown types.
 * @param readonly - If true, force draggable=false regardless of element.locked
 */
export function renderElement(
	el: SlideElement,
	readonly = false,
): Konva.Node | null {
	let node: Konva.Node | null = null;
	switch (el.type) {
		case "text":
			node = renderTextElement(el);
			break;
		case "image":
			node = renderImageElement(el);
			break;
		case "rect":
			node = renderRectElement(el);
			break;
		case "circle":
			node = renderCircleElement(el);
			break;
		case "line":
			node = renderLineElement(el);
			break;
		case "arrow":
			node = renderArrowElement(el);
			break;
		case "group":
			node = renderGroupElement(el);
			break;
		default:
			console.warn(`[renderer] Unknown element type: ${(el as any).type}`);
			return null;
	}
	if (readonly && node) node.draggable(false);
	return node;
}

// ── Background rendering ──────────────────────────────────────────────────

export function renderBackground(
	bg: BackgroundConfig,
	width: number,
	height: number,
): Konva.Shape | Konva.Group {
	if (bg.type === "dots" || bg.type === "stripes" || bg.type === "grid") {
		const baseRect = new Konva.Rect({
			x: 0,
			y: 0,
			width,
			height,
			listening: false,
		});

		if (bg.color) {
			baseRect.fill(bg.color);
		} else if (bg.gradient) {
			applyGradientFill(baseRect, bg.gradient, width, height);
		} else {
			baseRect.fill("#FFFFFF");
		}

		const patternRect = new Konva.Rect({
			x: 0,
			y: 0,
			width,
			height,
			listening: false,
		});

		const gap = bg.patternGap ?? 40;
		const size = bg.patternSize ?? 4;
		const color = bg.patternColor ?? "rgba(255, 255, 255, 0.15)";

		const canvas = document.createElement("canvas");
		canvas.width = gap;
		canvas.height = gap;
		const ctx = canvas.getContext("2d");
		if (ctx) {
			if (bg.type === "dots") {
				ctx.fillStyle = color;
				ctx.beginPath();
				ctx.arc(gap / 2, gap / 2, size / 2, 0, Math.PI * 2);
				ctx.fill();
			} else if (bg.type === "stripes") {
				ctx.strokeStyle = color;
				ctx.lineWidth = size;
				ctx.beginPath();
				ctx.moveTo(0, gap);
				ctx.lineTo(gap, 0);
				ctx.stroke();
			} else if (bg.type === "grid") {
				ctx.strokeStyle = color;
				ctx.lineWidth = size;
				ctx.beginPath();
				// Horizontal grid line
				ctx.moveTo(0, 0);
				ctx.lineTo(gap, 0);
				// Vertical grid line
				ctx.moveTo(0, 0);
				ctx.lineTo(0, gap);
				ctx.stroke();
			}
			patternRect.fillPatternImage(canvas);
		}

		const group = new Konva.Group({
			x: 0,
			y: 0,
			width,
			height,
			listening: false,
			name: "__background",
		});
		group.add(baseRect);
		group.add(patternRect);
		return group;
	}

	const rect = new Konva.Rect({
		x: 0,
		y: 0,
		width,
		height,
		listening: false,
		name: "__background",
	});

	if (bg.type === "solid" && bg.color) {
		rect.fill(bg.color);
	} else if (bg.type === "gradient" && bg.gradient) {
		applyGradientFill(rect, bg.gradient, width, height);
	} else if (bg.type === "image" && bg.imageUrl) {
		const img = new window.Image();
		img.crossOrigin = "anonymous";
		img.onload = () => {
			rect.fillPatternImage(img);
			rect.getLayer()?.batchDraw();
		};
		img.src = bg.imageUrl;
	} else {
		rect.fill("#FFFFFF");
	}

	return rect;
}

// ── Image preloading ──────────────────────────────────────────────────────

export async function preloadImages(elements: SlideElement[]): Promise<void> {
	const promises: Promise<void>[] = [];

	function collectImages(els: SlideElement[]) {
		for (const el of els) {
			if (el.type === "image" && el.src) {
				promises.push(
					new Promise<void>((resolve) => {
						const img = new window.Image();
						img.crossOrigin = "anonymous";
						img.onload = () => resolve();
						img.onerror = () => {
							console.warn(`[renderer] Failed to preload image: ${el.src}`);
							resolve();
						};
						img.src = el.src;
					}),
				);
			} else if (el.type === "group") {
				collectImages(el.children);
			}
		}
	}

	collectImages(elements);
	await Promise.all(promises);
}

// ── Aliases for SlideCanvas compatibility ────────────────────────────────────

export const createElementNode = renderElement;

// ── Cached image loader ─────────────────────────────────────────────────────

const imageCache = new Map<string, HTMLImageElement>();

export function loadImage(src: string): Promise<HTMLImageElement> {
	const cached = imageCache.get(src);
	if (cached) return Promise.resolve(cached);
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.onload = () => {
			imageCache.set(src, img);
			resolve(img);
		};
		img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
		img.src = src;
	});
}

export function getCachedImage(src: string): HTMLImageElement | undefined {
	return imageCache.get(src);
}

// ── Update existing Konva node from SlideElement ─────────────────────────────

export function updateNode(node: Konva.Node, el: SlideElement): void {
	node.setAttrs({
		x: el.x,
		y: el.y,
		rotation: el.rotation,
		opacity: el.opacity,
		draggable: !el.locked,
		visible: el.visible,
	});
	switch (el.type) {
		case "text": {
			const n = node as Konva.Text;
			n.text(el.text);
			n.fontSize(el.fontSize);
			n.fontFamily(el.fontFamily);
			n.fontStyle(
				el.fontWeight === "bold" && el.fontStyle === "italic"
					? "bold italic"
					: el.fontWeight === "bold"
						? "bold"
						: el.fontStyle === "italic"
							? "italic"
							: "normal",
			);
			n.textDecoration(el.textDecoration);
			n.fill(el.fill);
			n.align(el.align);
			n.verticalAlign(el.verticalAlign ?? "top");
			n.lineHeight(el.lineHeight);
			n.letterSpacing(el.letterSpacing);
			n.width(el.width);
			if (el.verticalAlign === "middle" || el.verticalAlign === "bottom") {
				n.height(el.height);
			} else {
				n.height(undefined as any);
			}
			n.padding(el.padding);
			applyShadow(n, el.shadow);
			break;
		}
		case "image": {
			const n = node as Konva.Image;
			const cached = getCachedImage(el.src);
			if (cached) {
				const isSvg =
					el.src.includes("unpkg.com") ||
					el.src.includes("lucide-static") ||
					el.src.endsWith(".svg");
				n.image(
					getColoredImage(cached, el.fill, isSvg, el.width, el.height) as any,
				);
			}
			n.width(el.width);
			n.height(el.height);
			n.cornerRadius(el.cornerRadius);
			applyShadow(n, el.shadow);
			break;
		}
		case "rect": {
			const n = node as Konva.Rect;
			n.width(el.width);
			n.height(el.height);
			n.cornerRadius(el.cornerRadius);
			n.stroke(el.stroke ?? "");
			n.strokeWidth(el.strokeWidth ?? 0);
			if (isGradientConfig(el.fill)) {
				applyGradientFill(n, el.fill, el.width, el.height);
			} else {
				n.fill(el.fill);
			}
			applyShadow(n, el.shadow);
			break;
		}
		case "circle": {
			const n = node as Konva.Circle;
			n.radius(el.radius);
			if (isGradientConfig(el.fill)) {
				applyGradientFill(n, el.fill, el.radius * 2, el.radius * 2);
			} else {
				n.fill(el.fill);
			}
			applyShadow(n, el.shadow);
			break;
		}
		case "line": {
			const n = node as Konva.Line;
			n.points(el.points);
			n.stroke(el.stroke);
			n.strokeWidth(el.strokeWidth);
			break;
		}
		case "arrow": {
			const n = node as Konva.Arrow;
			n.points(el.points);
			n.stroke(el.stroke);
			n.strokeWidth(el.strokeWidth);
			n.pointerLength(el.pointerLength);
			n.pointerWidth(el.pointerWidth);
			n.pointerAtBeginning(el.pointerAtBeginning ?? false);
			n.tension(el.tension ?? 0);
			n.dash(el.dash ?? null);
			break;
		}
	}
}
