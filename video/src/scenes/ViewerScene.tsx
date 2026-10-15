import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Caption, SceneFade, Window } from "../components";
import { FONT, SHOTS } from "../theme";

/** Frame at which viewer.png dips to the background and search.png takes over. */
const SWITCH_AT = 98;
const DIP = 8;

export const ViewerScene: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();

  const zoom = interpolate(frame, [0, duration], [1, 1.035]);
  // Dip to background: the first window fades out fully before the second fades in,
  // so two text-heavy screenshots never blend.
  const viewerOpacity = interpolate(frame, [SWITCH_AT, SWITCH_AT + DIP], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const searchOpacity = interpolate(frame, [SWITCH_AT + DIP, SWITCH_AT + DIP * 2], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const showSearch = frame >= SWITCH_AT + DIP;

  const box = { maxW: 1700, maxH: 870 };

  return (
    <SceneFade duration={duration}>
      <AbsoluteFill style={{ fontFamily: FONT }}>
        <div
          style={{
            position: "absolute",
            top: 44,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
          }}
        >
          {showSearch ? (
            <div style={{ opacity: searchOpacity }}>
              <Window shot={SHOTS.search} {...box} zoom={zoom} />
            </div>
          ) : (
            <div style={{ opacity: viewerOpacity }}>
              <Window shot={SHOTS.viewer} {...box} zoom={zoom} />
            </div>
          )}
        </div>
        <div
          style={{
            position: "absolute",
            left: 100,
            right: 100,
            bottom: 62,
            display: "flex",
            justifyContent: "center",
            gap: 70,
          }}
        >
          <Caption at={14}>Search inside a session</Caption>
          <Caption at={40}>Folds for tool runs</Caption>
          <Caption at={66}>Clickable file paths</Caption>
        </div>
      </AbsoluteFill>
    </SceneFade>
  );
};
