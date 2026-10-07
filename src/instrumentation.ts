export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recoverJobs } = await import("./lib/server/pipeline");
  await recoverJobs().catch((e) => console.error("[koma] job recovery failed", e));
  const { launchpad } = await import("./lib/server/launchpad/addresses");
  if (launchpad()) {
    const { startIndexer } = await import("./lib/server/launchpad/indexer");
    const { keeper } = await import("./lib/server/launchpad/relay");
    const { recoverLaunches } = await import("./lib/server/launchpad/launch");
    // After each index pass: graduations and canon finalization.
    startIndexer(() => keeper());
    await recoverLaunches().catch((e) => console.error("[koma] launch recovery failed", e));
  }
}
