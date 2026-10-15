import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { SceneFade, Window } from "../components";
import { ACCENT, FONT, MUTED, SHOTS, TEXT } from "../theme";

export const TreeScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const slide = spring({ frame, fps, config: { damping: 22, stiffness: 70, mass: 1.1 } });
  const x = interpolate(slide, [0, 1], [-700, 0]);
  const pan = interpolate(frame, [0, duration], [0, 26]);
  const zoom = interpolate(frame, [0, duration], [1, 1.035]);

  const text = spring({ frame, fps, delay: 12, config: { damping: 200, stiffness: 100 } });
  const line2 = spring({ frame, fps, delay: 30, config: { damping: 200, stiffness: 100 } });

  return (
    <SceneFade duration={duration}>
      <AbsoluteFill style={{ fontFamily: FONT }}>
        <div
          style={{
            position: "absolute",
            left: 150,
            top: 70,
            transform: `translateX(${x + pan}px)`,
          }}
        >
          <Window shot={SHOTS.tree} maxW={560} maxH={940} zoom={zoom} />
        </div>
        <div
          style={{
            position: "absolute",
            left: 720,
            right: 120,
            top: 0,
            bottom: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 34,
          }}
        >
          <div
            style={{
              fontSize: 84,
              fontWeight: 700,
              lineHeight: 1.08,
              color: TEXT,
              letterSpacing: -2.5,
              opacity: text,
              transform: `translateY(${(1 - text) * 40}px)`,
            }}
          >
            Your Claude Code sessions,{" "}
            <span style={{ color: ACCENT }}>grouped by project</span>
          </div>
          <div
            style={{
              fontSize: 40,
              fontWeight: 500,
              lineHeight: 1.3,
              color: MUTED,
              letterSpacing: -0.5,
              opacity: line2,
              transform: `translateY(${(1 - line2) * 30}px)`,
            }}
          >
            Every project, every session, newest first.
            <br />
            Live status dots. No seven-day window.
          </div>
        </div>
      </AbsoluteFill>
    </SceneFade>
  );
};
