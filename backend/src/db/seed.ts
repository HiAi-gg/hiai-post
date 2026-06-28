import { db } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { campaigns, postTemplates, tenants } from "./schema.js";

async function seed() {
  logger.info("Seeding hiai_post database...");

  // Create sample tenant
  const [tenant] = await db
    .insert(tenants)
    .values({
      slug: "demo-store",
      name: "Demo Store",
      email: "demo@hiai.store",
      settings: { theme: "light", currency: "USD" },
    } as any)
    .onConflictDoNothing()
    .returning();

  if (!tenant) {
    logger.info("Demo tenant already exists, skipping seed");
    return;
  }

  logger.info({ tenantId: tenant.id }, "Created demo tenant");

  // Create sample post templates
  await db.insert(postTemplates).values([
    {
      tenantId: tenant.id,
      name: "Product Launch",
      platform: "instagram",
      contentText: "🚀 Introducing {{product_name}}! {{description}} #NewProduct #Launch",
      aiPrompt:
        "Write an exciting product launch post for {{product_name}}. Highlight key features: {{features}}. Make it engaging with appropriate emojis.",
      variables: ["product_name", "description", "features"],
    },
    {
      tenantId: tenant.id,
      name: "Weekly Promo",
      platform: "x",
      contentText: "🔥 This week only: {{discount}} off {{product_name}}! Shop now → {{link}}",
      aiPrompt:
        "Write a short, punchy promotional tweet for a {{discount}} discount on {{product_name}}. Keep under 280 chars.",
      variables: ["discount", "product_name", "link"],
    },
    {
      tenantId: tenant.id,
      name: "Behind the Scenes",
      platform: "linkedin",
      contentText:
        "At {{company_name}}, we believe in transparency. Here's a look behind the scenes of {{process}}...",
      aiPrompt:
        "Write a professional LinkedIn post about behind-the-scenes at {{company_name}}, focusing on {{process}}. Be authentic and engaging.",
      variables: ["company_name", "process"],
    },
  ]);

  logger.info("Created sample post templates");

  // Create sample campaign
  await db.insert(campaigns).values({
    tenantId: tenant.id,
    name: "Summer Sale 2026",
    description: "Multi-platform summer promotion campaign",
    startDate: new Date("2026-06-01"),
    endDate: new Date("2026-08-31"),
    status: "draft",
  });

  logger.info("Created sample campaign");
  logger.info("Seed completed successfully");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "Seed failed");
    process.exit(1);
  });
