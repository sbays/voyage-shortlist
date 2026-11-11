import Link from "next/link";
import { ShortlistBuilder } from "./brief/shortlist-builder";
import styles from "./page.module.css";

export default function Home() {
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
      <ShortlistBuilder />
    </main>
  );
}
