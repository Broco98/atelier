import type { ReactNode } from "react";
import { CodeXml, Eye } from "lucide-react";
import { ToggleGroup, ToggleGroupChip, ToggleGroupItem } from "./toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

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
//
// **ToggleGroup의 segment 변형이다**(결정 1, 판 4). 한 컨트롤이라 Tab 자리가 하나이고(첫 칸 — S30),
// 그 안에서는 ←/→로 옮긴다. 부품은 선 칸을 누르면 값을 비우는데(`[]`), 여기서는 그것을 **뒤집기**로
// 읽는다(S16 — 모드 전환은 같은 `[]`를 버린다). 잠김은 그룹의 `disabled`라 칸마다 네이티브
// `disabled`가 되고, 칩까지 부품이 흐린다. 바닥·칩·칸의 모양은 부품 파일(`toggle-group.tsx`)이 든다.
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
    <ToggleGroup
      variant="segment"
      size="icon"
      value={[on ? "source" : "doc"]}
      // 선 칸을 눌러 비운 값(`[]`)도 뒤집기다 — 두 칸이 한 토글의 두 얼굴이다(위 주석).
      onValueChange={([pick]) => onChange(pick === undefined ? !on : pick === "source")}
      disabled={locked}
      className={className}
    >
      <ToggleGroupChip at={on ? 1 : 0} />
      <Segment value="doc" label="문서로 보기" locked={locked}>
        <Eye className="size-3.5" strokeWidth={1.9} />
      </Segment>
      <Segment value="source" label="원문 보기" locked={locked}>
        <CodeXml className="size-3.5" strokeWidth={2} />
      </Segment>
    </ToggleGroup>
  );
}

function Segment({
  value,
  label,
  locked,
  children,
}: {
  value: "doc" | "source";
  label: string;
  locked: boolean;
  children: ReactNode;
}) {
  return (
    // 이름은 글리프가 못 말하니 `aria-label`이 든다. 도움말은 같은 글자의 툴팁이다 — 이름보다 더 말하는 것이
    // 없어 설명(`aria-description`)은 안 단다(S28). **잠기면 툴팁도 없다**(S23) — 칸이 네이티브 `disabled`다.
    <Tooltip>
      <TooltipTrigger disabled={locked} render={<ToggleGroupItem value={value} aria-label={label} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
