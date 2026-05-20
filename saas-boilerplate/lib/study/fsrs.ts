/**
 * FSRS — thin wrapper around `ts-fsrs` v5.
 *
 * Pure functions only. No DB, no I/O. Keeps the scheduler swappable and
 * unit-testable. studyService owns persistence, this owns math.
 */
import {
  createEmptyCard,
  fsrs,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
} from "ts-fsrs";

/** Public rating tokens (Anki-style). Wider product surface than ts-fsrs. */
export type ReviewRating = "again" | "hard" | "good" | "easy";

/** Public state tokens — match the `fsrs_state` enum in schema.ts. */
export type ReviewState = "new" | "learning" | "review" | "relearning";

const RATING_MAP: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

const STATE_TO_DB: Record<State, ReviewState> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};

const STATE_FROM_DB: Record<ReviewState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

/** Fields persisted on `user_card_state`. */
export interface PersistedCardState {
  state: ReviewState;
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  lastReview: Date | null;
}

/** Output of scheduling a single rating. */
export interface ScheduleOutcome {
  prevState: ReviewState;
  next: PersistedCardState;
  rating: ReviewRating;
}

const scheduler = fsrs();

/** Brand new card — first time the user sees it. */
export function emptyState(now: Date = new Date()): PersistedCardState {
  return fromFsrsCard(createEmptyCard(now));
}

/** Apply a rating to a persisted state and return the new persisted state. */
export function rate(
  current: PersistedCardState,
  rating: ReviewRating,
  now: Date = new Date(),
): ScheduleOutcome {
  const fsrsCard = toFsrsCard(current);
  const out = scheduler.next(fsrsCard, now, RATING_MAP[rating]);
  return {
    prevState: current.state,
    rating,
    next: fromFsrsCard(out.card),
  };
}

/* ------------------------------------------------------------------ */
/* Internal conversions                                                */
/* ------------------------------------------------------------------ */

function toFsrsCard(s: PersistedCardState): FsrsCard {
  return {
    due: s.due,
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsedDays,
    scheduled_days: s.scheduledDays,
    learning_steps: s.learningSteps,
    reps: s.reps,
    lapses: s.lapses,
    state: STATE_FROM_DB[s.state],
    last_review: s.lastReview ?? undefined,
  };
}

function fromFsrsCard(c: FsrsCard): PersistedCardState {
  return {
    state: STATE_TO_DB[c.state],
    due: c.due,
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    lastReview: c.last_review ?? null,
  };
}
