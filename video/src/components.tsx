import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { ACCENT, BORDER, FONT, TEXT, type Shot } from "./theme";

const TITLEBAR = 36;

/** Fades a scene in over the first frames and out over the last ones. */
export const SceneFade: React.FC<{
  duration: number;
  edge?: number;
  children: React.ReactNode;
}> = ({ duration, edge = 9, children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, edge, duration - edge, duration],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

/** Fit a shot inside a box, keeping its aspect ratio. Returns the rendered image size. */
export const fitShot = (shot: Shot, maxW: number, maxH: number, bar = true) => {
  const availH = bar ? maxH - TITLEBAR : maxH;
  const scale = Math.min(maxW / shot.w, availH / shot.h);
  return { w: Math.round(shot.w * scale), h: Math.round(shot.h * scale) };
};

/**
 * A rounded, shadowed window frame around a screenshot. The image is scaled to
 * fit inside maxW x maxH and never stretched. `zoom` applies a Ken Burns scale
 * inside the clipped image area.
 */
export const Window: React.FC<{
  shot: Shot;
  maxW: number;
  maxH: number;
  zoom?: number;
  zoomOrigin?: string;
  titlebar?: boolean;
  style?: React.CSSProperties;
}> = ({ shot, maxW, maxH, zoom = 1, zoomOrigin = "0% 0%", titlebar = true, style }) => {
  const { w, h } = fitShot(shot, maxW, maxH, titlebar);
  return (
    <div
      style={{
        width: w,
        height: h + (titlebar ? TITLEBAR : 0),
        borderRadius: 14,
        border: `1px solid ${BORDER}`,
        boxShadow: "0 30px 80px rgba(0,0,0,0.6), 0 2px 6px rgba(0,0,0,0.4)",
        overflow: "hidden",
        background: "#2a2a2a",
        boxSizing: "content-box",
        ...style,
      }}
    >
      {titlebar ? (
        <div
          style={{
            height: TITLEBAR,
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingLeft: 14,
            background: "#2b2b2b",
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />
          ))}
        </div>
      ) : null}
      <div style={{ width: w, height: h, overflow: "hidden" }}>
        <Img
          src={staticFile(shot.file)}
          style={{
            width: w,
            height: h,
            display: "block",
            transform: `scale(${zoom})`,
            transformOrigin: zoomOrigin,
          }}
        />
      </div>
    </div>
  );
};

/** A caption line that springs up from below and fades in at frame `at`. */
export const Caption: React.FC<{
  at: number;
  children: React.ReactNode;
  size?: number;
  style?: React.CSSProperties;
}> = ({ at, children, size = 46, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, delay: at, config: { damping: 200, stiffness: 120 } });
  return (
    <div
      style={{
        opacity: p,
        transform: `translateY(${(1 - p) * 30}px)`,
        display: "flex",
        alignItems: "center",
        gap: 18,
        fontFamily: FONT,
        fontSize: size,
        fontWeight: 600,
        color: TEXT,
        letterSpacing: -0.5,
        ...style,
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: 7,
          background: ACCENT,
          flexShrink: 0,
        }}
      />
      <span>{children}</span>
    </div>
  );
};

/** The coral asterisk icon that scales in with a spring at frame `at`. */
export const Icon: React.FC<{ size: number; at?: number; style?: React.CSSProperties }> = ({
  size,
  at = 0,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, delay: at, config: { damping: 12, stiffness: 90, mass: 0.9 } });
  const rot = interpolate(s, [0, 1], [-60, 0]);
  return (
    <Img
      src={staticFile("icon@2x.png")}
      style={{
        width: size,
        height: size,
        transform: `scale(${s}) rotate(${rot}deg)`,
        ...style,
      }}
    />
  );
};
