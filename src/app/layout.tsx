import type { Metadata } from "next";
import { DemoBanner } from "./demo-banner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voyage shortlist · Tern & Floe",
  description:
    "Internal tool for Tern & Floe specialists: turn call notes into a ranked shortlist of Antarctic departures. All data is invented.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB">
      <body>
        <DemoBanner />
        {children}
      </body>
    </html>
  );
}
