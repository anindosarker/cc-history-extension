import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { BG } from "./theme";
import { TitleScene } from "./scenes/TitleScene";
import { TreeScene } from "./scenes/TreeScene";
import { ViewerScene } from "./scenes/ViewerScene";
import { PairScene } from "./scenes/PairScene";
import { UsageScene } from "./scenes/UsageScene";
import { OutroScene } from "./scenes/OutroScene";
import { SHOTS } from "./theme";

export const FPS = 30;
const s = (sec: number) => Math.round(sec * FPS);

/** Scene boundaries in seconds. */
const T = {
  title: [0, 3.5],
  tree: [3.5, 7],
  viewer: [7, 12],
  agents: [12, 16],
  files: [16, 20],
  usage: [20, 24],
  outro: [24, 27],
} as const;

export const INTRO_DURATION = s(T.outro[1]);

const Scene: React.FC<{ range: readonly [number, number]; children: React.ReactNode }> = ({
  range,
  children,
}) => (
  <Sequence from={s(range[0])} durationInFrames={s(range[1]) - s(range[0])}>
    {children}
  </Sequence>
);

export const Intro: React.FC = () => (
  <AbsoluteFill style={{ background: BG }}>
    <Scene range={T.title}>
      <TitleScene duration={s(T.title[1]) - s(T.title[0])} />
    </Scene>
    <Scene range={T.tree}>
      <TreeScene duration={s(T.tree[1]) - s(T.tree[0])} />
    </Scene>
    <Scene range={T.viewer}>
      <ViewerScene duration={s(T.viewer[1]) - s(T.viewer[0])} />
    </Scene>
    <Scene range={T.agents}>
      <PairScene
        duration={s(T.agents[1]) - s(T.agents[0])}
        first={SHOTS.agents}
        second={SHOTS.agentView}
        caption="Subagent transcripts, one click away"
      />
    </Scene>
    <Scene range={T.files}>
      <PairScene
        duration={s(T.files[1]) - s(T.files[0])}
        first={SHOTS.files}
        second={SHOTS.diff}
        caption="Every edit, including subagents, as a native diff"
      />
    </Scene>
    <Scene range={T.usage}>
      <UsageScene duration={s(T.usage[1]) - s(T.usage[0])} />
    </Scene>
    <Scene range={T.outro}>
      <OutroScene duration={s(T.outro[1]) - s(T.outro[0])} />
    </Scene>
  </AbsoluteFill>
);
