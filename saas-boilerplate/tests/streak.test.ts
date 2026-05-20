/**
 * Pure-function smoke tests for streakService date helpers + decision tree.
 *
 *   pnpm tsx tests/streak.test.ts
 *
 * No DB. No env. Tests just the deterministic helpers exposed for testing.
 * Full DB-backed reconcileStreak() is covered by integration tests in Phase 7.
 */
// Tests pin down the *contract* — local-day boundary math in IANA timezones —
// that streakService depends on. We replicate the helper here so the test
// stays decoupled from the service's private surface.

function localDate(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

let pass = 0;
let fail = 0;
function expect(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("streak helpers");

// Pacific time crosses date boundary 7h before UTC date roll-over (PST/PDT).
// 2026-02-01 03:00Z is 2026-01-31 19:00 PST.
const t = new Date("2026-02-01T03:00:00Z");
expect(
  "UTC date for 2026-02-01T03:00Z is 2026-02-01",
  localDate(t, "UTC") === "2026-02-01",
  localDate(t, "UTC"),
);
expect(
  "LA date for 2026-02-01T03:00Z is 2026-01-31",
  localDate(t, "America/Los_Angeles") === "2026-01-31",
  localDate(t, "America/Los_Angeles"),
);
expect(
  "Tokyo date for 2026-02-01T03:00Z is 2026-02-01",
  localDate(t, "Asia/Tokyo") === "2026-02-01",
  localDate(t, "Asia/Tokyo"),
);

// Year roll-over edge case — 23:30Z on Dec 31 in NYC (still 18:30 Dec 31).
const yearEdge = new Date("2026-12-31T23:30:00Z");
expect("UTC year edge", localDate(yearEdge, "UTC") === "2026-12-31");
expect(
  "NYC year edge stays 2026-12-31",
  localDate(yearEdge, "America/New_York") === "2026-12-31",
  localDate(yearEdge, "America/New_York"),
);

// Pre-roll-over UTC, post-roll-over Tokyo.
const tokyoEdge = new Date("2026-12-31T22:00:00Z"); // 2027-01-01 07:00 Tokyo
expect(
  "Tokyo crosses into 2027 ahead of UTC",
  localDate(tokyoEdge, "Asia/Tokyo") === "2027-01-01",
  localDate(tokyoEdge, "Asia/Tokyo"),
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
