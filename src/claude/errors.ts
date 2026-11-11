import type { CallUsage } from "./models.ts";

// Every way a Claude call can fail that the specialist needs to hear about.
// The UI maps `kind` to a message; it never shows model text as a fact.

export type ClaudeFailureKind =
  /** Claude declined the request (stop_reason "refusal"). */
  | "refusal"
  /** Output was cut off at max_tokens, so it can't be trusted. */
  | "max_tokens"
  /** Output didn't match the schema. */
  | "invalid_output"
  /** Ranking named a departure or cabin that wasn't a qualifying candidate, twice. */
  | "invalid_ids"
  /** The API itself failed after the SDK's retries. */
  | "api";

export class ClaudeCallError extends Error {
  readonly kind: ClaudeFailureKind;
  /** Calls that were billed before the failure, so cost reports stay complete. */
  readonly usage: CallUsage[];

  constructor(
    kind: ClaudeFailureKind,
    message: string,
    options?: { cause?: unknown; usage?: CallUsage[] },
  ) {
    super(message, { cause: options?.cause });
    this.name = "ClaudeCallError";
    this.kind = kind;
    this.usage = options?.usage ?? [];
  }
}
