import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { CtaScene } from "./scenes/Cta";
import { DesktopScene } from "./scenes/Desktop";
import { EnrichScene } from "./scenes/Enrich";
import { Hook } from "./scenes/Hook";
import { ImportScene } from "./scenes/Import";
import { PromiseScene } from "./scenes/Promise";
import { SearchScene } from "./scenes/Search";
import { colors } from "./theme";

/**
 * Scene timeline (30 fps):
 *  Hook 0–4.5s | Promise 4.5–10s | Import 10–20s | Enrich 20–30s
 *  Search 30–40s | Desktop 40–50s | CTA 50–58s
 */
export const SCENE = {
  hook: { start: 0, duration: 135 },
  promise: { start: 135, duration: 165 },
  import: { start: 300, duration: 300 },
  enrich: { start: 600, duration: 300 },
  search: { start: 900, duration: 300 },
  desktop: { start: 1200, duration: 300 },
  cta: { start: 1500, duration: 240 },
} as const;

export const TRAILER_DURATION =
  SCENE.cta.start + SCENE.cta.duration; /* 1740 frames ≈ 58s */

export const XBookTrailer: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <Sequence from={SCENE.hook.start} durationInFrames={SCENE.hook.duration}>
        <Hook />
      </Sequence>
      <Sequence from={SCENE.promise.start} durationInFrames={SCENE.promise.duration}>
        <PromiseScene />
      </Sequence>
      <Sequence from={SCENE.import.start} durationInFrames={SCENE.import.duration}>
        <ImportScene />
      </Sequence>
      <Sequence from={SCENE.enrich.start} durationInFrames={SCENE.enrich.duration}>
        <EnrichScene />
      </Sequence>
      <Sequence from={SCENE.search.start} durationInFrames={SCENE.search.duration}>
        <SearchScene />
      </Sequence>
      <Sequence from={SCENE.desktop.start} durationInFrames={SCENE.desktop.duration}>
        <DesktopScene />
      </Sequence>
      <Sequence from={SCENE.cta.start} durationInFrames={SCENE.cta.duration}>
        <CtaScene />
      </Sequence>
    </AbsoluteFill>
  );
};
