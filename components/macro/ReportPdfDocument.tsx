"use client";

import { APP_VERSION } from "@/lib/version";
import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  pdf,
} from "@react-pdf/renderer";

/** Vector PDF rendering of the progress report.
 *
 *  @react-pdf/renderer pulls a WASM layout engine and browser-only APIs, so
 *  this module must only ever be reached via a dynamic `import()` inside a
 *  browser event handler — never imported into the SSR tree. `renderReportPdf`
 *  is that single entry point; it returns a Blob the caller can download or
 *  encrypt + upload.
 *
 *  The component is pure presentation: every number arrives pre-formatted as a
 *  string in {@link ReportPdfModel} (the caller owns units + derivations, which
 *  it shares with the on-screen report), so there's no computation here.
 *  Line charts are intentionally omitted in this version — the PDF carries the
 *  numbers + tables; the on-screen / print report keeps the charts. */

type Stat = { label: string; value: string; sub?: string };

export type ReportPdfModel = {
  title: string;
  note: string;
  days: number;
  generatedOn: string;
  /** Section keys to render, in `REPORT_SECTIONS` order. */
  sections: string[];
  summary: { stats: Stat[]; weightDelta: string | null } | null;
  weight: Stat[] | null;
  body: { stats: Stat[]; notes: string | null } | null;
  bloodPressure: {
    stats: Stat[];
    rows: { date: string; reading: string; pulse: string; category: string }[];
  } | null;
  hydration: Stat[] | null;
  fasting: { enabled: boolean; stats: Stat[] } | null;
};

const C = {
  ink: "#1a1a1a",
  muted: "#71717a",
  faint: "#a1a1aa",
  line: "#e4e4e7",
};

const styles = StyleSheet.create({
  page: {
    paddingVertical: 44,
    paddingHorizontal: 52,
    paddingBottom: 64,
    fontSize: 10,
    color: C.ink,
    lineHeight: 1.4,
  },
  brand: {
    fontSize: 8,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: C.muted,
    marginBottom: 6,
  },
  title: { fontSize: 22, fontWeight: 700, marginBottom: 4 },
  meta: { fontSize: 9, color: C.muted },
  note: {
    marginTop: 14,
    padding: 11,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 4,
    fontSize: 10,
  },
  rule: { borderBottomWidth: 1, borderBottomColor: C.line, marginVertical: 14 },
  section: {
    borderWidth: 1,
    borderColor: "#d4d4d8",
    borderRadius: 4,
    padding: 12,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: C.muted,
    marginBottom: 8,
  },
  statRow: { flexDirection: "row", flexWrap: "wrap" },
  stat: { width: "33%", marginBottom: 6, paddingRight: 8 },
  statLabel: {
    fontSize: 7,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: C.muted,
  },
  statValue: { fontSize: 13, fontWeight: 700, marginTop: 1 },
  statSub: { fontSize: 7, color: C.muted, marginTop: 1 },
  empty: { fontSize: 10, color: C.muted },
  para: { fontSize: 10, color: C.muted, marginTop: 4 },
  // Table (blood pressure)
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
    paddingVertical: 2.5,
  },
  thText: {
    fontSize: 7,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: C.muted,
  },
  tdText: { fontSize: 9 },
  colDate: { width: "26%" },
  colReading: { width: "26%" },
  colPulse: { width: "18%" },
  colCat: { width: "30%" },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 52,
    right: 52,
    fontSize: 7.5,
    color: C.faint,
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingTop: 7,
  },
});

function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <View style={styles.statRow}>
      {stats.map((s, i) => (
        <View
          key={`${s.label}-${i}`}
          style={styles.stat}
        >
          <Text style={styles.statLabel}>{s.label}</Text>
          <Text style={styles.statValue}>{s.value}</Text>
          {s.sub ? <Text style={styles.statSub}>{s.sub}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View
      style={styles.section}
      wrap={false}
    >
      <Text style={styles.sectionTitle}>{title}</Text>
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
        <View>
          <Text style={styles.brand}>Maqro · maqro.app · v{APP_VERSION}</Text>
          <Text style={styles.title}>{model.title}</Text>
          <Text style={styles.meta}>
            Generated {model.generatedOn} · {model.days} days of history
          </Text>
          {model.note ? <Text style={styles.note}>{model.note}</Text> : null}
        </View>
        <View style={styles.rule} />

        {has("summary") && model.summary && (
          <Section title="Summary">
            <StatGrid stats={model.summary.stats} />
            {model.summary.weightDelta ? (
              <Text style={styles.para}>
                Week-on-week weight delta: {model.summary.weightDelta}
              </Text>
            ) : null}
          </Section>
        )}

        {has("weight") && model.weight && (
          <Section title="Weight">
            <StatGrid stats={model.weight} />
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
                  <Text style={[styles.thText, styles.colDate]}>Date</Text>
                  <Text style={[styles.thText, styles.colReading]}>mmHg</Text>
                  <Text style={[styles.thText, styles.colPulse]}>Pulse</Text>
                  <Text style={[styles.thText, styles.colCat]}>Category</Text>
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
            <StatGrid stats={model.hydration} />
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

        <Text
          style={styles.footer}
          fixed
        >
          This report reflects locally-stored data on the device that generated
          it. Macro / TDEE estimates are textbook approximations (Mifflin-St
          Jeor) that can diverge 10–20% per individual.
        </Text>
      </Page>
    </Document>
  );
}

/** Render the report to a PDF Blob. The single public entry point — call it
 *  from a browser event handler (it's dynamically imported to keep react-pdf
 *  out of the SSR bundle). */
export async function renderReportPdf(model: ReportPdfModel): Promise<Blob> {
  return pdf(<ReportDocument model={model} />).toBlob();
}
