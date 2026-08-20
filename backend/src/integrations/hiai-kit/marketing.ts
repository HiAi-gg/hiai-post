/**
 * hiai-kit marketing client — `/api/v1/marketing`.
 */
import type { HiaiKitClientConfig } from "./config.js";
import { hiaiKitJson, parseResponse } from "./http.js";
import {
  marketingAgentsEnvelopeSchema,
  marketingEngagementSchema,
  type MarketingEngagement,
  marketingPipelineInputSchema,
  type MarketingPipelineInput,
  marketingPipelineOutputSchema,
  type MarketingPipelineOutput,
  marketingTrendsEnvelopeSchema,
} from "./schemas.js";

const PREFIX = "/api/v1/marketing";

export interface MarketingTrend {
  id: number;
  topic: string;
  source: string;
  score: string | null;
  fetchedAt: string;
}

export interface MarketingAgentSummary {
  id: string;
  description: string;
  shipped: boolean;
}

export interface MarketingClient {
  listAgents(): Promise<MarketingAgentSummary[]>;
  listTrends(limit?: number): Promise<MarketingTrend[]>;
  getEngagement(topN?: number, lookbackDays?: number): Promise<MarketingEngagement>;
  runPipeline(input: MarketingPipelineInput): Promise<MarketingPipelineOutput>;
}

export function createMarketingClient(config: HiaiKitClientConfig): MarketingClient {
  return {
    async listAgents(): Promise<MarketingAgentSummary[]> {
      const path = `${PREFIX}/agents`;
      const { data, correlationId } = await hiaiKitJson(config, { path });
      const envelope = parseResponse(marketingAgentsEnvelopeSchema, data, correlationId, path);
      return envelope.agents;
    },

    async listTrends(limit = 20): Promise<MarketingTrend[]> {
      const path = `${PREFIX}/trends?limit=${encodeURIComponent(String(limit))}`;
      const { data, correlationId } = await hiaiKitJson(config, { path });
      const envelope = parseResponse(marketingTrendsEnvelopeSchema, data, correlationId, path);
      return envelope.trends;
    },

    async getEngagement(topN = 5, lookbackDays = 7): Promise<MarketingEngagement> {
      const path = `${PREFIX}/engagement?topN=${topN}&lookbackDays=${lookbackDays}`;
      const { data, correlationId } = await hiaiKitJson(config, { path });
      return parseResponse(marketingEngagementSchema, data, correlationId, path);
    },

    async runPipeline(input: MarketingPipelineInput): Promise<MarketingPipelineOutput> {
      const path = `${PREFIX}/pipeline`;
      const parsed = marketingPipelineInputSchema.safeParse(input);
      if (!parsed.success) {
        const { HiaiKitError } = await import("./errors.js");
        throw new HiaiKitError("VALIDATION_ERROR", "Invalid marketing pipeline payload", 400, { path });
      }
      const { data, correlationId } = await hiaiKitJson(config, {
        method: "POST",
        path,
        body: parsed.data,
      });
      return parseResponse(marketingPipelineOutputSchema, data, correlationId, path);
    },
  };
}
