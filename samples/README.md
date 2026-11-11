# Sample availability files

Two CSV files for trying the import at `/admin/import` by hand. Both use real
IDs from the seed catalogue (IDs never change between seeds).

| File | What should happen |
| --- | --- |
| `availability-good.csv` | Applies 3 rows on `dep_078` (7 February 2027 in the generated season): opens 4 berths in the sold-out balcony cabin and 2 in the sold-out twin window cabin, leaves the triple as it is, and moves its "availability as of" to the file's time. |
| `availability-bad.csv` | Rejected as a whole, no fares change. Row 4: unknown fare `dep_999`. Row 5: negative berths. Row numbers count the header as row 1 and the blank line, as a spreadsheet does. |

The departure was chosen late in the season so it hasn't sailed (sailed departures are hidden from `/departures` and searches), and the timestamps are fixed (11 November 2026). The import refuses rows older than
the availability already stored, so once the weekly reseed or another import
has dated a departure later than that, the good file is rejected as stale. For
a file that always applies, download the generated sample from
`/import/sample-availability.csv`, which is stamped with the current time.

`src/db/availability-import.test.ts` checks both files against the generated
catalogue, so they stay correct if the seed changes.
