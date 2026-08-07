import React from "react";
import { AbsoluteFill } from "remotion";
import { colors, fonts } from "../theme";

export const SceneShell: React.FC<{
  children: React.ReactNode;
  eyebrow?: string;
}> = ({ children, eyebrow }) => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.bg,
        color: colors.text,
        fontFamily: fonts.sans,
        padding: "80px 100px",
        boxSizing: "border-box",
      }}
    >
      {/* subtle grid */}
      <AbsoluteFill
        style={{
          opacity: 0.04,
          backgroundImage:
            "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          pointerEvents: "none",
        }}
      />
      {eyebrow ? (
        <div
          style={{
            position: "absolute",
            top: 48,
            left: 100,
            fontSize: 18,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: colors.accent,
            fontWeight: 600,
            zIndex: 2,
          }}
        >
          {eyebrow}
        </div>
      ) : null}
      <div style={{ position: "relative", zIndex: 1, height: "100%", width: "100%" }}>
        {children}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 40,
          right: 100,
          fontSize: 16,
          color: colors.textDim,
          letterSpacing: "0.08em",
          zIndex: 2,
        }}
      >
        XBOOK CONSOLE
      </div>
    </AbsoluteFill>
  );
};
