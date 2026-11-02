// `requestAnimationFrame` 간격을 재는 손(restart 티켓 01b-9). 시스템 `WKWebView`에는 `longtask`와 `long-animation-frame`이 없어 이 간격이 화면이
// 멈춘 길이다(스펙 「Testing Decisions · 소유자의 live 점검」). 개발 빌드의 부하 점검(`features/thread/stream-load.ts`)만 부른다.

/** 긴 간격 하나 — 시작한 프레임의 때, 길이, 그 프레임의 표지. */
export interface FrameGap<Note = unknown> {
  at: number;
  gap: number;
  note: Note | null;
}

export interface FrameGapReport<Note = unknown> {
  frames: number;
  maxGap: number;
  medianGap: number;
  /** 문턱을 넘은 간격 수. 문턱과 같은 간격은 넘지 않은 것이다. */
  overLimit: number;
  /** 긴 간격들 — 큰 차례다. */
  worst: FrameGap<Note>[];
}

interface ReportOptions<Note> {
  /** 남길 긴 간격 수. */
  keep?: number;
  noteAt?: (frame: number) => Note;
}

/** 프레임의 때들 → 간격 보고. */
export function frameGapReport<Note = unknown>(
  stamps: readonly number[],
  limit: number,
  { keep = 20, noteAt }: ReportOptions<Note> = {},
): FrameGapReport<Note> {
  const gaps = stamps.slice(1).map((stamp, frame) => ({ frame, gap: stamp - stamps[frame] }));
  const longest = [...gaps].sort((a, b) => b.gap - a.gap);
  return {
    frames: stamps.length,
    maxGap: longest[0]?.gap ?? 0,
    medianGap: longest[Math.floor(gaps.length / 2)]?.gap ?? 0,
    overLimit: gaps.filter(({ gap }) => gap > limit).length,
    worst: longest.slice(0, keep).map(({ frame, gap }) => ({ at: stamps[frame], gap, note: noteAt?.(frame) ?? null })),
  };
}

/** 도는 프레임 기록 — 프레임마다 때와 표지를 쌓는다. */
export interface FrameRecording<Note> {
  stamps: () => readonly number[];
  notes: () => readonly Note[];
  stop: () => void;
}

/** 프레임 기록을 건다. `note`는 프레임마다 그때의 값을 하나 읽는다 — 긴 간격이 어떤 때였는지를 말한다. */
export function recordFrames<Note = undefined>(
  request: (callback: FrameRequestCallback) => unknown,
  note?: () => Note,
): FrameRecording<Note> {
  const stamps: number[] = [];
  const notes: Note[] = [];
  let running = true;
  const frame: FrameRequestCallback = (time) => {
    if (!running) return;
    stamps.push(time);
    if (note) notes.push(note());
    request(frame);
  };
  request(frame);
  return {
    stamps: () => stamps,
    notes: () => notes,
    stop: () => {
      running = false;
    },
  };
}
