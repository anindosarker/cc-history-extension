import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Caption, SceneFade, Window } from "../components";
import { FONT, type Shot } from "../theme";

/** Distance of the push. Larger than any window width, so the two never overlap. */
const PUSH = 2000;

/**
 * Two screenshots shown one after the other: the first springs in, then the
 * second pushes it out from the right. Both windows stay fully opaque during
 * the push so text-heavy screenshots never blend. One caption sits at the bottom.
 */
export const PairScene: React.FC<{
  duration: number;
  first: Shot;
  second: Shot;
  caption: string;
  switchAt?: number;
}> = ({ duration, first, second, caption, switchAt = 58 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 24, stiffness: 80 } });
  const push = spring({
    frame,
    fps,
    delay: switchAt,
    config: { damping: 200, stiffness: 60, mass: 1.2 },
  });

  const firstX = interpolate(enter, [0, 1], [120, 0]) - PUSH * push;
  const secondX = PUSH * (1 - push);
  const showFirst = push < 0.999;
  const showSecond = push > 0.001;

  const zoom = interpolate(frame, [0, duration], [1, 1.03]);
  const box = { maxW: 1600, maxH: 850 };

  return (
    <SceneFade duration={duration}>
      <AbsoluteFill style={{ fontFamily: FONT }}>
        <div
          style={{
            position: "absolute",
            top: 54,
            left: 0,
            right: 0,
            height: 850,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          {showFirst ? (
            <div
              style={{
                position: "absolute",
                opacity: enter,
                transform: `translateX(${firstX}px)`,
              }}
            >
              <Window shot={first} {...box} zoom={zoom} />
            </div>
          ) : null}
          {showSecond ? (
            <div style={{ position: "absolute", transform: `translateX(${secondX}px)` }}>
              <Window shot={second} {...box} zoom={zoom} />
            </div>
          ) : null}
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
          <Caption at={12}>{caption}</Caption>
        </div>
      </AbsoluteFill>
    </SceneFade>
  );
};
