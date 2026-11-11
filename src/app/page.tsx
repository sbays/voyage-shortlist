import Link from "next/link";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Tern &amp; Floe · specialist tools</p>
      <h1 className={styles.title}>Voyage shortlist</h1>
      <p className={styles.lede}>
        Paste notes from a customer call and get a ranked shortlist of
        Antarctic departures, with reasons, trade-offs and a draft email.
      </p>
      <p className={styles.status}>
        Under construction: the voyage catalogue is in, and the shortlisting
        arrives in the next phases. Meanwhile, <Link href="/departures">browse
        the departures</Link>.
      </p>
    </main>
  );
}
