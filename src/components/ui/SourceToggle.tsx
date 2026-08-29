import type { ReactNode } from "react";
import { CodeXml, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

// 지금 보고 있는 것이 **문서인가 원문인가**를 두 칸으로 말한다(결정 33).
//
// 한때 `</>` 하나가 켜졌다 꺼졌다. 그 판에서는 「지금 원문이다」와 「누르면 원문으로 간다」가
// 한 버튼의 **농도 한 단계**에 걸려 있었다 — 켜짐(state-3)과 hover(state-2)의 차이가 그 말
// 전부라, 포인터를 얹은 채로는 둘이 사실상 같은 색이었다. 두 칸이면 어느 칸이 서 있는가가
// 그 말을 대신한다: 색이 아니라 **자리**가 모드를 적는다.
//
// 하는 일은 그대로다 — 서 있지 않은 칸을 누르면 그때만 `onChange`가 온다. 이미 선 칸을 눌러도
// 아무 일이 없는 것은 화면과 같은 말이다(그 모드에 이미 있다).
//
// 잠김도 그대로 흐림 + 포인터 차단이다(비-md·spec 0개·터미널 탭 — 근거는 WorkPanel 주석).
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
    // 바닥이 한 단계 눌려 있어야 그 위의 칸이 **떠오른 것**으로 읽힌다.
    <span
      className={cn(
        "flex shrink-0 items-center gap-0.5 rounded-[10px] bg-state-1 p-0.5",
        className,
      )}
    >
      <Segment on={!on} locked={locked} label="문서로 보기" onPick={() => onChange(false)}>
        <FileText className="size-3.5" strokeWidth={1.9} />
      </Segment>
      <Segment on={on} locked={locked} label="마크다운 원문 보기" onPick={() => onChange(true)}>
        <CodeXml className="size-3.5" strokeWidth={2} />
      </Segment>
    </span>
  );
}

function Segment({
  on,
  locked,
  label,
  onPick,
  children,
}: {
  on: boolean;
  locked: boolean;
  label: string;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      // 이미 선 칸은 부르지 않는다 — 호출부가 「같은 값이 또 왔다」를 거를 필요가 없다.
      onClick={() => !on && onPick()}
      disabled={locked}
      aria-label={label}
      aria-pressed={on}
      title={label}
      className={cn(
        "icon-button transition-colors",
        "disabled:pointer-events-none disabled:opacity-40",
        // 꺼진 칸은 **배경을 안 켠다**(결정 31) — 바닥이 이미 회색이라 그 위에 hover 칩을
        // 얹으면 서 있는 칸과 구분이 안 된다.
        on ? "segment-on" : "text-tertiary tint-hover",
      )}
    >
      {children}
    </button>
  );
}
