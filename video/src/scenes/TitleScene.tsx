import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Icon, SceneFade } from "../components";
import { FONT, MUTED, TEXT } from "../theme";

export const TitleScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const title = spring({ frame, fps, delay: 14, config: { damping: 200, stiffness: 110 } });
  const sub = interpolate(frame, [40, 62], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <SceneFade duration={duration}>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          fontFamily: FONT,
        }}
      >
        <Icon size={190} />
        <div
          style={{
            marginTop: 46,
            fontSize: 104,
            fontWeight: 700,
            color: TEXT,
            letterSpacing: -3,
            opacity: title,
            transform: `translateY(${(1 - title) * 60}px)`,
          }}
        >
          Claude Code History
        </div>
        <div
          style={{
            marginTop: 22,
            fontSize: 44,
            fontWeight: 500,
            color: MUTED,
            letterSpacing: -0.5,
            opacity: sub,
          }}
        >
          Every session. No time cutoff.
        </div>
      </AbsoluteFill>
    </SceneFade>
  );
};
