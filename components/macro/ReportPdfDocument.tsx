import { APP_VERSION } from "@/lib/version";
import "server-only";
import {
  Circle,
  Document,
  Line,
  Page,
  Path,
  Polyline,
  Rect,
  StyleSheet,
  Svg,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";

/** Vector PDF rendering of the progress report — server-only.
 *
 *  @react-pdf/renderer pulls a ~1.4 MB WASM layout engine (yoga), so it must
 *  never reach the client bundle: `import "server-only"` enforces that, and the
 *  sole entry point — `renderReportPdfBuffer` — is called from the
 *  `/api/report/pdf` route. The browser POSTs a {@link ReportPdfModel} and gets
 *  the rendered PDF back.
 *
 *  Pure presentation: every number arrives pre-formatted as a string in the
 *  model (the caller owns units + derivations, which it shares with the
 *  on-screen report), so the only computation here is chart geometry, drawn
 *  with react-pdf's SVG primitives. */

type Stat = { label: string; value: string; sub?: string };

/** Pre-scaled chart series. `x` is a day index, `y` the value in display
 *  units; `targetY` draws a dashed reference line. The component scales it. */
export type ChartData = {
  points: { x: number; y: number }[];
  targetY?: number;
};

export type ReportPdfModel = {
  title: string;
  note: string;
  days: number;
  generatedOn: string;
  /** Compact "Female · 32y · 168 cm · Moderate · Lose" context, or null. */
  profileLine: string | null;
  /** Section keys to render. */
  sections: string[];
  summary: { stats: Stat[]; weightDelta: string | null } | null;
  targets: { stats: Stat[] } | null;
  trends: { title: string; body: string }[] | null;
  weight: { stats: Stat[]; chart: ChartData | null } | null;
  body: { stats: Stat[]; notes: string | null } | null;
  bloodPressure: {
    stats: Stat[];
    rows: { date: string; reading: string; pulse: string; category: string }[];
  } | null;
  hydration: { stats: Stat[]; chart: ChartData | null } | null;
  calories: { stats: Stat[]; chart: ChartData | null } | null;
  fasting: { enabled: boolean; stats: Stat[] } | null;
  micronutrients: { caption: string; rows: MicroRow[] } | null;
};

type MicroRow = {
  label: string;
  value: string;
  pct: number;
  hasValue: boolean;
};

const C = {
  ink: "#18181b",
  muted: "#6b7280",
  faint: "#9ca3af",
  line: "#e5e7eb",
  track: "#f1f1f4",
  brand: "#7c3aed",
  brandSoft: "#ede9fe",
};

const styles = StyleSheet.create({
  // No page-level lineHeight: a global multiplier on the large title shifts its
  // baseline and overlaps the line below it. lineHeight is set per text block.
  page: {
    paddingVertical: 40,
    paddingHorizontal: 48,
    paddingBottom: 56,
    fontSize: 10,
    color: C.ink,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  lockup: { flexDirection: "row", alignItems: "center" },
  wordmark: {
    marginLeft: 6,
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: 1,
    color: C.ink,
  },
  headerMeta: { fontSize: 8, color: C.faint, letterSpacing: 0.5 },
  title: { fontSize: 23, lineHeight: 1.15, marginBottom: 5 },
  meta: { fontSize: 9, color: C.muted },
  profileLine: { fontSize: 9, color: C.muted, marginTop: 3 },
  note: {
    marginTop: 14,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderLeftWidth: 2,
    borderLeftColor: C.brand,
    backgroundColor: "#faf5ff",
    fontSize: 10,
    lineHeight: 1.45,
  },
  brandRule: {
    height: 2,
    backgroundColor: C.brand,
    width: 40,
    marginTop: 16,
    marginBottom: 4,
  },
  section: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 5,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 11,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  sectionDot: {
    width: 5,
    height: 5,
    borderRadius: 1,
    backgroundColor: C.brand,
    marginRight: 6,
  },
  sectionTitle: { fontSize: 9, letterSpacing: 1, color: C.muted },
  statRow: { flexDirection: "row", flexWrap: "wrap" },
  stat: { width: "33%", marginBottom: 8, paddingRight: 10 },
  statLabel: { fontSize: 7, letterSpacing: 0.5, color: C.faint },
  statValue: { fontSize: 14, marginTop: 2 },
  statSub: { fontSize: 7.5, color: C.muted, marginTop: 2 },
  empty: { fontSize: 10, color: C.muted },
  para: { fontSize: 9.5, color: C.muted, marginTop: 5, lineHeight: 1.45 },
  chartWrap: { marginTop: 6 },
  // Trends
  trendItem: { marginBottom: 8 },
  trendTitle: { fontSize: 9.5, fontWeight: 700, marginBottom: 1 },
  trendBody: { fontSize: 9.5, color: C.muted, lineHeight: 1.45 },
  // BP table
  th: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: C.line,
    paddingBottom: 3,
    marginBottom: 2,
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: C.line,
    paddingVertical: 3,
  },
  thText: { fontSize: 7, letterSpacing: 0.5, color: C.faint },
  tdText: { fontSize: 9 },
  colDate: { width: "26%" },
  colReading: { width: "26%" },
  colPulse: { width: "18%" },
  colCat: { width: "30%" },
  // Micronutrients
  microRow: { marginBottom: 7 },
  microHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  microLabel: { fontSize: 9 },
  microValue: { fontSize: 8, color: C.muted },
  microNoData: { fontSize: 8, color: C.faint },
  microTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: C.track,
    overflow: "hidden",
  },
  microFill: { height: 4, borderRadius: 2, backgroundColor: C.brand },
  caption: { fontSize: 8, color: C.muted, marginBottom: 8, lineHeight: 1.4 },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 48,
    right: 48,
    fontSize: 7.5,
    color: C.faint,
    lineHeight: 1.4,
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingTop: 7,
  },
  pageNum: {
    position: "absolute",
    bottom: 14,
    right: 48,
    fontSize: 7.5,
    color: C.faint,
  },
});

