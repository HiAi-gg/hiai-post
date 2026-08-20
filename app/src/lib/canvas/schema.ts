import { z } from "zod";
import type { SlideDocument, SlideElement } from "./types";

// --- Primitive schemas ---

export const shadowConfigSchema = z.object({
	color: z.string(),
	blur: z.number().min(0),
	offsetX: z.number(),
	offsetY: z.number(),
	opacity: z.number().min(0).max(1),
});

export const gradientStopSchema = z.object({
	offset: z.number().min(0).max(1),
	color: z.string(),
});

export const gradientConfigSchema = z.object({
	type: z.enum(["linear", "radial"]),
	stops: z.array(gradientStopSchema).min(2),
	angle: z.number().optional(),
});

export const backgroundConfigSchema = z.object({
	type: z.enum(["solid", "gradient", "image", "dots", "stripes", "grid"]),
	color: z.string().optional(),
	gradient: gradientConfigSchema.optional(),
	imageUrl: z.string().optional(),
	patternColor: z.string().optional(),
	patternGap: z.number().min(0).optional(),
	patternSize: z.number().min(0).optional(),
});

// --- Base element fields ---

const baseElementFields = {
	id: z.string(),
	x: z.number(),
	y: z.number(),
	rotation: z.number().default(0),
	opacity: z.number().min(0).max(1).default(1),
	locked: z.boolean().default(false),
	visible: z.boolean().default(true),
};

// --- Element schemas ---

export const textElementSchema = z.object({
	...baseElementFields,
	type: z.literal("text"),
	text: z.string(),
	fontSize: z.number().min(1),
	fontFamily: z.string(),
	fontWeight: z.enum(["normal", "bold"]).default("normal"),
	fontStyle: z.enum(["normal", "italic"]).default("normal"),
	textDecoration: z.enum(["none", "underline"]).default("none"),
	fill: z.string(),
	align: z.enum(["left", "center", "right"]).default("left"),
	verticalAlign: z.enum(["top", "middle", "bottom"]).default("top"),
	lineHeight: z.number().min(0).default(1.2),
	letterSpacing: z.number().default(0),
	width: z.number().min(0),
	height: z.number().min(0),
	padding: z.number().min(0).default(0),
	shadow: shadowConfigSchema.optional(),
});

export const imageElementSchema = z.object({
	...baseElementFields,
	type: z.literal("image"),
	src: z.string(),
	width: z.number().min(0),
	height: z.number().min(0),
	cornerRadius: z.number().min(0).default(0),
	shadow: shadowConfigSchema.optional(),
	fill: z.string().optional(),
});

export const rectElementSchema = z.object({
	...baseElementFields,
	type: z.literal("rect"),
	width: z.number().min(0),
	height: z.number().min(0),
	fill: z.union([z.string(), gradientConfigSchema]),
	cornerRadius: z.number().min(0).default(0),
	stroke: z.string().optional(),
	strokeWidth: z.number().min(0).optional(),
	shadow: shadowConfigSchema.optional(),
});

export const circleElementSchema = z.object({
	...baseElementFields,
	type: z.literal("circle"),
	radius: z.number().min(0),
	fill: z.union([z.string(), gradientConfigSchema]),
	shadow: shadowConfigSchema.optional(),
});

export const lineElementSchema = z.object({
	...baseElementFields,
	type: z.literal("line"),
	points: z.array(z.number()),
	stroke: z.string(),
	strokeWidth: z.number().min(0),
});

export const arrowElementSchema = z.object({
	...baseElementFields,
	type: z.literal("arrow"),
	points: z.array(z.number()),
	stroke: z.string(),
	strokeWidth: z.number().min(0),
	pointerLength: z.number().min(0).default(20),
	pointerWidth: z.number().min(0).default(20),
	pointerAtBeginning: z.boolean().optional(),
	tension: z.number().min(0).max(1).optional(),
	dash: z.array(z.number()).optional(),
});

// Recursive group — use z.lazy with explicit type annotation
export const groupElementSchema: z.ZodType<{
	id: string;
	type: "group";
	x: number;
	y: number;
	rotation: number;
	opacity: number;
	locked: boolean;
	visible: boolean;
	children: SlideElement[];
}> = z.lazy(() =>
	z.object({
		...baseElementFields,
		type: z.literal("group"),
		children: z.array(slideElementSchema),
	}),
) as z.ZodType<{
	id: string;
	type: "group";
	x: number;
	y: number;
	rotation: number;
	opacity: number;
	locked: boolean;
	visible: boolean;
	children: SlideElement[];
}>;

// --- Union (plain union instead of discriminatedUnion for recursive compat) ---

export const slideElementSchema = z.union([
	textElementSchema,
	imageElementSchema,
	rectElementSchema,
	circleElementSchema,
	lineElementSchema,
	arrowElementSchema,
	groupElementSchema,
]) as z.ZodType<SlideElement>;

// --- Slide document ---

export const slideDocumentSchema = z.object({
	version: z.literal(1),
	width: z.number().min(1),
	height: z.number().min(1),
	background: backgroundConfigSchema,
	elements: z.array(slideElementSchema),
}) as z.ZodType<SlideDocument>;

// --- Exported types ---

export type SlideDocumentZod = z.infer<typeof slideDocumentSchema>;
export type SlideElementZod = z.infer<typeof slideElementSchema>;
export type TextElementZod = z.infer<typeof textElementSchema>;
export type ImageElementZod = z.infer<typeof imageElementSchema>;
export type RectElementZod = z.infer<typeof rectElementSchema>;
export type CircleElementZod = z.infer<typeof circleElementSchema>;
export type LineElementZod = z.infer<typeof lineElementSchema>;
export type GroupElementZod = z.infer<typeof groupElementSchema>;
export type ShadowConfigZod = z.infer<typeof shadowConfigSchema>;
export type GradientConfigZod = z.infer<typeof gradientConfigSchema>;
export type BackgroundConfigZod = z.infer<typeof backgroundConfigSchema>;

// --- Validation helper ---

export function validateSlide(
	json: unknown,
):
	| { success: true; data: SlideDocument }
	| { success: false; error: z.ZodError } {
	const result = slideDocumentSchema.safeParse(json);
	if (result.success) {
		return { success: true, data: result.data };
	}
	return { success: false, error: result.error };
}
