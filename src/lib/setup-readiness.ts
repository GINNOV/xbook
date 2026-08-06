/**
 * Setup readiness for dashboard CTAs and first-run empty state.
 * Mirrors Settings "Setup status" chips (connection + models).
 */

export type SetupSettingsLike = {
  xAccessToken?: string | null;
  ytAccessToken?: string | null;
  llmModel?: string | null;
  llmEmbeddingModel?: string | null;
  llmBaseUrl?: string | null;
} | null | undefined;

export type SetupReadiness = {
  sourceConnected: boolean;
  chatModelSet: boolean;
  embeddingModelSet: boolean;
  /** OAuth + chat model — enough to run Process inbox (sync → enrich → embed). */
  canProcessInbox: boolean;
  /** OAuth only — enough to Sync / Import. */
  canSync: boolean;
  /** Human-readable reasons CTAs are blocked (empty when ready). */
  blockers: string[];
};

function hasToken(value?: string | null): boolean {
  return Boolean(value?.trim());
}

export function getSetupReadiness(
  source: "x" | "yt",
  settings: SetupSettingsLike
): SetupReadiness {
  const sourceConnected =
    source === "x" ? hasToken(settings?.xAccessToken) : hasToken(settings?.ytAccessToken);
  const chatModelSet = hasToken(settings?.llmModel);
  const embeddingModelSet = hasToken(settings?.llmEmbeddingModel);

  const blockers: string[] = [];
  if (!sourceConnected) {
    blockers.push(
      source === "x"
        ? "Connect X OAuth in Settings → Connections"
        : "Connect YouTube OAuth in Settings → Connections"
    );
  }
  if (!chatModelSet) {
    blockers.push("Set a chat model in Settings → AI");
  }
  if (!embeddingModelSet) {
    blockers.push("Set an embedding model in Settings → AI (needed for semantic search)");
  }

  // Process inbox needs OAuth + chat model. Embedding model is recommended
  // (step 3 of the pipeline) but we still allow the run so enrich can finish;
  // missing embeddings show as "unindexed" and Sync embeddings stays available later.
  const canSync = sourceConnected;
  const canProcessInbox = sourceConnected && chatModelSet;

  return {
    sourceConnected,
    chatModelSet,
    embeddingModelSet,
    canProcessInbox,
    canSync,
    blockers,
  };
}
