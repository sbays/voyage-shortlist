import type { Metadata } from "next";
import Link from "next/link";
import { CSV_COLUMNS } from "@/db/availability-import";
import styles from "../admin/import/import.module.css";

export const metadata: Metadata = {
  title: "Availability import · Tern & Floe",
};

const COLUMNS: { name: (typeof CSV_COLUMNS)[number]; meaning: string }[] = [
  { name: "departure_id", meaning: "an existing departure, such as dep_010" },
  { name: "cabin_category_id", meaning: "a cabin category on that departure's ship" },
  { name: "price_gbp_pp", meaning: "the per-person fare in whole pounds" },
  { name: "solo_price_gbp", meaning: "the price for one person alone in the cabin, or empty if there isn't one" },
  { name: "berths_left", meaning: "beds still free in that category" },
  { name: "updated_at", meaning: "when the operator confirmed it, as an ISO timestamp with a time zone" },
];

export default function ImportAboutPage() {
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>How availability gets in</h1>
      <p className={styles.lede}>
        Operators send availability as a CSV file. An admin uploads it, and the fares, berths
        and &quot;availability as of&quot; times update. Uploads need the demo admin token, so
        visitors can read how it works but can&apos;t change the catalogue.
      </p>

      <section className={styles.section} aria-labelledby="format-heading">
        <h2 id="format-heading" className={styles.heading}>
          The format
        </h2>
        <p>One row per fare, with this header:</p>
        <pre className={styles.code}>
          <code>{CSV_COLUMNS.join(",")}</code>
        </pre>
        <ul className={styles.list}>
          {COLUMNS.map((c) => (
            <li key={c.name}>
              <code>{c.name}</code>: {c.meaning}
            </li>
          ))}
        </ul>
        <p className={styles.hint}>
          <a href="/import/sample-availability.csv" download>
            Download a sample file
          </a>{" "}
          with real departures from the demo catalogue, stamped with the time you download it.
          It opens 4 berths on a sold-out cabin.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="rules-heading">
        <h2 id="rules-heading" className={styles.heading}>
          The rules
        </h2>
        <ul className={styles.list}>
          <li>
            All or nothing. One bad row, such as an unknown departure or negative berths, rejects
            the whole file, and every error is listed with its row number. A half-applied feed
            would leave availability inconsistent.
          </li>
          <li>An import only updates fares that already exist. It never creates departures.</li>
          <li>
            A row older than the availability already held for its departure is rejected, so an
            old or replayed file can&apos;t move &quot;availability as of&quot; backwards.
          </li>
          <li>
            Row numbers in errors match a spreadsheet, with the header as row 1.
          </li>
          <li>
            &quot;Availability as of&quot; comes from the file&apos;s <code>updated_at</code>{" "}
            values, not the upload time, because it has to mean when the operator last confirmed.
          </li>
          <li>Every upload is kept, applied or rejected, so an import can be traced to its file.</li>
          <li>
            Each night, saved briefs are checked again, and departures that newly fit appear
            under &quot;New matches&quot;.
          </li>
        </ul>
      </section>

      <p className={styles.section}>
        <Link href="/admin/import">Go to the upload page</Link> (needs the admin token).
      </p>
    </main>
  );
}
