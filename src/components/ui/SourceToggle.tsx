import type { ReactNode } from "react";
import { CodeXml, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

// 지금 보고 있는 것이 **문서인가 원문인가**를 두 칸으로 말한다(결정 33).
//
// 한때 `</>` 하나가 켜졌다 꺼졌다. 그 판에서는 「지금 원문이다」와 「누르면 원문으로 간다」가
// 한 버튼의 **농도 한 단계**에 걸려 있었다 — 켜짐(state-3)과 hover(state-2)의 차이가 그 말
// 전부라, 포인터를 얹은 채로는 둘이 사실상 같은 색이었다. 두 칸이면 어느 칸이 서 있는가가
// 그 말을 대신한다: 색이 아니라 **자리**가 모드를 적는다.
//
// **어느 칸을 눌러도 뒤집힌다.** 세그먼트 컨트롤의 관습은 선 칸이 눌려도 아무 일이 없는
// 것인데, 여기서는 그 관습을 안 따른다 — 상태가 둘뿐이라 「선 칸을 누른다」가 뜻할 수 있는
// 것은 「반대로 간다」 하나뿐이고, 아무 일도 안 일어나는 자리는 그저 안 듣는 버튼으로 읽힌다.
// 두 칸은 **모드를 읽는 자리**이지 각자 목적지를 가진 두 버튼이 아니다.
//
// 잠김도 그대로 흐림 + 포인터 차단이다(`ignoresSourceToggle`이 참인 파일 · spec 0개 ·
// 터미널 탭 — 어느 파일이 토글을 무시하는지는 `doc-refs`의 표가 든다).
// **두 칸을 함께 잠근다**: 한 칸만 잠그면 잠긴 채로도 반대 칸이 눌려, 결정 21이 없애려던
// 「눌리는데 아무 일도 안 난다」가 그 자리에서 되살아난다.
export function SourceToggle({
  on,
  locked = false,
  onChange,
  className,
}: {
  /** 지금 원문 보기인가. 사람이 정한 값이지 본문이 소스인가가 아니다(WorkPanel 주석). */
  on: boolean;
  locked?: boolean;
  onChange: (source: boolean) => void;
  className?: string;
}) {
  return (
    // 바닥이 한 단계 눌려 있어야 그 위의 칩이 **떠오른 것**으로 읽힌다.
    <span
      className={cn(
        "relative flex shrink-0 items-center gap-0.5 rounded-[10px] bg-state-1 p-0.5",
        className,
      )}
    >
      {/* 서 있는 칸을 말하는 흰 칩. 칸에 붙어 있지 않고 **두 칸 사이를 미끄러진다.**
          자리가 모드를 적는다면(위 주석) 그 자리가 바뀌는 것도 보여야 한다 — 칸마다 배경을
          켜고 끄면 한쪽이 사라지고 다른 쪽이 나타날 뿐이라 「옮겨갔다」가 아니라 「깜빡였다」로
          읽힌다. 칩이 하나뿐이라 두 칸이 동시에 서는 판이 마크업에서 아예 불가능해지는 것은
          덤이다.
          26px은 칸 24px(icon-button) + 칸 사이 2px(gap-0.5)이다 — 둘 다 고정값이라
          calc 없이 적는다. 곡선은 패널의 --ease-panel이 아니라 ease-out이다: 그 곡선은
          폭처럼 긴 거리를 위한 것이고(index.css 주석) 여기 거리는 26px이라, 같은 곡선을
          쓰면 짧은 이동이 끝에서 질질 끌린다.
          transform만 트랜지션한다 — 잠김의 흐림까지 함께 페이드하면 파일을 옮길 때마다
          칩이 저 혼자 밝아졌다 어두워진다. */}
      <span
        aria-hidden
        className={cn(
          "segment-on absolute top-0.5 left-0.5 size-6 rounded-lg transition-transform duration-[180ms] ease-out",
          on && "translate-x-[26px]",
          locked && "opacity-40",
        )}
      />
      <Segment on={!on} locked={locked} label="문서로 보기" onFlip={() => onChange(!on)}>
        <Eye className="size-3.5" strokeWidth={1.9} />
      </Segment>
      <Segment on={on} locked={locked} label="원문 보기" onFlip={() => onChange(!on)}>
        <CodeXml className="size-3.5" strokeWidth={2} />
      </Segment>
    </span>
  );
}

function Segment({
  on,
  locked,
  label,
  onFlip,
  children,
}: {
  on: boolean;
  locked: boolean;
  label: string;
  onFlip: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      // 선 칸도 그대로 뒤집는다(위 주석) — 두 칸이 한 토글의 두 얼굴이다.
      onClick={onFlip}
      disabled={locked}
      aria-label={label}
      aria-pressed={on}
      title={label}
      className={cn(
        // relative가 칩 위로 아이콘을 올린다 — 칩이 absolute라 그냥 두면 글리프를 덮는다.
        "icon-button relative transition-colors",
        "disabled:pointer-events-none disabled:opacity-40",
        // 안 선 칸은 **배경을 안 켠다**(결정 31) — 바닥이 이미 회색이라 그 위에 hover 칩을
        // 얹으면 서 있는 칸과 구분이 안 된다.
        on ? "text-foreground" : "text-tertiary tint-hover",
      )}
    >
      {children}
    </button>
  );
}
