import Actions from "../Actions";
import type { SetupReadiness } from "@/lib/setup-readiness";

type Props = {
  tab: "x" | "yt";
  enrichSize: number;
  pend: number;
  total: number;
  last: Date | string | null;
  settings: { soundOnComplete: boolean | null; soundOnError: boolean | null } | null;
  readiness?: SetupReadiness;
};

export function SyncCard({ tab, enrichSize, pend, total, last, settings, readiness }: Props) {
  return (
    <div className="rounded-lg bg-surface-container-lowest p-5">
      <h2 className="text-base font-semibold">Inbox</h2>
      <div className="mt-6">
        <Actions
          enrichBatchSize={enrichSize}
          source={tab}
          pendingCount={pend}
          totalCount={total}
          soundOnComplete={settings?.soundOnComplete ?? false}
          soundOnError={settings?.soundOnError ?? false}
          readiness={readiness}
        />
      </div>
      <p className="mt-2 text-xs text-on-surface-variant italic">
        Last sync: {last ? new Date(last).toLocaleString() : "Not yet"}
      </p>
    </div>
  );
}
