import { Fragment, type ReactNode } from "react";
import { ChevronRight, CodeXml, Copy, Eye } from "lucide-react";
import { SMALL_GLYPH_STROKE } from "@/components/ui/icon-stroke";
import { SegmentGroup, SegmentGroupItem } from "@/components/ui/segment-group";
import { Hint } from "@/components/ui/tooltip";

// 경로 줄(codex-ds 스펙 §4 「카드 머리 · 경로 줄」 · DS `PathBar` · `.at-pathbar` — codex-ds 결정 12 · 13 · 14 · 27). 문서 카드의 머리 줄이다 —
// 작업 화면에서는 spec 탭의 문서(탭 줄 아래)와 분할의 spec 열(열 머리), Archive에서는 문서 카드에 선다. 한때 그 자리는 흰 알약의
// 위치 캡슐 · 두 칸 원문 전환 · 사각 경로 복사가 따로 선 카드 머리였다(ui-refresh 결정 5 · 7의 B).
//
// - 줄은 48(`--size-pathbar`) = 틈 8 · 컨트롤 32 · 틈 8이다. 아래 선이 없다.
// - 왼쪽은 **경로 캡슐** — 옅은 테두리(1px `border-heavy`) 알약 · 안쪽 12 · `chat-meta`. 앞 칸은 `fg-secondary`, 끝 칸(지금 보는 것)만
//   `fg` 500이고 넘치면 말줄임이다. **캡슐 안 글자는 카드 + 20**(줄 안쪽 8 + 캡슐 안쪽 12) — 아래 문서 글의 거터 20과 한
//   세로줄이다(결정 27 · `SpecViewer`의 `bodyColumn`). 보여 주기만 한다 — 조각은 누르는 칸이 아니다. 위치를 옮기는 길은 사이드바 ·
//   트리 · 팔레트가 든다. 이름은 「위치」다 — 옛 문서 카드 머리의 위치 캡슐이 갖던 이름 그대로라 모양이 바뀌어도 스크린리더와
//   검사가 같은 이름으로 찾는다(codex-ds 스펙 스토리 109).
// - 오른쪽은 **보기 묶음**(문서 | 원문 — 알약 32 안에 원 28 둘, 고른 쪽 `fill-hover`)과 **동그란 버튼**(32 · 1px `border-heavy` 링,
//   사이 4)이다. 동그란 버튼은 경로 복사 하나다.
// - **캡슐 · 원 · 동그라미는 경로 줄의 모양이다**(결정 14 · DS `PathBar` 「규칙」). 경로 캡슐과 동그란 버튼의 모양은 이 파일에,
//   보기 묶음의 알약 · 원은 `SegmentGroup`의 `pill` 크기에 있다. 다른 화면의 카드 머리 위치는 알약 없는 글자 줄이다(`Frame`의
//   `CardPlace`).
// - **닫기 ×는 미리보기에만 단다**(결정 13) — 늘 있는 spec 탭의 문서와 Archive 문서에는 없고, 미리보기는 아직 앱에 없다. 줄 끝
//   칸(`end`)에 서는 것은 분할의 spec 열을 닫는 ×다 — 미리보기 ×가 아니라 열 닫기다(codex-ds 스펙 S14 · `CONTEXT.md` 「열」).

/** 보기 묶음의 칸이 놓인 순서 — 아래 칸을 그리는 순서와 같다. 칩이 이것으로 서는 자리를 안다. */
const VIEWS = ["doc", "source"] as const;

/**
 * 동그란 버튼(DS `.at-cib`) — 32 원 · 1px `border-heavy` 안쪽 링 · `fg-secondary` 글리프, 가리키면 `fill-soft` 면에 `fg`다. 원은 경로
 * 줄의 모양이라(결정 14) 아이콘 버튼 규격(`icon-button` — 각진 28 · 24 · 26 · 16)의 단으로 두지 않는다.
 */
const ROUND =
  "flex size-8 shrink-0 items-center justify-center rounded-full text-fg-secondary inset-ring inset-ring-border-heavy transition-colors outline-none hover:bg-fill-soft hover:text-fg focus-ring";

/**
 * 뿌리부터 지금 선 곳까지의 조각 — 사이에 셰브런(12 · `fg-tertiary`)이 서고, 끝 조각만 `fg` 500에 넘치면 말줄임이다. 앞 조각은 제
 * 폭 그대로라 줄에 눌리면 줄어드는 몫은 끝 조각이 받는다. 같은 글자의 조각이 둘 설 수 있어(폴더 이름) 자리를 키로 쓴다.
 *
 * 경로 캡슐이 이것을 알약 안에 담고, 카드 머리(`CardHead`)의 위치 글자가 알약 없이 담는다 — 조각을 읽는 규칙이 한 벌이다.
 */
export function PathPieces({ items }: { items: readonly string[] }) {
  const last = items.length - 1;
  return items.map((item, index) => (
    <Fragment key={index}>
      {index > 0 && <ChevronRight aria-hidden className="size-3 shrink-0 text-fg-tertiary" strokeWidth={SMALL_GLYPH_STROKE} />}
      {index === last ? (
        <span aria-current="page" className="min-w-0 truncate font-medium text-fg">
          {item}
        </span>
      ) : (
        <span className="shrink-0">{item}</span>
      )}
    </Fragment>
  ));
}

export interface PathView {
  /** 지금 원문 보기인가 — 사람이 정한 값이지 본문이 소스인가가 아니다(`WorksPage`의 `showSource` 주석). */
  source: boolean;
  /** 두 칸을 함께 잠근다 — 본문이 이 묶음을 따르지 않는 파일(`ignoresViewSwitch`) · 문서가 하나도 없는 work. */
  locked: boolean;
  onChange: (source: boolean) => void;
}

