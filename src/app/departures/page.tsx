import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { listDepartures } from "@/db/catalogue";
import { getDb } from "@/db/connection";
import { formatDate, formatTimestamp } from "@/lib/dates";
import { formatGbp } from "@/lib/money";
import { routeLabel } from "@/lib/routes";
import styles from "./departures.module.css";

export const metadata: Metadata = {
  title: "Departures · Tern & Floe",
};

export default function DeparturesPage() {
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>
        <Link href="/">Voyage shortlist</Link>
      </p>
      <h1 className={styles.title}>Departures</h1>
      <p className={styles.lede}>
        Every sailing in the 2026–27 season, earliest first. Prices are per
        person in the cheapest cabin with berths left. All operators, ships and
        prices are invented.
      </p>
      <Suspense fallback={<p className={styles.loading}>Loading departures…</p>}>
        <DepartureTable />
      </Suspense>
    </main>
  );
}

// Availability changes, so this always reads the database at request time.
async function DepartureTable() {
  await connection();
  const departures = await listDepartures(await getDb());

  if (departures.length === 0) {
    return <p className={styles.loading}>No departures yet. Run the seed to load the catalogue.</p>;
  }

  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <caption className={styles.caption}>
          {departures.length} departures. Berths left counts beds across every
          cabin category.
        </caption>
        <thead>
          <tr>
            <th scope="col">Dates</th>
            <th scope="col">Voyage</th>
            <th scope="col">Ship</th>
            <th scope="col" className={styles.number}>
              From
            </th>
            <th scope="col" className={styles.number}>
              Berths left
            </th>
            <th scope="col">Activities</th>
          </tr>
        </thead>
        <tbody>
          {departures.map((d) => (
            <tr key={d.departureId}>
              <td>
                <span className={styles.nowrap}>{formatDate(d.startDate)}</span> to{" "}
                <span className={styles.nowrap}>{formatDate(d.endDate)}</span>
                <span className={styles.detail}>{d.departureId}</span>
              </td>
              <td>
                {d.voyageName}
                <span className={styles.detail}>
                  {routeLabel(d.route)}, {d.nights} nights from {d.embarkPort}
                </span>
              </td>
              <td>
                {d.shipName}
                <span className={styles.detail}>
                  {d.operatorName}, {d.passengerCapacity} passengers
                </span>
              </td>
              <td className={styles.number}>
                {d.fromPerPersonGbp === null ? "Sold out" : formatGbp(d.fromPerPersonGbp)}
              </td>
              <td className={styles.number}>
                {d.berthsLeft}
                <span className={styles.detail}>
                  as of {formatTimestamp(d.availabilityUpdatedAt)}
                </span>
              </td>
              <td>{d.activityNames.length > 0 ? d.activityNames.join(", ") : "None"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