function LogoLockup() {
  return (
    <View style={styles.lockup}>
      <Svg
        viewBox="0 0 64 74"
        width={14}
        height={16}
      >
        <Rect
          x={10}
          y={14}
          width={8}
          height={56}
          fill={C.brand}
        />
        <Rect
          x={42}
          y={14}
          width={8}
          height={42}
          fill={C.brand}
        />
        <Rect
          x={10}
          y={48}
          width={40}
          height={8}
          fill={C.brand}
        />
        <Circle
          cx={58}
          cy={10}
          r={3}
          fill={C.brand}
        />
      </Svg>
      <Text style={styles.wordmark}>maqro</Text>
    </View>
  );
}

/** Single-series line chart with a soft area fill — mirrors the on-screen
 *  `MiniLineChart` (+ optional dashed target line), drawn with react-pdf SVG. */
function Chart({
  data,
  width = 474,
  height = 116,
}: {
  data: ChartData;
  width?: number;
  height?: number;
}) {
  const { points, targetY } = data;
  if (points.length === 0) return null;
  const padX = 2;
  const padT = 10;
  const padB = 6;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const candidateYs = targetY !== undefined ? [...ys, targetY] : ys;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  let minY = Math.min(...candidateYs);
  let maxY = Math.max(...candidateYs);
  const spanPad = (maxY - minY) * 0.12 || Math.max(1, Math.abs(maxY) * 0.05);
  minY -= spanPad;
  maxY += spanPad;
  const baseY = height - padB;
  const sx = (x: number) =>
    padX + ((x - minX) / (maxX - minX || 1)) * (width - padX * 2);
  const sy = (y: number) =>
    padT + (1 - (y - minY) / (maxY - minY || 1)) * (height - padT - padB);
  const polyline = points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ");
  const single = points.length === 1 ? points[0] : undefined;
  const first = points[0];
  const last = points[points.length - 1];
  const area =
    !single && first && last
      ? `M ${sx(first.x)},${baseY} ` +
        points.map((p) => `L ${sx(p.x)},${sy(p.y)}`).join(" ") +
        ` L ${sx(last.x)},${baseY} Z`
      : null;
  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      <Line
        x1={padX}
        y1={baseY}
        x2={width - padX}
        y2={baseY}
        strokeWidth={0.5}
        stroke={C.line}
      />
      {area && (
        <Path
          d={area}
          fill={C.brand}
          fillOpacity={0.08}
        />
      )}
      {targetY !== undefined && (
        <Line
          x1={padX}
          y1={sy(targetY)}
          x2={width - padX}
          y2={sy(targetY)}
          strokeWidth={0.75}
          stroke={C.faint}
          strokeDasharray="3 2"
        />
      )}
      {single ? (
        <Line
          x1={sx(single.x) - 6}
          y1={sy(single.y)}
          x2={sx(single.x) + 6}
          y2={sy(single.y)}
          strokeWidth={1.5}
          stroke={C.brand}
        />
      ) : (
        <Polyline
          points={polyline}
          fill="none"
          stroke={C.brand}
          strokeWidth={1.4}
        />
      )}
      {last && !single && (
        <Circle
          cx={sx(last.x)}
          cy={sy(last.y)}
          r={2}
          fill={C.brand}
        />
      )}
    </Svg>
  );
}

