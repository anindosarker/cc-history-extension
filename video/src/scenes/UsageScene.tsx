import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Caption, SceneFade, Window } from "../components";
import { ACCENT, FONT, SHOTS } from "../theme";

export const UsageScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 24, stiffness: 80 } });
  const bar = spring({ frame, fps, delay: 26, config: { damping: 18, stiffness: 90 } });
  const glow = interpolate(frame, [26, 50, 80], [0, 1, 0.45], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const zoom = interpolate(frame, [0, duration], [1, 1.04]);

  return (
    <SceneFade duration={duration}>
      <AbsoluteFill
        style={{
          fontFamily: FONT,
          alignItems: "center",
          paddingTop: 54,
          gap: 36,
        }}
      >
        <div
          style={{
            opacity: enter,
            transform: `translateY(${(1 - enter) * 60}px)`,
          }}
        >
          <Window shot={SHOTS.usage} maxW={1340} maxH={690} zoom={zoom} />
        </div>
        <div
          style={{
            opacity: bar,
            transform: `translateY(${(1 - bar) * 80}px) scale(${0.9 + bar * 0.1})`,
            borderRadius: 16,
            boxShadow: `0 0 0 2px rgba(217,119,87,${0.25 + glow * 0.6}), 0 0 ${40 + glow * 50}px rgba(217,119,87,${glow * 0.45})`,
          }}
        >
          <Window shot={SHOTS.statusbar} maxW={1340} maxH={130} titlebar={false} />
        </div>
        <div
          style={{
            position: "absolute",
            left: 100,
            right: 100,
            bottom: 62,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <Caption at={40}>
            Rate limits in your <span style={{ color: ACCENT }}>status bar</span>
          </Caption>
        </div>
      </AbsoluteFill>
    </SceneFade>
  );
};
