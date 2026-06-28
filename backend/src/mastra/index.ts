import { Mastra } from "@mastra/core";
import { optimizerAgent } from "./agents/optimizer.js";
import { writerAgent } from "./agents/writer.js";
import { contentGenerateWorkflow } from "./workflows/content-generate.js";

export function createMastra(): Mastra {
  const mastra = new Mastra({
    workflows: {
      "content-generate": contentGenerateWorkflow,
    },
    agents: {
      writer: writerAgent,
      optimizer: optimizerAgent,
    },
  });
  return mastra;
}

let mastraInstance: Mastra | null = null;

export function getMastra(): Mastra {
  if (!mastraInstance) {
    mastraInstance = createMastra();
  }
  return mastraInstance;
}
