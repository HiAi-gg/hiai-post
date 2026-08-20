import { nanoid } from "nanoid";
import type {
	SlideDocument,
	SlideElement,
	TextElement,
	RectElement,
	CircleElement,
	ImageElement,
	LineElement,
	ArrowElement,
	GroupElement,
	BackgroundConfig,
} from "./types";

const base = () => ({
	id: nanoid(),
	x: 0,
	y: 0,
	rotation: 0,
	opacity: 1,
	locked: false,
	visible: true,
});

export function createTextElement(
	overrides?: Partial<TextElement>,
): TextElement {
	return {
		...base(),
		type: "text",
		text: "New text",
		fontSize: 24,
		fontFamily: "Inter",
		fontWeight: "normal",
		fontStyle: "normal",
		textDecoration: "none",
		fill: "#ffffff",
		align: "center",
		verticalAlign: "top",
		lineHeight: 1.4,
		letterSpacing: 0,
		x: 100,
		y: 100,
		width: 824,
		height: 100,
		padding: 0,
		...overrides,
	};
}

export function createRectElement(
	overrides?: Partial<RectElement>,
): RectElement {
	return {
		...base(),
		type: "rect",
		width: 200,
		height: 200,
		fill: "#ffffff",
		cornerRadius: 0,
		...overrides,
	};
}

export function createCircleElement(
	overrides?: Partial<CircleElement>,
): CircleElement {
	return {
		...base(),
		type: "circle",
		radius: 50,
		fill: "#ffffff",
		...overrides,
	};
}

export function createImageElement(
	overrides?: Partial<ImageElement>,
): ImageElement {
	return {
		...base(),
		type: "image",
		src: "",
		width: 300,
		height: 300,
		cornerRadius: 0,
		...overrides,
	};
}

export function createLineElement(
	overrides?: Partial<LineElement>,
): LineElement {
	return {
		...base(),
		type: "line",
		points: [0, 0, 200, 0],
		stroke: "#000000",
		strokeWidth: 2,
		...overrides,
	};
}

export function createArrowElement(
	overrides?: Partial<ArrowElement>,
): ArrowElement {
	return {
		...base(),
		type: "arrow",
		points: [0, 0, 150, 0],
		stroke: "#ffffff",
		strokeWidth: 4,
		pointerLength: 15,
		pointerWidth: 15,
		tension: 0,
		...overrides,
	};
}

export function createIconElement(
	overrides?: Partial<ImageElement>,
): ImageElement {
	return {
		...base(),
		type: "image",
		src: "",
		width: 64,
		height: 64,
		cornerRadius: 0,
		fill: "#ffffff",
		...overrides,
	};
}

export function createGroupElement(
	overrides?: Partial<GroupElement>,
): GroupElement {
	return {
		...base(),
		type: "group",
		children: [],
		...overrides,
	};
}

export function createElement(
	type: SlideElement["type"] | "icon",
): SlideElement {
	switch (type) {
		case "text":
			return createTextElement();
		case "rect":
			return createRectElement();
		case "circle":
			return createCircleElement();
		case "image":
			return createImageElement();
		case "icon":
			return createIconElement();
		case "line":
			return createLineElement();
		case "arrow":
			return createArrowElement();
		case "group":
			return createGroupElement();
	}
}

export function createSlideDocument(
	width: number,
	height: number,
	preset: "minimal" | "bold" | "gradient" = "minimal",
): SlideDocument {
	const backgrounds: Record<string, BackgroundConfig> = {
		minimal: { type: "solid", color: "#ffffff" },
		bold: { type: "solid", color: "#0d0d0d" },
		gradient: {
			type: "gradient",
			gradient: {
				type: "linear",
				stops: [
					{ offset: 0, color: "#667eea" },
					{ offset: 1, color: "#764ba2" },
				],
				angle: 135,
			},
		},
	};

	const textFills: Record<string, string> = {
		minimal: "#1a1a1a",
		bold: "#ffffff",
		gradient: "#ffffff",
	};

	const centerX = Math.round((width - 824) / 2);

	return {
		version: 1,
		width,
		height,
		background: backgrounds[preset],
		elements: [
			createTextElement({
				text: "Slide Title",
				fontSize: 48,
				fontWeight: "bold",
				fill: textFills[preset],
				x: centerX,
				y: Math.round(height * 0.3),
				width: 824,
				height: 80,
			}),
			createTextElement({
				text: "Subtitle or description text goes here",
				fontSize: 24,
				fontWeight: "normal",
				fill: textFills[preset],
				x: centerX,
				y: Math.round(height * 0.3) + 100,
				width: 824,
				height: 60,
				opacity: 0.7,
			}),
		],
	};
}
