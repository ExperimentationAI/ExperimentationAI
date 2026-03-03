import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { ModelProvider } from "../config/index.js";

export function createChatModel(
  provider: ModelProvider,
  modelName: string,
  options?: { temperature?: number; maxOutputTokens?: number }
): ChatAnthropic | ChatGoogleGenerativeAI {
  if (provider === "gemini") {
    return new ChatGoogleGenerativeAI({
      model: modelName,
      temperature: options?.temperature,
      maxOutputTokens: options?.maxOutputTokens,
    });
  }

  return new ChatAnthropic({
    model: modelName,
    temperature: options?.temperature,
    maxTokens: options?.maxOutputTokens,
  });
}
