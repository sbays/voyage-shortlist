import { CALLS_PER_IP_PER_HOUR } from "@/domain/limits";
import styles from "./demo-banner.module.css";

export function DemoBanner() {
  return (
    <aside className={styles.banner} aria-label="Demo notice">
      <strong>Demo.</strong> Tern &amp; Floe is a fictional company, and every
      operator, ship, price and departure here is invented. Saved briefs and
      anything you enter are visible to everyone, so don&apos;t use real
      personal details. Claude calls are limited to {CALLS_PER_IP_PER_HOUR} an
      hour per visitor.
    </aside>
  );
}
