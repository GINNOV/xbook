import React from "react";
import { AbsoluteFill } from "remotion";
import { MockWindow } from "../components/MockWindow";
import { SceneShell } from "../components/SceneShell";
import { useFadeSlide } from "../lib/animation";
import { colors } from "../theme";

export const DesktopScene: React.FC = () => {
  const title = useFadeSlide(0);
  const panel = useFadeSlide(10, 40);

  return (
    <SceneShell eyebrow="04 · Desktop">
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
            One app. Local SQLite.
            <br />
            Auto-updates when you ship.
          </h2>
          <p style={{ marginTop: 24, fontSize: 24, color: colors.textMuted, lineHeight: 1.5 }}>
            Native macOS shell (Tauri) with a bundled Node server. Your library
            lives under <span style={{ color: colors.text }}>~/.xbook</span>.
          </p>
          <ul
            style={{
              marginTop: 28,
              paddingLeft: 22,
              fontSize: 20,
              color: colors.textMuted,
              lineHeight: 1.7,
            }}
          >
            <li>Signed releases on GitHub</li>
            <li>In-app updater for 0.4.0+</li>
            <li>Open source · GINNOV/xbook</li>
          </ul>
        </div>
        <div style={{ flex: 1, ...panel }}>
          <MockWindow title="xbook.app">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "140px 1fr",
                gap: 16,
                minHeight: 320,
              }}
            >
              <div
                style={{
                  borderRight: `1px solid ${colors.border}`,
                  paddingRight: 12,
                  fontSize: 15,
                  color: colors.textMuted,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {["Dashboard", "X Library", "YouTube", "Folders", "Settings"].map(
                  (item, i) => (
                    <span
                      key={item}
                      style={{
                        color: i === 0 ? colors.accent : colors.textMuted,
                        fontWeight: i === 0 ? 600 : 400,
                      }}
                    >
                      {item}
                    </span>
                  )
                )}
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>
                  Dashboard
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {[
                    ["Indexed", "1,204"],
                    ["Pending", "18"],
                    ["X usage", "on track"],
                    ["Inbox", "Process →"],
                  ].map(([k, v]) => (
                    <div
                      key={k}
                      style={{
                        border: `1px solid ${colors.border}`,
                        borderRadius: 8,
                        padding: 14,
                        background: colors.surfaceRaised,
                      }}
                    >
                      <div style={{ fontSize: 13, color: colors.textDim }}>{k}</div>
                      <div style={{ fontSize: 22, marginTop: 6, fontWeight: 600 }}>
                        {v}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </MockWindow>
        </div>
      </AbsoluteFill>
    </SceneShell>
  );
};
