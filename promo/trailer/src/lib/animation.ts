import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export function useFadeSlide(delay = 0, distance = 28) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({
    frame: frame - delay,
    fps,
    config: { damping: 200 },
  });
  const opacity = interpolate(t, [0, 1], [0, 1]);
  const y = interpolate(t, [0, 1], [distance, 0]);
  return { opacity, transform: `translateY(${y}px)` };
}

export function useProgress(from: number, to: number) {
  const frame = useCurrentFrame();
  return interpolate(frame, [from, to], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}
