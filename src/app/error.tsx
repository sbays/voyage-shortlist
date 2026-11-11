"use client";

import { useEffect } from "react";
import styles from "./error.module.css";

// The fallback when a page or a server action throws something the action
// didn't turn into an error state, such as the database being unreachable.
// Production errors from the server arrive with only a digest, so the page
// shows a plain message rather than the error text.

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const digest =
    error instanceof Error && "digest" in error && typeof error.digest === "string"
      ? error.digest
      : null;

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Something went wrong</h1>
      <p>
        The page couldn&apos;t load or finish that request. Nothing was sent to a customer. Try
        again in a moment.
      </p>
      {digest && <p className={styles.digest}>Reference: {digest}</p>}
      <button type="button" className={styles.button} onClick={() => retry()}>
        Try again
      </button>
    </main>
  );
}
