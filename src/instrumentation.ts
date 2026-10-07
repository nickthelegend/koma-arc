export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { prepareLocalnet } = await import("./lib/server/localnet");
  await prepareLocalnet().catch((e) => console.error("[koma] localnet prep failed", e));
  const { recoverJobs } = await import("./lib/server/pipeline");
  await recoverJobs().catch((e) => console.error("[koma] job recovery failed", e));
  const { launchpad } = await import("./lib/server/launchpad/addresses");
  if (launchpad()) {
    const { startIndexer } = await import("./lib/server/launchpad/indexer");
    const { keeper } = await import("./lib/server/launchpad/relay");
    const { recoverLaunches } = await import("./lib/server/launchpad/launch");
    const { runAutopilot } = await import("./lib/server/autopilot");
    // After each index pass: graduations and canon finalization, then backers' autopilot votes and buys.
    startIndexer(async () => {
      await keeper();
      await runAutopilot().catch((e) => console.error("[koma] autopilot pass failed", e));
    });
    await recoverLaunches().catch((e) => console.error("[koma] launch recovery failed", e));
  }
}
