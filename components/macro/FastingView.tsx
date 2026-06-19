"use client";

import { useFastSessions } from "@/hooks/use-fast-sessions";
import { useFastingStatus } from "@/hooks/use-fasting-status";
import { todayKey, type FastSession } from "@/lib/db";
import {
  eatingHours,
  fastingStreak,
  formatDuration,
  protocolHours,
  type FastingProtocol,
} from "@/lib/fasting";
import {
  FASTING_PHASES,
  phaseAtHours,
  phaseBreakdownMinutes,
  streakPhaseMinutes,
  type PhaseAccent,
} from "@/lib/fasting-phases";
import {
  computeDailyTiming,
  computeDailyTimingInsights,
  type TimingInsightTone,
} from "@/lib/timing-insights";
import { cn } from "@/lib/utils";
import {
  ChevronRight,
  Hourglass,
  Info,
  Play,
  Trash2,
  Utensils,
} from "lucide-react";
import type { ViewKey } from "../shell/Sidebar";
import { Button } from "../ui/button";

/** Static accent classes per phase (Tailwind needs literal class names). */
const ACCENT: Record<PhaseAccent, { bar: string; dot: string; text: string }> =
  {
    amber: {
      bar: "bg-amber-400",
      dot: "bg-amber-400",
      text: "text-amber-600 dark:text-amber-400",
    },
    yellow: {
      bar: "bg-yellow-400",
      dot: "bg-yellow-400",
      text: "text-yellow-600 dark:text-yellow-400",
    },
    lime: {
      bar: "bg-lime-400",
      dot: "bg-lime-400",
      text: "text-lime-600 dark:text-lime-400",
    },
    teal: {
      bar: "bg-teal-400",
      dot: "bg-teal-400",
      text: "text-teal-600 dark:text-teal-400",
    },
    sky: {
      bar: "bg-sky-400",
      dot: "bg-sky-400",
      text: "text-sky-600 dark:text-sky-400",
    },
    indigo: {
      bar: "bg-indigo-500",
      dot: "bg-indigo-500",
      text: "text-indigo-600 dark:text-indigo-400",
    },
  };

/** Dot colour per timing-insight tone. */
const TONE_DOT: Record<TimingInsightTone, string> = {
  warn: "bg-amber-500",
  info: "bg-muted-foreground",
  good: "bg-emerald-500",
};

const PROTOCOL_META: Record<
  FastingProtocol,
  { label: string; blurb: string; difficulty: string }
