import Anthropic from "@anthropic-ai/sdk";

import { AI_TOOLS, executeTool } from "./tools";

const MODEL = "claude-sonnet-4-5";
const MAX_TOOL_ROUNDS = 4;

const SYSTEM_PROMPT = `You are the AI assistant inside M.L AI Manager, a collections dashboard for an Indian wholesaler who sells on credit through Vyapar.

Rules:
- Only answer using data returned by your tools. Never invent numbers, customer names, or dates.
- Amounts are in Indian Rupees. Format them naturally (e.g. "₹52,400" or "52k" in casual replies).
- Keep answers short and to the point - this is used on a phone, mid-workday.
- If a tool returns no matching customer, say so plainly instead of guessing who they meant.`;

export type ChatMessage = { role: "user" | "assistant"; content: string };

export async function runChat(companyId: string, apiKey: string, history: ChatMessage[]): Promise<string> {
  const client = new Anthropic({ apiKey });

  const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: AI_TOOLS,
      messages,
    });

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    if (response.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
      const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
      return textBlocks.map((b) => b.text).join("\n").trim() || "I wasn't able to come up with an answer for that.";
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const result = await executeTool(companyId, block.name, (block.input as Record<string, unknown>) ?? {});
        return {
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: JSON.stringify(result),
        };
      }),
    );

    messages.push({ role: "user", content: toolResults });
  }

  return "That took more steps than expected - try asking a more specific question.";
}
