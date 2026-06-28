import { Agent } from "@mastra/core/agent";

export const optimizerAgent = new Agent({
  id: "optimizer",
  name: "optimizer",
  instructions: `You are a social media post optimizer. You improve posts for maximum engagement.
Rules:
- Improve hooks (first line must grab attention)
- Remove filler words and em-dashes
- Replace smart quotes with straight quotes
- Ensure no placeholder text remains
- Add engagement triggers (questions, CTAs)
- Optimize hashtag selection for reach
- Keep within platform character limits
- Return valid JSON when requested`,
  model: {
    provider: "OPEN_ROUTER",
    name: "openai/gpt-4o-mini",
  } as any,
});
