import { api } from "$lib/api";

export interface MarketingPipelineResult {
  topic: string;
  researchUsedBrowser: boolean;
  researchSummary: string;
  draft: string;
  voiceScore: number;
  finalText: string;
  truncated: boolean;
  charsUsed: number;
  complianceOk: boolean;
  violations: Array<{ type: string; snippet: string; severity: "block" | "warn" }>;
  published: boolean;
  messageId: string | number | null;
  blockedReason: string | null;
  duplicate: boolean;
  idempotencyKey: string;
  startedAt: string;
  completedAt: string;
}

export interface MarketingTrend {
  id: number;
  topic: string;
  source: string;
  score: string | null;
  fetchedAt: string;
}

export interface MarketingEngagementItem {
  messageId: string | null;
  idempotencyKey: string;
  draftId: string | null;
  publishedAt: string;
  replyCount: number;
  viewCount: number;
}

export interface MarketingEngagement {
  generatedAt: string;
  total: number;
  top: MarketingEngagementItem[];
  lookbackDays: number;
  pulled: number;
}

export async function listTrends(limit = 20): Promise<MarketingTrend[]> {
  const res = await api.get<{ trends: MarketingTrend[] }>(`/api/v1/marketing/trends?limit=${limit}`);
  return res.trends ?? [];
}

export async function getEngagement(topN = 5): Promise<MarketingEngagement> {
  return api.get<MarketingEngagement>(`/api/v1/marketing/engagement?topN=${topN}`);
}

export async function runPipeline(input: {
  topic?: string;
  chatId: string | number;
  skipPublish: boolean;
}): Promise<MarketingPipelineResult> {
  return api.post<MarketingPipelineResult>("/api/v1/marketing/pipeline", input);
}
