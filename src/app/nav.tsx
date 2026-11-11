"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import styles from "./nav.module.css";

const LINKS = [
  { href: "/", label: "New shortlist" },
  { href: "/briefs", label: "Saved briefs" },
  { href: "/departures", label: "Departures" },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The site navigation. usePathname suspends while prerendering a route with
 * an unknown param (/briefs/[id]), so the fallback is the same links with no
 * current page marked, and the rest of the layout still prerenders.
 */
export function SiteNav() {
  return (
    <Suspense fallback={<NavLinks pathname={null} />}>
      <CurrentNavLinks />
    </Suspense>
  );
}

function CurrentNavLinks() {
  return <NavLinks pathname={usePathname()} />;
}

function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav className={styles.nav} aria-label="Main">
      <span className={styles.brand}>Tern &amp; Floe</span>
      <ul className={styles.links}>
        {LINKS.map(({ href, label }) => (
          <li key={href}>
            <Link
              href={href}
              className={styles.link}
              aria-current={pathname !== null && isCurrent(pathname, href) ? "page" : undefined}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
