import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { MockWindow } from "../components/MockWindow";
import { SceneShell } from "../components/SceneShell";
import { useFadeSlide } from "../lib/animation";
import { colors } from "../theme";

const steps = [
  { label: "Summary", doneAt: 25 },
  { label: "Category", doneAt: 40 },
  { label: "Tags", doneAt: 55 },
  { label: "Embedding", doneAt: 70 },
];

export const EnrichScene: React.FC = () => {
  const frame = useCurrentFrame();
  const title = useFadeSlide(0);
  const panel = useFadeSlide(8, 36);

  return (
    <SceneShell eyebrow="02 · Enrich">
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
        <div style={{ flex: 1.1, ...panel }}>
          <MockWindow title="Process inbox · run #1842">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginBottom: 18,
                fontSize: 16,
                color: colors.textMuted,
              }}
            >
              <span>Your LLM · your keys</span>
              <span style={{ color: colors.accent }}>running</span>
            </div>
            {steps.map((s) => {
              const done = frame >= s.doneAt;
              const pulse = interpolate(
                frame,
                [s.doneAt - 10, s.doneAt],
                [0.4, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
              );
              return (
                <div
                  key={s.label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "14px 0",
                    borderTop: `1px solid ${colors.border}`,
                    opacity: pulse,
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      border: `1px solid ${done ? colors.accent : colors.border}`,
                      background: done ? colors.accentSoft : "transparent",
                      color: colors.accent,
                      display: "grid",
                      placeItems: "center",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    {done ? "✓" : ""}
                  </span>
                  <span style={{ fontSize: 20, flex: 1 }}>{s.label}</span>
                  <span style={{ fontSize: 14, color: colors.textDim }}>
                    {done ? "done" : "…"}
                  </span>
                </div>
              );
            })}
            <div
              style={{
                marginTop: 20,
                padding: 16,
                borderRadius: 8,
                background: colors.surfaceRaised,
                border: `1px solid ${colors.border}`,
                fontSize: 16,
                color: colors.textMuted,
                lineHeight: 1.45,
              }}
            >
              Chat model for enrich · separate embedding host when you need it
              (vLLM + Ollama, etc.).
            </div>
          </MockWindow>
        </div>
        <div style={{ flex: 1, ...title }}>
          <h2 style={{ margin: 0, fontSize: 52, fontWeight: 650, lineHeight: 1.15 }}>
            Summarize, categorize, and index — with models you control.
          </h2>
          <p style={{ marginTop: 24, fontSize: 24, color: colors.textMuted, lineHeight: 1.5 }}>
            Process inbox in one click. Concurrency and spend stay under your
            settings, not a SaaS meter.
          </p>
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
};
