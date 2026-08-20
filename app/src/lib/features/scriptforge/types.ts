export type SupportedLanguage =
  | "ru"
  | "en"
  | "es"
  | "de"
  | "fr"
  | "it"
  | "pt"
  | "zh"
  | "ja"
  | "ko"
  | "ar"
  | "hi"
  | "uk"
  | "pl"
  | "tr"
  | "kk";

export type VideoDuration = 15 | 30 | 45 | 60 | 90;
export type PipelineMode = "auto" | "manual";

export type PipelineStageId =
  | "research"
  | "generate_topics"
  | "select_topics"
  | "narrative_facts"
  | "outline"
  | "generate_script"
  | "macro_critique"
  | "micro_critique"
  | "opinion"
  | "polish"
  | "cold_read";

export interface PipelineStage {
  id: PipelineStageId;
  label: string;
  status: "pending" | "active" | "completed" | "error";
  progress: number;
  message: string;
}

export interface TopicIdea {
  id: string;
  title: string;
  angle?: string;
  description?: string;
  hookVariants?: string[];
  viralPotential?: number;
  targetEmotion?: string;
  difficulty?: "easy" | "medium" | "hard";
  selectedHook?: string;
}

export interface ScriptSegment {
  timestamp?: string;
  visual?: string;
  audio?: string;
  text?: string;
  isOpinion?: boolean;
}

export interface ScriptDraft {
  id?: string;
  title?: string;
  duration?: number;
  language?: string;
  hook?: string;
  segments?: ScriptSegment[];
  cta?: string;
  metadata?: {
    wordCount?: number;
    estimatedDuration?: number;
    readingPace?: number;
    modelUsed?: string;
    polishModelUsed?: string;
  };
}

export interface CritiqueCheckItem {
  id: number;
  category: string;
  passed: boolean;
  score: number;
  feedback: string;
  suggestion: string;
}

export interface CritiqueResult {
  overallScore: number;
  checks?: CritiqueCheckItem[];
  issues?: Array<{
    id?: number;
    category?: string;
    problem?: string;
    suggestion?: string;
    priority?: string;
  }>;
  summary: string;
  prioritizedFixes?: string[];
  strengths?: string[];
  weaknesses?: string[];
  modelUsed?: string;
}

export interface ColdReadResult {
  issues: unknown[];
  overallVerdict: string;
  summary: string;
}

export interface PipelineResults {
  research?: unknown;
  topics?: TopicIdea[];
  selectedTopics?: TopicIdea[];
  scripts?: ScriptDraft[];
  script?: ScriptDraft;
  macroCritique?: CritiqueResult;
  microCritique?: CritiqueResult;
  macroCritiques?: CritiqueResult[];
  microCritiques?: CritiqueResult[];
  finalScript?: ScriptDraft;
  finalScripts?: ScriptDraft[];
  coldRead?: ColdReadResult;
  coldReads?: ColdReadResult[];
}

export interface PipelineState {
  isRunning: boolean;
  currentStage: PipelineStageId | null;
  stages: PipelineStage[];
  progress: Record<string, number>;
  messages: Record<string, string>;
  error: string | null;
  results: PipelineResults;
}

export interface ScriptforgeRunSummary {
  runId: string;
  query: string;
  createdAt: string;
  updatedAt: string;
  topicCount: number;
  draftCount: number;
  finalCount: number;
}

export interface ScriptforgeRunRecord {
  query?: string;
  topics?: TopicIdea[];
  research?: unknown;
  scripts?: ScriptDraft[];
  finalScripts?: ScriptDraft[];
  macroCritiques?: CritiqueResult[];
  microCritiques?: CritiqueResult[];
  createdAt?: string;
  updatedAt?: string;
}
