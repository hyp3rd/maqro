import { renderReportPdfBuffer } from "@/components/macro/ReportPdfDocument";
import { parseBody } from "@/lib/api/parse-body";
import { NextResponse } from "next/server";
import { z } from "zod";

// @react-pdf/renderer needs the Node runtime (yoga WASM + Node built-ins).
export const runtime = "nodejs";
export const maxDuration = 30;

// Bound every array + string so the payload can't be used to force a huge
// (CPU/memory-heavy) render. The shape mirrors `ReportPdfModel`.
const stat = z.object({
  label: z.string().max(80),
  value: z.string().max(80),
  sub: z.string().max(160).optional(),
});
const stats = z.array(stat).max(12);
const chart = z
  .object({
    points: z
      .array(z.object({ x: z.number().finite(), y: z.number().finite() }))
      .max(500),
    targetY: z.number().finite().optional(),
  })
  .nullable();

const ModelSchema = z.object({
  title: z.string().max(200),
  note: z.string().max(2000),
  days: z.number().int().min(0).max(3650),
  generatedOn: z.string().max(60),
  profileLine: z.string().max(200).nullable(),
  sections: z.array(z.string().max(40)).max(20),
  summary: z
    .object({ stats, weightDelta: z.string().max(80).nullable() })
    .nullable(),
  targets: z.object({ stats }).nullable(),
  trends: z
    .array(z.object({ title: z.string().max(120), body: z.string().max(1000) }))
    .max(10)
    .nullable(),
  weight: z.object({ stats, chart }).nullable(),
  body: z.object({ stats, notes: z.string().max(1000).nullable() }).nullable(),
  bloodPressure: z
    .object({
      stats,
      rows: z
        .array(
          z.object({
            date: z.string().max(40),
            reading: z.string().max(40),
            pulse: z.string().max(20),
            category: z.string().max(60),
          }),
        )
        .max(60),
    })
    .nullable(),
  hydration: z.object({ stats, chart }).nullable(),
  calories: z.object({ stats, chart }).nullable(),
  fasting: z.object({ enabled: z.boolean(), stats }).nullable(),
  micronutrients: z
    .object({
      caption: z.string().max(500),
      rows: z
        .array(
          z.object({
            label: z.string().max(80),
            value: z.string().max(80),
            pct: z.number().finite(),
            hasValue: z.boolean(),
          }),
        )
        .max(40),
    })
    .nullable(),
});

/** Render a progress-report PDF server-side and return it.
 *
 *  The browser POSTs its own pre-formatted `ReportPdfModel` (derived
 *  client-side, the same values the on-screen report shows) and gets the vector
 *  PDF back — keeping @react-pdf/renderer's ~1.4 MB WASM engine entirely off the
 *  client. No auth: the payload is the caller's own data round-tripping through
 *  the renderer, and the schema bounds the render work. */
export async function POST(req: Request): Promise<NextResponse> {
  const parsed = await parseBody(req, ModelSchema);
  if (!parsed.ok) return parsed.response;

  try {
    const pdf = await renderReportPdfBuffer(parsed.data);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="maqro-report.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[report-pdf] render failed:", err);
    return NextResponse.json(
      { error: "Couldn't render the report PDF." },
      { status: 500 },
    );
  }
}
