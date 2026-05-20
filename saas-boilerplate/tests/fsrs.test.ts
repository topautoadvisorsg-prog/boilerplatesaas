/**
 * Pure-function smoke tests for the FSRS wrapper.
 *
 *   pnpm tsx tests/fsrs.test.ts
 *
 * No DB. No env. Runs in <1s. Run this before pushing Phase 4 changes.
 */
import { emptyState, rate } from "../lib/study/fsrs";

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

console.log("FSRS wrapper smoke");

// 1) emptyState
const t0 = new Date("2026-02-01T00:00:00Z");
const s0 = emptyState(t0);
expect("emptyState.state = new", s0.state === "new");
expect("emptyState.reps = 0", s0.reps === 0);
expect("emptyState.lastReview = null", s0.lastReview === null);

// 2) First rating Good moves to learning, bumps reps, schedules a near-term review
const out1 = rate(s0, "good", new Date("2026-02-01T00:01:00Z"));
expect("first Good → next.state = learning", out1.next.state === "learning", `got ${out1.next.state}`);
expect("first Good → reps = 1", out1.next.reps === 1);
expect("first Good → prevState = new", out1.prevState === "new");
expect("first Good → due is in the future", out1.next.due.getTime() > t0.getTime());

// 3) Again should land in learning/relearning with lapses unchanged at 0 (new card)
const out2 = rate(s0, "again", new Date("2026-02-01T00:01:00Z"));
expect("first Again → next.state = learning", out2.next.state === "learning");
expect("first Again → lapses still 0 (was new)", out2.next.lapses === 0);

// 4) Easy should give a longer interval than Good
const easy = rate(s0, "easy", new Date("2026-02-01T00:01:00Z"));
expect(
  "Easy schedules further out than Good",
  easy.next.due.getTime() >= out1.next.due.getTime(),
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