> = {
  "16:8": {
    label: "16:8",
    blurb:
      "Skip breakfast, eat within 8 hours. The most popular starting point.",
    difficulty: "Gentle",
  },
  "18:6": {
    label: "18:6",
    blurb: "A tighter 6-hour window — a step up once 16:8 feels easy.",
    difficulty: "Moderate",
  },
  "20:4": {
    label: "20:4",
    blurb:
      "One short 4-hour window (the “Warrior” style). For the experienced.",
    difficulty: "Advanced",
  },
  custom: {
    label: "Custom",
    blurb: "Set your own fasting hours from the day-view fasting card.",
    difficulty: "Your call",
  },
};

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Local calendar-date label — "Jun 3". */
function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function FastingView({
  onSelectView,
}: {
  onSelectView?: (key: ViewKey) => void;
}) {
  const {
    status,
    fasting,
    fastingHours,
    logs,
    isHydrated,
    startFast,
    updateFasting,
  } = useFastingStatus();

  if (!isHydrated) return null;

  const enabled = !!fasting?.enabled;
  const elapsedHours = status.elapsedMin / 60;
  const currentPhase =
    status.phase === "none" ? null : phaseAtHours(elapsedHours);
  const eatHrs = eatingHours(fasting);
  const streak = fastingStreak(logs, todayKey(), eatHrs);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Hero */}
      <header className="space-y-3">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          <Hourglass className="h-6 w-6 text-brand" />
          Intermittent fasting
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Intermittent fasting (IF) is simply <em>when</em> you eat, not what.
          You confine eating to a daily window and fast the rest — giving
          insulin time to fall and your body time to move from burning the meal
          you just ate to burning stored energy. Below: what happens
          hour-by-hour, how the intervals differ, and where your current fast
          sits.
        </p>

        {enabled ? (
          <div className="flex flex-wrap items-center gap-2">
            {currentPhase ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1 text-sm font-medium",
                  ACCENT[currentPhase.accent].text,
                )}
              >
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    ACCENT[currentPhase.accent].dot,
                  )}
                />
                {currentPhase.name}
              </span>
            ) : null}
            {status.phase === "none" ? (
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => void startFast()}
              >
                <Play className="h-3.5 w-3.5" />
                Start fast now
              </Button>
            ) : (
              <span className="font-mono text-sm tabular-nums text-muted-foreground">
                {status.phase === "fasting" ? (
                  <>
                    Eating window opens in {formatDuration(status.remainingMin)}
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                    <Utensils className="h-3.5 w-3.5" />
                    Eating window open
                  </span>
                )}
              </span>
            )}
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            className="h-9 gap-1.5"
            onClick={() =>
              void updateFasting({ enabled: true, protocol: "16:8" })
            }
          >
            <Play className="h-4 w-4" />
            Start tracking 16:8
          </Button>
        )}
      </header>

      {/* Disclaimer */}
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-50/60 px-4 py-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <strong>Not medical advice.</strong> The phase timings below are
          approximate, drawn from popular protocols rather than settled clinical
          fact — what actually happens, and when, varies a lot by person,
          metabolism, activity, and your last meal. Don&apos;t fast if
          you&apos;re pregnant or breastfeeding, have a history of disordered
          eating, or manage a condition like diabetes without first talking to a
          qualified professional.
        </p>
      </div>

      {/* Live phase indicator */}
      <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
        <header className="border-b border-border/60 px-5 py-3">
          <h2 className="text-sm font-semibold tracking-tight">
            Your fast right now
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {enabled
              ? "Where your current fast sits on the phase timeline."
              : "Enable fasting above to track your live position."}
          </p>
        </header>
        <div className="px-5 py-6">
          <PhaseTimeline
            fastingHours={fastingHours}
            elapsedHours={status.phase === "none" ? null : elapsedHours}
          />
          {currentPhase && (
            <div className="mt-5 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    ACCENT[currentPhase.accent].dot,
                  )}
                />
                {currentPhase.name}
                <span className="font-mono text-xs font-normal tabular-nums text-muted-foreground">
                  · {formatDuration(status.elapsedMin)} in
                  {status.fastStartedAt !== null && (
                    <> · since {clock(status.fastStartedAt)}</>
                  )}
                </span>
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {currentPhase.detail}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Today's eating window — first/last meal, length, + timing insights.
          Renders only once a meal has been logged with a time today. */}
      {(() => {
        const todayLog = logs.find((l) => l.date === todayKey());
        if (!todayLog) return null;
        const timing = computeDailyTiming(todayLog.meals);
        if (!timing) return null;
        const insights = computeDailyTimingInsights({
          meals: todayLog.meals,
          // Only score against a window target when the user actually fasts.
          eatingHoursTarget: enabled ? eatHrs : undefined,
        });
        return (
          <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
            <header className="border-b border-border/60 px-5 py-3">
              <h2 className="text-sm font-semibold tracking-tight">
                Today&apos;s eating window
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                When you actually ate, from your logged meal times.
              </p>
            </header>
            <div className="space-y-3 px-5 py-4">
              <div className="flex flex-wrap gap-x-8 gap-y-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    First meal
                  </p>
                  <p className="font-mono text-base tabular-nums">
                    {clock(timing.window.firstAt)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Last meal
                  </p>
                  <p className="font-mono text-base tabular-nums">
                    {clock(timing.window.lastAt)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Window
                  </p>
                  <p className="font-mono text-base tabular-nums">
                    {formatDuration(timing.window.lengthMin)}
                  </p>
                </div>
              </div>
              {insights.length > 0 && (
                <ul className="space-y-1.5 border-t border-border/60 pt-3">
                  {insights.map((ins) => (
                    <li
                      key={ins.title}
                      className="flex items-start gap-2 text-sm"
                    >
                      <span
                        className={cn(
                          "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                          TONE_DOT[ins.tone],
                        )}
                      />
                      <span>
                        <span className="font-medium text-foreground">
                          {ins.title}
                        </span>
                        {" — "}
                        <span className="text-muted-foreground">
                          {ins.detail}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        );
      })()}

      {/* Protocol comparison */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">
            Pick your interval
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A longer fast reaches deeper phases but is harder to hold. Tap one
            to set it.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(PROTOCOL_META) as FastingProtocol[]).map((p) => {
            const meta = PROTOCOL_META[p];
            const hrs =
              p === "custom"
                ? protocolHours(fasting)
                : protocolHours({ enabled: true, protocol: p });
            const active = enabled && fasting?.protocol === p;
            const reaches = phaseAtHours(p === "custom" ? hrs : hrs - 0.01);
            return (
              <button
                key={p}
                type="button"
                onClick={() =>
                  void updateFasting({ enabled: true, protocol: p })
                }
                aria-pressed={active}
                className={cn(
                  "flex h-full flex-col items-start gap-1.5 rounded-xl border bg-card px-4 py-3 text-left transition-colors",
                  active
                    ? "border-brand ring-1 ring-brand"
                    : "border-border/60 hover:bg-accent/40",
                )}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-base font-semibold">{meta.label}</span>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {meta.difficulty}
                  </span>
                </div>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {p === "custom"
                    ? `${hrs}h fast`
                    : `${hrs}h fast · ${24 - hrs}h eat`}
                </span>
                <span className="text-xs leading-relaxed text-muted-foreground">
                  {meta.blurb}
                </span>
                <span
                  className={cn(
                    "mt-auto inline-flex items-center gap-1 pt-1 text-[11px] font-medium",
                    ACCENT[reaches.accent].text,
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      ACCENT[reaches.accent].dot,
                    )}
                  />
                  Reaches {reaches.name}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Phases explained */}
      <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
        <header className="border-b border-border/60 px-5 py-3">
          <h2 className="text-sm font-semibold tracking-tight">
            What happens, hour by hour
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            The stages a fast is generally described as moving through. Timings
            are approximate.
          </p>
        </header>
        <ul className="divide-y divide-border/60">
          {FASTING_PHASES.map((phase) => (
            <li
              key={phase.key}
              className="flex gap-3 px-5 py-3.5"
            >
              <span
                className={cn(
                  "mt-1 h-2.5 w-2.5 shrink-0 rounded-full",
                  ACCENT[phase.accent].dot,
                )}
              />
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
                  {phase.name}
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {phase.endHour === null
                      ? `${phase.startHour}h+`
                      : `${phase.startHour}–${phase.endHour}h`}
                  </span>
                </p>
                <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                  {phase.detail}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Streak phase breakdown */}
      <StreakPhases
        logs={logs}
        eatHrs={eatHrs}
        status={status}
        streakDays={streak.current}
      />

      {/* Completed-fast archive */}
      <FastingHistory />

      {/* FAQ */}
      <section>
        <h2 className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Common questions
        </h2>
        <div className="mt-3 divide-y divide-border/60 rounded-xl border border-border/60 bg-card">
          <Faq title="Which interval should I pick?">
            Start at <strong>16:8</strong> — it&apos;s the gentlest and the
            easiest to keep. Once a 16-hour fast feels routine, you can tighten
            the window. Longer isn&apos;t automatically better; the best
            protocol is the one you can hold consistently.
          </Faq>
          <Faq title="Does what I eat in the window matter?">
            Yes. Fasting controls timing, not nutrition — you still need to hit
            your calorie and protein targets within the window. A short eating
            window can make it harder to fit enough protein in, so plan it.
          </Faq>
          <Faq title="Who should not fast?">
            Skip IF (or clear it with a clinician first) if you&apos;re pregnant
            or breastfeeding, are under 18, have a history of disordered eating,
            are underweight, or take medications that depend on food timing
            (e.g. insulin or some diabetes drugs).
          </Faq>
          <Faq title="What can I have while fasting?">
            Water, black coffee, and plain tea are generally considered fine and
            won&apos;t meaningfully break a fast for these purposes. Anything
            with calories starts the clock over — which is exactly how the timer
            here treats a logged food.
          </Faq>
        </div>
      </section>

      {onSelectView && (
        <div className="flex justify-center pb-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => onSelectView("plan")}
          >
            <Utensils className="h-4 w-4" />
            Log your meals
          </Button>
        </div>
      )}
    </div>
  );
}

/** A segmented bar across `[0, displayMax]h`, one colored segment per phase,
 *  with a live "now" marker and a tick where the chosen fast ends. */
function PhaseTimeline({
  fastingHours,
  elapsedHours,
}: {
  fastingHours: number;
  elapsedHours: number | null;
}) {
  const displayMax = Math.max(28, Math.ceil(fastingHours) + 1);
  const pct = (h: number) =>
    `${Math.min(100, Math.max(0, (h / displayMax) * 100))}%`;

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="flex h-3 overflow-hidden rounded-full">
          {FASTING_PHASES.map((phase) => {
            const end = phase.endHour ?? displayMax;
            const widthPct =
              ((Math.min(end, displayMax) - phase.startHour) / displayMax) *
              100;
            if (widthPct <= 0) return null;
            return (
              <div
                key={phase.key}
                className={ACCENT[phase.accent].bar}
                style={{ width: `${widthPct}%` }}
                title={`${phase.name} (${phase.startHour}${
                  phase.endHour === null ? "h+" : `–${phase.endHour}h`
                })`}
              />
            );
          })}
        </div>

        {/* Fast-end tick (eating window opens). */}
        <div
          className="absolute -bottom-1 top-[-0.25rem] w-px bg-foreground/50"
          style={{ left: pct(fastingHours) }}
          aria-hidden
        />

        {/* Live "now" marker. */}
        {elapsedHours !== null && (
          <div
            className="absolute -top-1.5 h-6 w-1 -translate-x-1/2 rounded-full bg-foreground shadow ring-2 ring-background"
            style={{ left: pct(elapsedHours) }}
            aria-hidden
          />
        )}
      </div>

      {/* Scale labels. */}
      <div className="flex justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
        <span>0h</span>
        <span>12h</span>
        <span>{displayMax}h</span>
      </div>

      {/* Legend. */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {FASTING_PHASES.map((phase) => (
          <span
            key={phase.key}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
          >
            <span
              className={cn("h-2 w-2 rounded-full", ACCENT[phase.accent].dot)}
            />
            {phase.name}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Per-phase hours accumulated across the current streak — a stacked bar +
 *  legend. Hidden until there's a streak with timed fasts. */
function StreakPhases({
  logs,
  eatHrs,
  status,
  streakDays,
}: {
  logs: ReturnType<typeof useFastingStatus>["logs"];
  eatHrs: number;
  status: ReturnType<typeof useFastingStatus>["status"];
  streakDays: number;
}) {
  const totals = streakPhaseMinutes({
    logs,
    today: todayKey(),
    eatingHrs: eatHrs,
    status,
  });
  const grandTotal = FASTING_PHASES.reduce((s, p) => s + totals[p.key], 0);

  if (streakDays === 0 || grandTotal <= 0) {
    return (
      <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
        <header className="border-b border-border/60 px-5 py-3">
          <h2 className="text-sm font-semibold tracking-tight">
            Your streak phases
          </h2>
        </header>
        <div className="px-5 py-6">
          <p className="text-sm text-muted-foreground">
            Log meals as you eat them and keep your eating window inside your
            protocol — your fasting hours will start stacking up across phases
            here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <header className="flex flex-col gap-1 border-b border-border/60 px-5 py-3 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="text-sm font-semibold tracking-tight">
          Your streak phases
        </h2>
        <p className="text-xs text-muted-foreground">
          {streakDays}-day streak · {formatDuration(grandTotal)} fasted
        </p>
      </header>
      <div className="space-y-3 px-5 py-6">
        <div className="flex h-3 overflow-hidden rounded-full bg-muted">
          {FASTING_PHASES.map((phase) => {
            const w = (totals[phase.key] / grandTotal) * 100;
            if (w <= 0) return null;
            return (
              <div
                key={phase.key}
                className={ACCENT[phase.accent].bar}
                style={{ width: `${w}%` }}
                title={`${phase.name}: ${formatDuration(totals[phase.key])}`}
              />
            );
          })}
        </div>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {FASTING_PHASES.filter((p) => totals[p.key] > 0).map((phase) => (
            <li
              key={phase.key}
              className="flex items-center gap-1.5 text-xs"
            >
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  ACCENT[phase.accent].dot,
                )}
              />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {phase.name}
              </span>
              <span className="font-mono tabular-nums text-foreground">
                {formatDuration(totals[phase.key])}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** The completed-fast archive — every fast recorded on Stop / auto-finalize,
 *  newest first, each with its duration, protocol target, the deepest phase it
 *  reached, and a per-phase breakdown bar. Self-loads via `useFastSessions`;
 *  hidden until there's at least one fast (the streak card above already
 *  carries the empty state, so a second empty card would just be noise). */
function FastingHistory() {
  const { sessions, remove } = useFastSessions();

  if (!sessions || sessions.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-border/60 bg-card">
      <header className="flex flex-col gap-1 border-b border-border/60 px-5 py-3 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="text-sm font-semibold tracking-tight">
          Fasting history
        </h2>
        <p className="text-xs text-muted-foreground">
          {sessions.length} completed {sessions.length === 1 ? "fast" : "fasts"}
        </p>
      </header>
      <ul className="divide-y divide-border/60">
        {sessions.map((session) => (
          <FastingHistoryRow
            key={session.id}
            session={session}
            onDelete={() => void remove(session.id)}
          />
        ))}
      </ul>
    </section>
  );
}

/** One archived fast: headline duration + deepest phase reached, a context
 *  line (date · window · target), a delete control, and a per-phase bar that
 *  reuses the live timeline's phase colors. */
function FastingHistoryRow({
  session,
  onDelete,
}: {
  session: FastSession;
  onDelete: () => void;
}) {
  const durationMin = Math.max(
    0,
    Math.round((session.endedAt - session.startedAt) / 60_000),
  );
  const breakdown = phaseBreakdownMinutes(durationMin);
  // The deepest phase the fast actually spent time in — matches the bar's last
  // segment. Not `phaseAtHours`, which would name a band the fast only just
  // touched at its exact boundary (e.g. a clean 16h fast spends 0 min *in*
  // ketosis, so "Reached Fat burning" is the honest headline).
  const reached =
    [...FASTING_PHASES].reverse().find((p) => breakdown[p.key] > 0) ??
    FASTING_PHASES[0];
  const targetLabel =
    session.protocol === "custom"
      ? `${session.targetHours}h`
      : session.protocol;

  return (
    <li className="px-5 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
            <span className="font-mono tabular-nums">
              {formatDuration(durationMin)}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs font-normal",
                ACCENT[reached.accent].text,
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  ACCENT[reached.accent].dot,
                )}
              />
              Reached {reached.name}
            </span>
          </p>
          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
            {dayLabel(session.startedAt)} · {clock(session.startedAt)}–
            {clock(session.endedAt)} · {targetLabel} target
          </p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete this fast"
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted">
        {FASTING_PHASES.map((phase) => {
          const w =
            durationMin > 0 ? (breakdown[phase.key] / durationMin) * 100 : 0;
          if (w <= 0) return null;
          return (
            <div
              key={phase.key}
              className={ACCENT[phase.accent].bar}
              style={{ width: `${w}%` }}
              title={`${phase.name}: ${formatDuration(breakdown[phase.key])}`}
            />
          );
        })}
      </div>
    </li>
  );
}

/** Expandable FAQ row (pure `<details>`, mirrors the Help page's Topic). */
function Faq({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group px-4 py-3 [&_summary::-webkit-details-marker]:hidden sm:px-5">
      <summary className="flex cursor-pointer list-none items-center gap-3">
        <span className="flex-1 text-sm font-medium tracking-tight">
          {title}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <div className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </details>
  );
}
