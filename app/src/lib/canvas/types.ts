export interface SlideDocument {
	version: 1;
	width: number; // 1024 | 1080
	height: number; // 1024 | 1350 | 1920
	background: BackgroundConfig;
	elements: SlideElement[];
}

export type SlideElement =
	| TextElement
	| ImageElement
	| RectElement
	| CircleElement
	| LineElement
	| ArrowElement
	| GroupElement;

export interface BaseElement {
	id: string;
	type: string;
	x: number;
	y: number;
	rotation: number;
	opacity: number; // 0-1
	locked: boolean;
	visible: boolean;
}

export interface TextElement extends BaseElement {
	type: "text";
	text: string;
	fontSize: number;
	fontFamily: string;
	fontWeight: "normal" | "bold";
	fontStyle: "normal" | "italic";
	textDecoration: "none" | "underline";
	fill: string;
	align: "left" | "center" | "right";
	verticalAlign?: "top" | "middle" | "bottom";
	lineHeight: number;
	letterSpacing: number;
	width: number;
	height: number;
	padding: number;
	shadow?: ShadowConfig;
}

export interface ImageElement extends BaseElement {
	type: "image";
	src: string; // URL or data:URI
	width: number;
	height: number;
	cornerRadius: number;
	shadow?: ShadowConfig;
	fill?: string; // hex color to tint/colorize SVG icons
}

export interface RectElement extends BaseElement {
	type: "rect";
	width: number;
	height: number;
	fill: string | GradientConfig;
	cornerRadius: number;
	stroke?: string;
	strokeWidth?: number;
	shadow?: ShadowConfig;
}

export interface CircleElement extends BaseElement {
	type: "circle";
	radius: number;
	fill: string | GradientConfig;
	shadow?: ShadowConfig;
}

export interface LineElement extends BaseElement {
	type: "line";
	points: number[];
	stroke: string;
	strokeWidth: number;
}

export interface ArrowElement extends BaseElement {
	type: "arrow";
	points: number[];
	stroke: string;
	strokeWidth: number;
	pointerLength: number;
	pointerWidth: number;
	pointerAtBeginning?: boolean;
	tension?: number; // 0 for straight, >0 (e.g. 0.3) for curves
	dash?: number[]; // dash pattern, e.g. [10, 10]
}

export interface GroupElement extends BaseElement {
	type: "group";
	children: SlideElement[];
}

export interface BackgroundConfig {
	type: "solid" | "gradient" | "image" | "dots" | "stripes" | "grid";
	color?: string;
	gradient?: GradientConfig;
	imageUrl?: string;
	patternColor?: string; // hex color for dots/stripes/grid
	patternGap?: number; // repeat frequency in px
	patternSize?: number; // dot size / stripe/grid line width in px
}

export interface GradientConfig {
	type: "linear" | "radial";
	stops: Array<{ offset: number; color: string }>;
	angle?: number; // for linear, degrees
}

export interface ShadowConfig {
	color: string;
	blur: number;
	offsetX: number;
	offsetY: number;
	opacity: number;
}
