import { NextResponse, type NextRequest } from "next/server";
import { getJob, saveJob } from "@/lib/server/store";
import { runJob } from "@/lib/server/pipeline";
import { clientIp } from "@/lib/server/client-ip";
import { limited } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/jobs/[id]">) {
  const job = await getJob((await ctx.params).id);
  if (!job) return NextResponse.json({ error: "No such job" }, { status: 404 });
  // Internal working state (full shot list, authorization nonce) stays on the server.
  return NextResponse.json({ ...job, work: undefined, nonce: undefined }, { headers: { "Cache-Control": "no-store" } });
}

const MAX_RETRIES = 3;

/**
 * POST: restart a paid job that failed (a model or image call that gave up). The payment already settled, so
 * nothing is charged again; the job continues from its saved work (script, drawn panels). At most 3 times.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/jobs/[id]">) {
  if (limited(`retry:${clientIp(req)}`, 60_000, 10)) return NextResponse.json({ error: "Too many retries from here." }, { status: 429 });
  const job = await getJob((await ctx.params).id);
  if (!job) return NextResponse.json({ error: "No such job" }, { status: 404 });
  if (job.stage !== "error") return NextResponse.json({ error: "Only a failed job can be retried." }, { status: 409 });
  if (!job.paymentTx) return NextResponse.json({ error: "This job was never paid for, so there's nothing to retry." }, { status: 409 });
  if ((job.retries ?? 0) >= MAX_RETRIES) return NextResponse.json({ error: `Retried ${MAX_RETRIES} times already.` }, { status: 409 });
  job.retries = (job.retries ?? 0) + 1;
  job.stage = job.failedAt && job.failedAt !== "settling" ? job.failedAt : "writing";
  job.error = undefined;
  await saveJob(job);
  void runJob(job);
  return NextResponse.json({ ok: true, retries: job.retries, stage: job.stage }, { status: 202 });
}
