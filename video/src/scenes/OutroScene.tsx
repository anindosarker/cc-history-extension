import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Icon, SceneFade } from "../components";
import { ACCENT, BORDER, FONT, MONO, MUTED, TEXT } from "../theme";

const Rise: React.FC<{ at: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  at,
  children,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, delay: at, config: { damping: 200, stiffness: 110 } });
  return (
    <div style={{ opacity: p, transform: `translateY(${(1 - p) * 34}px)`, ...style }}>
      {children}
    </div>
  );
};

export const OutroScene: React.FC<{ duration: number }> = ({ duration }) => (
  <SceneFade duration={duration}>
    <AbsoluteFill
      style={{
        fontFamily: FONT,
        alignItems: "center",
        justifyContent: "center",
        gap: 30,
      }}
    >
      <Rise at={4} style={{ display: "flex", alignItems: "center", gap: 34 }}>
        <Icon size={128} at={0} />
        <div style={{ fontSize: 92, fontWeight: 700, color: TEXT, letterSpacing: -2.5 }}>
          Claude Code History
        </div>
      </Rise>
      <Rise at={16}>
        <div style={{ fontSize: 44, fontWeight: 500, color: MUTED, letterSpacing: -0.5 }}>
          Free and open source
        </div>
      </Rise>
      <Rise at={26} style={{ marginTop: 16 }}>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 38,
            color: TEXT,
            background: "#2a2a2a",
            border: `1px solid ${BORDER}`,
            borderRadius: 14,
            padding: "22px 40px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          }}
        >
          <span style={{ color: MUTED }}>$ </span>code --install-extension cc-history-0.4.0.vsix
        </div>
      </Rise>
      <Rise at={36}>
        <div style={{ fontSize: 38, fontWeight: 600, color: ACCENT, letterSpacing: -0.5 }}>
          github.com/anindosarker/cc-history-extension
        </div>
      </Rise>
    </AbsoluteFill>
  </SceneFade>
);
