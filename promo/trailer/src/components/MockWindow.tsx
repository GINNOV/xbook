import React from "react";
import { colors, fonts } from "../theme";

/** Lightweight “app window” chrome for staged product UI. */
export const MockWindow: React.FC<{
  title?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ title = "XBook Console", children, style }) => {
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        overflow: "hidden",
        boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
        fontFamily: fonts.sans,
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 16px",
          borderBottom: `1px solid ${colors.border}`,
          background: colors.surfaceRaised,
        }}
      >
        <Dot c="#ff5f57" />
        <Dot c="#febc2e" />
        <Dot c="#28c840" />
        <span
          style={{
            marginLeft: 12,
            fontSize: 14,
            color: colors.textMuted,
          }}
        >
          {title}
        </span>
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  );
};

const Dot: React.FC<{ c: string }> = ({ c }) => (
  <span
    style={{
      width: 10,
      height: 10,
      borderRadius: 999,
      background: c,
      display: "inline-block",
    }}
  />
);
