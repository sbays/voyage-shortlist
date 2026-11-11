import Anthropic from "@anthropic-ai/sdk";
import { ClaudeCallError } from "./errors.ts";

// One Anthropic client per process. The key comes from ANTHROPIC_API_KEY,
// which Cloud Run fills from Secret Manager. Both calls are short, so a
// 60 second timeout with the SDK's own 2 retries is enough.

let client: Anthropic | undefined;

export function getAnthropic(): Anthropic {
  // Fail with a clear reason, not the SDK's authentication error, when the
  // key is missing: the usual cause is a local `pnpm dev` started without it.
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ClaudeCallError("api", "ANTHROPIC_API_KEY isn't set, so Claude can't be called");
  }
  client ??= new Anthropic({ timeout: 60_000, maxRetries: 2 });
  return client;
}

/**
 * The slice of the client the calls use, so tests can pass a fake with
 * `{ messages: { parse: vi.fn() } }` instead of mocking the module.
 */
export type MessagesClient = Pick<Anthropic, "messages">;
