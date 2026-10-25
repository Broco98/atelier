import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { faceOf, type Avatar, type FaceColor, type FaceShape } from "./faces";
import HostFace from "./HostFace";

// Agent 얼굴(v1 티켓 14 · 구현 스펙 §6 S36 · 캔버스 Sidebar 보드 「아바타」) — 24 격자의 도형 하나에 세로 눈 둘이다. 모양 · 색은
// `faceOf`가 정하고 여기는 그 이름을 도형 · DS 토큰 클래스로 옮긴다.
//
// - **면은 DS `chat-accent-*`, 눈은 바탕색(`surface`)이다.** 캔버스는 밝은 면에 짙은 눈을 그렸지만 DS의 라이트 `chat-accent-*`는 짙은
//   글자색이라(#055f51 …) 토큰을 쓰고 눈을 Host처럼 밝게 둔다 — 값이 DS 토큰과 다르면 토큰을 쓴다(디자인-참고 README).
// - **Host는 `HostFace`다**(무채색 둥근 사각형 — 05가 세운 그림 그대로).
// - 크기는 자리마다 16~48이다(캔버스 「아바타」 — 메뉴 · 「답하는 중」 20, 칩 16, 목록 32, 빈 Thread 44). 부르는 쪽이 `size-*`로 준다.
// - 그림일 뿐이라 숨는다 — 이름은 곁의 글자가 말한다. 겹친 얼굴 묶음(`FaceStack`)만 제 이름(참여자 이름들)을 든다.

/** 면 · 눈의 도형 — 캔버스 보드의 SVG 그대로(24 격자). 눈은 모양마다 자리가 다르다. */
const SHAPES: Record<Exclude<FaceShape, "square">, { body: (fill: string) => ReactNode; eyes: readonly [number, number, number, number] }> = {
  circle: { body: (fill) => <circle cx="12" cy="12" r="12" className={fill} />, eyes: [10, 15.4, 8.5, 4.6] },
  triangle: {
    body: (fill) => (
      <path
        d="M12 2.5c1.2 0 2.2.7 2.9 1.8l6.6 11.6c1.3 2.3-.3 5.1-2.9 5.1H5.4c-2.6 0-4.2-2.8-2.9-5.1L9.1 4.3C9.8 3.2 10.8 2.5 12 2.5z"
        className={fill}
      />
    ),
    eyes: [9.2, 12.8, 11, 4.2],
  },
  pill: { body: (fill) => <rect x="3" y=".5" width="18" height="23" rx="9" className={fill} />, eyes: [8.4, 13.4, 8, 4.6] },
  drop: {
    body: (fill) => <path d="M12 1.5c4.6 4.3 9 8.3 9 13.1a9 9 0 0 1-18 0C3 9.8 7.4 5.8 12 1.5z" className={fill} />,
    eyes: [8.6, 13.2, 12, 4.4],
  },
};

/** 면의 색 — Tailwind가 찾도록 클래스를 글자 그대로 적는다. */
const FILL: Record<FaceColor, string> = {
  blue: "fill-chat-accent-blue",
  green: "fill-chat-accent-green",
  yellow: "fill-chat-accent-yellow",
  pink: "fill-chat-accent-pink",
  orange: "fill-chat-accent-orange",
  purple: "fill-chat-accent-purple",
  slate: "fill-chat-accent-slate",
  lime: "fill-chat-accent-lime",
  cyan: "fill-chat-accent-cyan",
  magenta: "fill-chat-accent-magenta",
};

export interface AgentFaceProps {
  handle: string;
  avatar?: Avatar | null;
  className?: string;
}

/** Agent 하나의 얼굴. */
export function AgentFace({ handle, avatar, className }: AgentFaceProps) {
  const face = faceOf(handle, avatar);
  if (face.color === null) return <HostFace className={className} />;
  const fill = FILL[face.color];
  if (face.shape === "square") {
    // 파일이 둥근 사각형을 고른 Agent — Host의 모양에 색을 입힌다.
    return (
      <svg viewBox="0 0 24 24" aria-hidden className={cn("shrink-0", className)}>
        <rect width="24" height="24" rx="8" className={fill} />
        <rect x="8" y="8.5" width="2.2" height="4.6" rx="1.1" className="fill-surface" />
        <rect x="13.8" y="8.5" width="2.2" height="4.6" rx="1.1" className="fill-surface" />
      </svg>
    );
  }
  const { body, eyes } = SHAPES[face.shape];
  const [left, right, top, height] = eyes;
  const width = height > 4.3 ? 2.2 : 2;
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("shrink-0", className)}>
      {body(fill)}
      <rect x={left} y={top} width={width} height={height} rx={width / 2} className="fill-surface" />
      <rect x={right} y={top} width={width} height={height} rx={width / 2} className="fill-surface" />
    </svg>
  );
}

/** 겹친 얼굴의 한 사람 — handle · 얼굴과 읽어 줄 이름. */
export interface FacePerson {
  handle: string;
  name: string;
  avatar: Avatar | null;
}

/**
 * 겹친 얼굴(캔버스 「둘이 함께」 · 「셋 넘으면 숫자」 · Messages 「답하는 중 · 여럿」) — 얼굴마다 바탕색 고리 2를 둘러 앞 얼굴에 겹친다.
 * `max`를 넘으면 앞의 `max`명 뒤에 「+n」 알약이 선다. 묶음 하나가 그림 하나라 이름은 참여자 이름들을 잇는다(`label`). 새로 앉은 얼굴이
 * 튀어 들던 갈래(`joining` — 머리 줄의 참여자, v1 「Agent 참여」)는 머리 줄 얼굴이 걷혀(02 S14) 부르는 자리가 없어 02 티켓 12가 걷었다 —
 * Codex에는 그 움직임이 없다.
 */
export function FaceStack({
  people,
  max = people.length,
  label,
  faceClass,
  moreClass = "h-5 min-w-5",
  ringClass = "ring-surface",
  className,
}: {
  people: readonly FacePerson[];
  max?: number;
  /** 묶음의 이름 — 「참여자」 같은 앞말. 이름들이 그 뒤에 붙는다. */
  label: string;
  /** 얼굴 크기(`size-5`). */
  faceClass: string;
  /** 「+n」 알약의 높이 · 최소 폭 — 얼굴과 같은 높이다. */
  moreClass?: string;
  /** 고리 색 — 얼굴이 선 바탕(`ring-surface` · `ring-surface-sidebar`). */
  ringClass?: string;
  className?: string;
}) {
  const shown = people.slice(0, max);
  const more = people.length - shown.length;
  return (
    <span role="img" aria-label={`${label} ${people.map((one) => one.name).join(", ")}`} className={cn("flex shrink-0 items-center", className)}>
      {shown.map((one) => (
        <span key={one.handle} className={cn("flex rounded-full ring-2", ringClass)}>
          <AgentFace handle={one.handle} avatar={one.avatar} className={faceClass} />
        </span>
      ))}
      {more > 0 && (
        <span
          className={cn(
            "flex items-center justify-center rounded-full bg-fill-active px-1 text-2xs font-semibold text-fg-secondary ring-2",
            moreClass,
            ringClass,
          )}
        >
          +{more}
        </span>
      )}
    </span>
  );
}
