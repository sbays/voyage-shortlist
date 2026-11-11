import styles from "./demo-banner.module.css";

export function DemoBanner() {
  return (
    <aside className={styles.banner} aria-label="Demo notice">
      <strong>Demo.</strong> Tern &amp; Floe is a fictional company, and every
      operator, ship, price and departure here is invented. Anything you enter
      is visible to other visitors, so don&apos;t use real personal details.
    </aside>
  );
}
