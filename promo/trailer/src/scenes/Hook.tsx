import React from "react";
import { AbsoluteFill } from "remotion";
import { SceneShell } from "../components/SceneShell";
import { useFadeSlide } from "../lib/animation";
import { colors } from "../theme";

export const Hook: React.FC = () => {
  const a = useFadeSlide(0);
  const b = useFadeSlide(8);
  const c = useFadeSlide(18);

  return (
    <SceneShell eyebrow="The problem">
      <AbsoluteFill
        style={{
          justifyContent: "center",
          padding: "80px 100px",
          boxSizing: "border-box",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 72,
            fontWeight: 650,
            lineHeight: 1.1,
            maxWidth: 1100,
            ...a,
          }}
        >
          Bookmarks pile up.
          <br />
          <span style={{ color: colors.textMuted }}>Nothing becomes knowledge.</span>
        </h1>
        <p
          style={{
            marginTop: 36,
            fontSize: 28,
            color: colors.textMuted,
            maxWidth: 720,
            lineHeight: 1.45,
            ...b,
          }}
        >
          X saves. YouTube saves. Two tabs, zero retrieval.
        </p>
        <div
          style={{
            marginTop: 48,
            display: "flex",
            gap: 16,
            ...c,
          }}
        >
          {["Unread forever", "No summary", "No search that works"].map((label) => (
            <span
              key={label}
              style={{
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                padding: "12px 18px",
                fontSize: 18,
                color: colors.textDim,
                background: colors.surface,
              }}
            >
              {label}
            </span>
          ))}
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
};
