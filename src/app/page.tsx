import Link from "next/link";
import { connection } from "next/server";
import { seasonStartYearInCatalogue } from "@/db/catalogue";
import { getDb } from "@/db/connection";
import { seasonStartYear } from "@/domain/season";
import { exampleNotes, type ExampleNotes } from "./brief/example-notes";
import { ShortlistBuilder } from "./brief/shortlist-builder";
import styles from "./page.module.css";

// The seed rolls the season forward, so the examples' years come from the
// catalogue at request time. Not awaited: the page shell stays prerendered
// and the example buttons stream in under their own Suspense boundary.
async function loadExamples(): Promise<ExampleNotes[]> {
  await connection();
  // Only the database read is guarded, not connection(): a rejected promise
  // would take the whole page to the error boundary, and the examples are
  // optional, so a failed read falls back to the current season.
  let year: number;
  try {
    year = await seasonStartYearInCatalogue(await getDb());
  } catch (error) {
    console.error("Couldn't read the season for the example notes", error);
    year = seasonStartYear(new Date());
  }
  return exampleNotes(year);
}

export default function Home() {
  const examples = loadExamples();
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Tern &amp; Floe · specialist tools</p>
      <h1 className={styles.title}>Voyage shortlist</h1>
      <p className={styles.lede}>
        Paste notes from a customer call, check the brief Claude reads from them, and get a
        ranked shortlist of Antarctic departures with reasons, trade-offs and a draft email.
      </p>
      <p className={styles.status}>
        Prices, dates and availability always come from the catalogue, never from Claude.{" "}
        <Link href="/departures">Browse every departure</Link>.
      </p>
      <ShortlistBuilder examples={examples} />
    </main>
  );
}