/**
 * 경로 줄 하나. `path`는 뿌리부터 지금 보는 파일까지다(작업 화면 `slug › spec › …`, Archive `slug › …` — 아카이브의 경로는 work
 * 폴더 기준이다). `onCopy`가 없으면(가리킬 파일이 없다) 경로 복사가 서지 않는다 — 눌러도 아무 일이 없는 버튼이 된다(결정 11 · 21).
 * 줄은 `div`이고 끌기 영역이 아니다(카드 안이다). `data-*` 표식은 검사가 정체성으로 집는 것이다(분할 열 머리의 `data-column`).
 */
export function PathBar({
  path,
  view,
  onCopy,
  end,
  ...marks
}: {
  path: readonly string[];
  view: PathView;
  onCopy?: () => void;
  /** 줄 끝 칸 — 동그란 버튼 뒤에 사이 4로 선다. 분할의 spec 열을 닫는 ×다. */
  end?: ReactNode;
  [mark: `data-${string}`]: string | undefined;
}) {
  return (
    <div {...marks} data-slot="path-bar" className="flex h-(--size-pathbar) shrink-0 items-center gap-2 px-2">
      {/* 캡슐은 줄에 눌리면 줄어든다. 줄어드는 몫은 끝 조각의 말줄임이 받고, 끝 조각이 다 줄어도 모자라면(가장 좁게 끈 분할 열)
          캡슐이 넘침을 자른다 — 앞 조각이 알약 밖으로 나와 보기 묶음 밑까지 칠해지지 않는다. */}
      <nav
        aria-label="위치"
        className="flex h-8 min-w-0 items-center gap-1.5 overflow-hidden rounded-full px-3 text-chat-meta whitespace-nowrap text-fg-secondary inset-ring inset-ring-border-heavy"
      >
        <PathPieces items={path} />
      </nav>
      <ViewSwitch {...view} />
      <div className="flex shrink-0 items-center gap-1">
        {onCopy && (
          <Hint text="경로 복사" announce="name" type="button" onClick={onCopy} className={ROUND}>
            <Copy aria-hidden className="size-4" />
          </Hint>
        )}
        {end}
      </div>
    </div>
  );
}

// 보기 묶음 — 지금 보고 있는 것이 **문서인가 원문인가**를 두 칸으로 말한다(결정 33). 한때 `</>` 하나가 켜졌다 꺼졌다 — 「지금
// 원문이다」와 「누르면 원문으로 간다」가 한 버튼의 농도 한 단계에 걸려, 포인터를 얹은 채로는 둘이 사실상 같은 색이었다. 두 칸이면
// 어느 칸이 서 있는가가 그 말을 대신한다: 색이 아니라 **자리**가 모드를 적는다.
//
// **어느 칸을 눌러도 뒤집힌다.** 세그먼트의 관습(선 칸을 눌러도 아무 일이 없다)을 안 따른다 — 상태가 둘뿐이라 「선 칸을 누른다」가
// 뜻할 수 있는 것은 「반대로 간다」 하나뿐이고, 아무 일도 안 일어나는 자리는 안 듣는 버튼으로 읽힌다. 부품은 선 칸을 누르면 값을
// 비우는데(`[]`) 여기서는 그것을 뒤집기로 읽는다(S16 — 편집기의 종류 · 템플릿은 같은 `[]`를 버린다).
//
// **두 칸을 함께 잠근다**(결정 21) — 한 칸만 잠그면 잠긴 채로도 반대 칸이 눌려 「눌리는데 아무 일도 안 난다」가 되살아난다. 잠김은
// 그룹의 `disabled`라 칸마다 네이티브 `disabled`가 되고 칩까지 부품이 흐린다. 잠김은 켜짐을 건드리지 않는다 — 선 칸은 사람이 정한
// 값 그대로 선다.
//
// 한 컨트롤이라 Tab 자리가 하나이고(첫 칸 — S30), 그 안에서는 ←/→로 옮긴다(`SegmentGroup` — Base UI ToggleGroup 위, 결정 1 · 판 4).
// 모양(알약 · 원 · 칩)은 부품의 `pill` 크기가 든다.
function ViewSwitch({ source, locked, onChange }: PathView) {
  return (
    <SegmentGroup
      size="pill"
      cells={VIEWS}
      value={[source ? "source" : "doc"]}
      // 선 칸을 눌러 비운 값(`[]`)도 뒤집기다 — 두 칸이 한 토글의 두 얼굴이다(위 주석).
      onValueChange={([pick]) => onChange(pick === undefined ? !source : pick === "source")}
      disabled={locked}
      className="ml-auto"
    >
      <View value="doc" label="문서로 보기" locked={locked}>
        <Eye aria-hidden className="size-4" />
      </View>
      <View value="source" label="원문 보기" locked={locked}>
        <CodeXml aria-hidden className="size-4" />
      </View>
    </SegmentGroup>
  );
}

function View({
  value,
  label,
  locked,
  children,
}: {
  value: (typeof VIEWS)[number];
  label: string;
  locked: boolean;
  children: ReactNode;
}) {
  return (
    // 이름은 글리프가 못 말하니 `aria-label`이 든다. 도움말은 같은 글자의 툴팁이다 — 이름보다 더 말하는 것이 없어 설명
    // (`aria-description`)은 안 단다(S28). **잠기면 툴팁도 없다**(S23) — 칸이 네이티브 `disabled`다.
    <Hint text={label} announce="name" disabled={locked} render={<SegmentGroupItem value={value} />}>
      {children}
    </Hint>
  );
}
