CREATE TYPE "tenant_role" AS ENUM('viewer', 'editor', 'admin', 'owner');
--> statement-breakpoint
CREATE TABLE "tenant_members" (
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "tenant_role" DEFAULT 'viewer' NOT NULL,
	"invited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_members_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "tenant_members_user_idx" ON "tenant_members" ("user_id");
--> statement-breakpoint
CREATE INDEX "tenant_members_tenant_role_idx" ON "tenant_members" ("tenant_id","role");
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "role" "tenant_role";
--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" ("actor_id");

