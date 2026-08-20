CREATE TYPE "public"."content_source" AS ENUM('web', 'api', 'chatgpt', 'automation', 'webhook', 'import');--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "default_language" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "target_audience" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "content_guidelines" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "business_context" text;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "references" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "source" "content_source" DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN "current_revision_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "default_language" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "target_audience" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "tone" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "content_guidelines" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "business_context" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "references" jsonb DEFAULT '[]'::jsonb;