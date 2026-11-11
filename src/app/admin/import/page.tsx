import type { Metadata } from "next";
import Link from "next/link";
import { ImportForm } from "./import-form";
import styles from "./import.module.css";

export const metadata: Metadata = {
  title: "Import availability · Tern & Floe",
  robots: { index: false, follow: false },
};

export default function AdminImportPage() {
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>
        <Link href="/import">About the import</Link>
      </p>
      <h1 className={styles.title}>Import availability</h1>
      <p className={styles.lede}>
        Upload an operator&apos;s availability file to update fares and berths. Uploads, and
        the list of recent imports, need the demo admin token.
      </p>
      <ImportForm />
    </main>
  );
}
