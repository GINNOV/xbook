import React from "react";
import { AbsoluteFill } from "remotion";
import { SceneShell } from "../components/SceneShell";
import { useFadeSlide } from "../lib/animation";
import { colors } from "../theme";

export const CtaScene: React.FC = () => {
  const a = useFadeSlide(0);
  const b = useFadeSlide(10);
  const c = useFadeSlide(18);

  return (
    <SceneShell>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
          padding: 80,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 5,
            background: colors.accent,
            boxShadow: `0 0 40px ${colors.accent}`,
            marginBottom: 28,
            ...a,
          }}
        />
        <h1
          style={{
            margin: 0,
            fontSize: 72,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            ...b,
          }}
        >
          XBook Console
        </h1>
        <p
          style={{
            marginTop: 20,
            fontSize: 28,
            color: colors.textMuted,
            maxWidth: 700,
            lineHeight: 1.45,
            ...b,
          }}
        >
          Local knowledge base for X and YouTube bookmarks.
        </p>
        <div
          style={{
            marginTop: 40,
            padding: "18px 32px",
            borderRadius: 10,
            background: colors.accent,
            color: "#04120a",
            fontSize: 24,
            fontWeight: 700,
            ...c,
          }}
        >
          github.com/GINNOV/xbook
        </div>
        <p
          style={{
            marginTop: 24,
            fontSize: 18,
            color: colors.textDim,
            ...c,
          }}
        >
          macOS desktop · open source · your models
        </p>
      </AbsoluteFill>
    </SceneShell>
  );
};
