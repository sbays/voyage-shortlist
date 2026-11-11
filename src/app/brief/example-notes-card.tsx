"use client";

import { Suspense, use } from "react";
import type { ExampleNotes } from "./example-notes";
import styles from "./brief.module.css";

interface ExampleNotesCardProps {
  /**
   * The examples, dated for the season in the database. Streamed: the
   * guidance renders at once and the buttons appear when this resolves.
   */
  examples: Promise<ExampleNotes[]>;
  /** Replaces the notes box with the chosen example. */
  onPick: (notes: string) => void;
  /** True while notes are being read, so the box can't change under the reply. */
  disabled: boolean;
}

/** What good call notes cover, and examples a visitor can load with one click. */
export function ExampleNotesCard({ examples, onPick, disabled }: ExampleNotesCardProps) {
  return (
    <section className={styles.card} aria-labelledby="examples-heading">
      <h2 id="examples-heading" className={styles.heading}>
        Before you start
      </h2>
      <p>Type the notes the way you would during a call. Claude looks for:</p>
      <ul className={styles.checklist}>
        <li>when they could travel, even roughly (&quot;mid Jan&quot;, &quot;after Christmas&quot;)</li>
        <li>the budget, and whether it&apos;s per person or for everyone</li>
        <li>how many are travelling, and for someone alone, whether they&apos;ll share a cabin</li>
        <li>any activity they insist on, such as kayaking or camping</li>
        <li>anything else that matters: seasickness, ship size, penguins, time ashore</li>
      </ul>
      <p className={styles.hint}>
        Or start from an example. It replaces whatever is in the notes box, and you can
        restore your own notes afterwards.
      </p>
      <Suspense fallback={<p className={styles.hint}>Loading examples…</p>}>
        <ExampleButtons examples={examples} onPick={onPick} disabled={disabled} />
      </Suspense>
    </section>
  );
}

function ExampleButtons({ examples, onPick, disabled }: ExampleNotesCardProps) {
  const list = use(examples);
  return (
    <ul className={styles.examples}>
      {list.map((example) => (
        <li key={example.id}>
          {/* Named by the title alone, with the summary as its description,
              so a screen reader doesn't run the two together. */}
          <button
            type="button"
            className={styles.example}
            onClick={() => onPick(example.notes)}
            disabled={disabled}
            aria-labelledby={`example-${example.id}-title`}
            aria-describedby={`example-${example.id}-shows`}
          >
            <span id={`example-${example.id}-title`} className={styles.exampleTitle}>
              {example.title}
            </span>
            <span id={`example-${example.id}-shows`} className={styles.exampleShows}>
              {example.shows}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
