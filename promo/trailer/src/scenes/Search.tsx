import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { MockWindow } from "../components/MockWindow";
import { SceneShell } from "../components/SceneShell";
import { useFadeSlide } from "../lib/animation";
import { colors } from "../theme";

const hits = [
  {
    q: "local embedding hosts",
    blurb: "Notes on splitting chat vs embed endpoints…",
  },
  {
    q: "folder delta sync",
    blurb: "Cheap ID walk, hydrate only unknowns…",
  },
  {
    q: "process inbox flow",
    blurb: "Import → enrich → backfill embeddings…",
  },
];

export const SearchScene: React.FC = () => {
  const frame = useCurrentFrame();
  const title = useFadeSlide(0);
  const panel = useFadeSlide(6, 32);
  const typed = "vector search over my saved threads";
  const chars = Math.floor(
    interpolate(frame, [5, 45], [0, typed.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );

  return (
    <SceneShell eyebrow="03 · Retrieve">
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "row",
          gap: 56,
          alignItems: "center",
          padding: "100px 100px 80px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ flex: 1, ...title }}>
          <h2 style={{ margin: 0, fontSize: 52, fontWeight: 650, lineHeight: 1.15 }}>
            Find the idea you saved months ago.
          </h2>
          <p style={{ marginTop: 24, fontSize: 24, color: colors.textMuted, lineHeight: 1.5 }}>
            Semantic search over summaries and tags — not another infinite
            scroll of blue links.
          </p>
        </div>
        <div style={{ flex: 1.15, ...panel }}>
          <MockWindow title="Search · semantic">
            <div
              style={{
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                padding: "14px 16px",
                fontSize: 20,
                marginBottom: 18,
                background: colors.bg,
                minHeight: 28,
                color: colors.text,
              }}
            >
              {typed.slice(0, chars)}
              <span style={{ color: colors.accent }}>|</span>
            </div>
            {hits.map((h, i) => {
              const show = interpolate(frame, [40 + i * 10, 50 + i * 10], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              return (
                <div
                  key={h.q}
                  style={{
                    padding: "14px 0",
                    borderTop: `1px solid ${colors.border}`,
                    opacity: show,
                  }}
                >
                  <div style={{ fontSize: 18, fontWeight: 600 }}>{h.q}</div>
                  <div style={{ fontSize: 15, color: colors.textMuted, marginTop: 4 }}>
                    {h.blurb}
                  </div>
                </div>
              );
            })}
          </MockWindow>
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
};
