import Anthropic from "@anthropic-ai/sdk";

// One Anthropic client per process. The key comes from ANTHROPIC_API_KEY,
// which Cloud Run fills from Secret Manager. Both calls are short, so a
// 60 second timeout with the SDK's own 2 retries is enough.

let client: Anthropic | undefined;

export function getAnthropic(): Anthropic {
  client ??= new Anthropic({ timeout: 60_000, maxRetries: 2 });
  return client;
}

/**
 * The slice of the client the calls use, so tests can pass a fake with
 * `{ messages: { parse: vi.fn() } }` instead of mocking the module.
 */
export type MessagesClient = Pick<Anthropic, "messages">;