function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <View style={styles.statRow}>
      {stats.map((s, i) => (
        <View
          key={`${s.label}-${i}`}
          style={styles.stat}
        >
          <Text style={styles.statLabel}>{s.label.toUpperCase()}</Text>
          <Text style={styles.statValue}>{s.value}</Text>
          {s.sub ? <Text style={styles.statSub}>{s.sub}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function Section({
  title,
  wrap = false,
  breakBefore = false,
  children,
}: {
  title: string;
  wrap?: boolean;
  /** Force a page break before this section (react-pdf `break`). */
  breakBefore?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View
      style={styles.section}
      wrap={wrap}
      break={breakBefore}
    >
      <View style={styles.sectionTitleRow}>
        <View style={styles.sectionDot} />
        <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      </View>
      {children}
    </View>
  );
}

function ReportDocument({ model }: { model: ReportPdfModel }) {
  const has = (k: string) => model.sections.includes(k);
  return (
    <Document
      title={model.title}
      author="Maqro"
    >
      <Page
        size="A4"
        style={styles.page}
      >
        <View style={styles.headerRow}>
          <LogoLockup />
          <Text style={styles.headerMeta}>maqro.app · v{APP_VERSION}</Text>
        </View>
        <Text style={styles.title}>{model.title}</Text>
        <Text style={styles.meta}>
          Generated {model.generatedOn} · {model.days} days of history
        </Text>
        {model.profileLine ? (
          <Text style={styles.profileLine}>{model.profileLine}</Text>
        ) : null}
        {model.note ? <Text style={styles.note}>{model.note}</Text> : null}
        <View style={styles.brandRule} />

        {has("summary") && model.summary && (
          <Section title="Summary">
            <StatGrid stats={model.summary.stats} />
            {model.summary.weightDelta ? (
              <Text style={styles.para}>
                Week-on-week weight change: {model.summary.weightDelta}
              </Text>
            ) : null}
          </Section>
        )}

        {has("targets") && model.targets && (
          <Section title="Targets & plan">
            <StatGrid stats={model.targets.stats} />
          </Section>
        )}

        {has("trends") && model.trends && model.trends.length > 0 && (
          <Section title="Trends">
            {model.trends.map((t, i) => (
              <View
                key={`${t.title}-${i}`}
                style={styles.trendItem}
              >
                <Text style={styles.trendTitle}>{t.title}</Text>
                <Text style={styles.trendBody}>{t.body}</Text>
              </View>
            ))}
          </Section>
        )}

        {has("weight") && model.weight && (
          <Section title="Weight">
            <StatGrid stats={model.weight.stats} />
            {model.weight.chart && (
              <View style={styles.chartWrap}>
                <Chart data={model.weight.chart} />
              </View>
            )}
          </Section>
        )}

        {has("body") && model.body && (
          <Section title="Body composition">
            <StatGrid stats={model.body.stats} />
            {model.body.notes ? (
              <Text style={styles.para}>Notes: {model.body.notes}</Text>
            ) : null}
          </Section>
        )}

        {has("bloodPressure") && model.bloodPressure && (
          <Section title="Blood pressure">
            <StatGrid stats={model.bloodPressure.stats} />
            {model.bloodPressure.rows.length > 0 && (
              <View style={{ marginTop: 6 }}>
                <View style={styles.th}>
                  <Text style={[styles.thText, styles.colDate]}>DATE</Text>
                  <Text style={[styles.thText, styles.colReading]}>mmHg</Text>
                  <Text style={[styles.thText, styles.colPulse]}>PULSE</Text>
                  <Text style={[styles.thText, styles.colCat]}>CATEGORY</Text>
                </View>
                {model.bloodPressure.rows.map((r, i) => (
                  <View
                    key={`${r.date}-${i}`}
                    style={styles.tr}
                  >
                    <Text style={[styles.tdText, styles.colDate]}>
                      {r.date}
                    </Text>
                    <Text style={[styles.tdText, styles.colReading]}>
                      {r.reading}
                    </Text>
                    <Text style={[styles.tdText, styles.colPulse]}>
                      {r.pulse}
                    </Text>
                    <Text style={[styles.tdText, styles.colCat]}>
                      {r.category}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </Section>
        )}

        {has("water") && model.hydration && (
          <Section title="Hydration">
            <StatGrid stats={model.hydration.stats} />
            {model.hydration.chart && (
              <View style={styles.chartWrap}>
                <Chart data={model.hydration.chart} />
              </View>
            )}
          </Section>
        )}

        {has("calories") && model.calories && (
          <Section title="Calorie adherence">
            <StatGrid stats={model.calories.stats} />
            {model.calories.chart && (
              <View style={styles.chartWrap}>
                <Chart data={model.calories.chart} />
              </View>
            )}
          </Section>
        )}

        {has("fasting") && model.fasting && (
          <Section title="Intermittent fasting">
            {model.fasting.enabled ? (
              <StatGrid stats={model.fasting.stats} />
            ) : (
              <Text style={styles.empty}>
                Intermittent fasting isn&apos;t enabled.
              </Text>
            )}
          </Section>
        )}

        {has("micronutrients") &&
          model.micronutrients &&
          model.micronutrients.rows.length > 0 && (
            <Section
              title="Micronutrients"
              breakBefore
            >
              <Text style={styles.caption}>{model.micronutrients.caption}</Text>
              {model.micronutrients.rows.map((m, i) => (
                <View
                  key={`${m.label}-${i}`}
                  style={styles.microRow}
                >
                  <View style={styles.microHead}>
                    <Text style={styles.microLabel}>{m.label}</Text>
                    {m.hasValue ? (
                      <Text style={styles.microValue}>{m.value}</Text>
                    ) : (
                      <Text style={styles.microNoData}>no data</Text>
                    )}
                  </View>
                  <View style={styles.microTrack}>
                    <View
                      style={[
                        styles.microFill,
                        { width: `${Math.min(m.pct, 100)}%` },
                      ]}
                    />
                  </View>
                </View>
              ))}
            </Section>
          )}

        <Text
          style={styles.footer}
          fixed
        >
          This report reflects locally-stored data on the device that generated
          it. Macro / TDEE estimates are textbook approximations (Mifflin-St
          Jeor) that can diverge 10–20% per individual.
        </Text>
        <Text
          style={styles.pageNum}
          fixed
          render={({ pageNumber, totalPages }) =>
            `${pageNumber} / ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

/** Render the report to a PDF Buffer on the server. The single public entry
 *  point — called by the `/api/report/pdf` route so @react-pdf (and its yoga
 *  WASM) stays entirely out of the client bundle. */
export async function renderReportPdfBuffer(
  model: ReportPdfModel,
): Promise<Buffer> {
  return renderToBuffer(<ReportDocument model={model} />);
}
