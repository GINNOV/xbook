import React from "react";
import { AbsoluteFill } from "remotion";
import { SceneShell } from "../components/SceneShell";
import { useFadeSlide } from "../lib/animation";
import { colors } from "../theme";

export const PromiseScene: React.FC = () => {
  const a = useFadeSlide(0);
  const b = useFadeSlide(10);
  const c = useFadeSlide(20);

  return (
    <SceneShell eyebrow="XBook Console">
      <AbsoluteFill
        style={{
          justifyContent: "center",
          padding: "80px 100px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 28,
            ...a,
          }}
        >
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: 4,
              background: colors.accent,
              boxShadow: `0 0 24px ${colors.accent}`,
            }}
          />
          <span
            style={{
              fontSize: 20,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: colors.textMuted,
              fontWeight: 600,
            }}
          >
            Local-first knowledge base
          </span>
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: 80,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            ...b,
          }}
        >
          Turn saves into a library
          <br />
          you can actually use.
        </h1>
        <p
          style={{
            marginTop: 32,
            fontSize: 28,
            color: colors.textMuted,
            maxWidth: 800,
            lineHeight: 1.5,
            ...c,
          }}
        >
          Import X + YouTube · enrich with your LLM · search, ask, and process —
          on your machine.
        </p>
      </AbsoluteFill>
    </SceneShell>
  );
};
