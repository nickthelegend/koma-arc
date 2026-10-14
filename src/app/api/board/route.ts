import { refreshHostedIndex } from "@/lib/server/launchpad/hosted";
import { NextResponse } from "next/server";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { board } from "@/lib/server/launchpad/board";

export const dynamic = "force-dynamic";

/** The leaderboard behind /series: Envio HyperIndex when ENVIO_GRAPHQL_URL is set, else KOMA's SQLite cache. */
export async function GET() {
  await refreshHostedIndex();
  if (!launchpad()) return NextResponse.json({ error: "launchpad not deployed" }, { status: 503 });
  return NextResponse.json(await board());
}
