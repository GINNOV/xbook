"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

type Props = {
  enabled: boolean;
};

export default function ProcessingAutoRefresh({
  enabled,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const eventSourceRef = useRef<EventSource | null>(null);
  const lastRefreshRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      if (disposed || eventSourceRef.current) return;
      const es = new EventSource("/api/processing/events");
      eventSourceRef.current = es;
      const handleUpdate = () => {
        const now = Date.now();
        if (now - lastRefreshRef.current > 2000) {
          lastRefreshRef.current = now;
          startTransition(() => router.refresh());
        }
      };
      es.addEventListener("run_updated", handleUpdate);
      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
        if (!disposed) retry = setTimeout(connect, 5000);
      };
    };
    connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [enabled, router]);

  return null;
}
