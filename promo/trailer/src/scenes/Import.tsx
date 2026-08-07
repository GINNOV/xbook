import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { MockWindow } from "../components/MockWindow";
import { SceneShell } from "../components/SceneShell";
import { useFadeSlide } from "../lib/animation";
import { colors } from "../theme";

const rows = [
  { src: "X", title: "Thread on local LLM routing", meta: "2h ago" },
  { src: "X", title: "Paper notes: RAG evaluation", meta: "yesterday" },
  { src: "YT", title: "Talk: vector search in practice", meta: "playlist" },
  { src: "YT", title: "Desktop packaging with Tauri", meta: "watch later" },
];

export const ImportScene: React.FC = () => {
  const frame = useCurrentFrame();
  const title = useFadeSlide(0);
  const panel = useFadeSlide(6, 40);
  const progress = interpolate(frame, [10, 70], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <SceneShell eyebrow="01 · Import">
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
          <h2 style={{ margin: 0, fontSize: 56, fontWeight: 650, lineHeight: 1.15 }}>
            Pull X bookmarks and
            <br />
            YouTube saves into one place.
          </h2>
          <p style={{ marginTop: 24, fontSize: 24, color: colors.textMuted, lineHeight: 1.5 }}>
            Delta sync respects API cost. Folders stay mapped. Your baseline
            only walks what&apos;s new.
          </p>
          <div style={{ marginTop: 32, display: "flex", gap: 12 }}>
            <Pill color={colors.xBlue} label="X / Twitter" />
            <Pill color={colors.ytRed} label="YouTube" />
          </div>
        </div>
        <div style={{ flex: 1.1, ...panel }}>
          <MockWindow title="Library · sync">
            <div style={{ marginBottom: 16, fontSize: 15, color: colors.textMuted }}>
              Syncing inbox…
            </div>
            <div
              style={{
                height: 8,
                borderRadius: 4,
                background: colors.border,
                overflow: "hidden",
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: "100%",
                  background: colors.accent,
                }}
              />
            </div>
            {rows.map((r, i) => {
              const show = interpolate(frame, [15 + i * 8, 25 + i * 8], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              return (
                <div
                  key={r.title}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "12px 0",
                    borderTop: i === 0 ? "none" : `1px solid ${colors.border}`,
                    opacity: show,
                    transform: `translateX(${(1 - show) * 16}px)`,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: r.src === "X" ? colors.xBlue : colors.ytRed,
                      width: 28,
                    }}
                  >
                    {r.src}
                  </span>
                  <span style={{ flex: 1, fontSize: 17 }}>{r.title}</span>
                  <span style={{ fontSize: 14, color: colors.textDim }}>{r.meta}</span>
                </div>
              );
            })}
          </MockWindow>
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
};

const Pill: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <span
    style={{
      border: `1px solid ${color}55`,
      color,
      borderRadius: 999,
      padding: "8px 16px",
      fontSize: 16,
      fontWeight: 600,
      background: `${color}14`,
    }}
  >
    {label}
  </span>
);
