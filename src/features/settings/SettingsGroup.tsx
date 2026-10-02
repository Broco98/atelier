import { createContext, useContext, type ReactNode } from "react";

// 설정 화면의 틀(판 06 · 「같은 날 더 정한 것」 설정 화면의 정렬 — Codex 설정을 참고했다). **큰 제목 → 구획 제목 → 묶음**
// 차례이고, 묶음의 행은 왼쪽에 이름 · 설명, 오른쪽에 컨트롤이 선다. 넓은 컨트롤(칩 무리 · 글상자 · 미리보기)은 행의 아래
// 줄로 내린다. 디자인 시스템 「Atelier」의 `SettingsGroup`(`.at-set*`)과 같은 규격이고, spec 레이아웃 편집기의 폼도 이 틀을
// 쓴다.
//
// **묶음은 ui-refresh 결정 16의 옅은 면이다** — 테두리도 행 사이 선도 없다. 행마다 옅은 면(`bg-group`)을 칠하고 행 사이
// 2px 틈으로 카드의 흰 면이 비치게 해 가른다. 묶음의 둥근 모서리는 그래서 묶음이 잘라 준다(`overflow-hidden`).

/**
 * 몸의 틀(`.at-set`) — 읽는 폭(`--measure-read`) 가운데에 서고 위 20 · 아래 48이다(ui-refresh 결정 12). 카드 안 여백은
 * 이 상자 밖(스크롤하는 쪽)이 든다 — 안에 두면 글 폭이 여백만큼 준다(프로젝트 상세와 같은 나눔).
 */
export function SettingsBody({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-(--measure-read) pt-5 pb-12">{children}</div>;
}

/** 큰 제목 바로 아래의 머리글 한 문단. */
export function SettingsLead({ children }: { children: ReactNode }) {
  return <p className="mt-2.5 text-ui text-muted-foreground">{children}</p>;
}

/**
 * 구획 하나 — 구획 제목과 그 아래 묶음. 구획 제목은 **제목 요소가 아니다**: 페이지의 제목 역할은 큰 제목 하나가 지고
 * (`SettingsPage`), 접근성 트리의 제목 · 영역은 이 틀로 바뀌기 전과 같다(판 06 「지키는 것」). 묶음이 하나뿐인 쪽은 구획
 * 제목 없이 묶음만 선다 — 자리(큰 제목에서 28)는 같다.
 */
export function SettingsSection({ head, children }: { head?: string; children: ReactNode }) {
  return (
    <div className="mt-7">
      {head !== undefined && <div className="mb-2.5 text-row font-semibold">{head}</div>}
      {children}
    </div>
  );
}

/** 바닥 줄 — 저장 같은 폼 버튼이 마지막 묶음 아래 오른쪽 끝에 선다. 실패 글은 버튼의 왼쪽이다. */
export function SettingsFoot({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex items-center justify-end gap-2">{children}</div>;
}

/** 묶음이 목록인가 — 그러면 행이 `li`로 선다. 묶음의 `as` 하나가 둘을 함께 바꾼다. */
const InList = createContext(false);

/**
 * 묶음 — 행 사이 2px 틈 · `rounded-card`. 목록 의미가 있는 자리(spec 레이아웃의 레이아웃 줄)는 `as="ul"`이고, 그 안의
 * `SettingsRow`가 저절로 `li`가 된다.
 */
export function SettingsGroup({ as: Tag = "div", children }: { as?: "div" | "ul"; children: ReactNode }) {
  return (
    <InList.Provider value={Tag === "ul"}>
      <Tag className="flex flex-col gap-0.5 overflow-hidden rounded-card">{children}</Tag>
    </InList.Provider>
  );
}

/**
 * 묶음의 행 하나(`.at-set-row`) — 격자 두 열(`minmax(0,1fr) auto`), 열 틈 24 · 줄 틈 12 · 최소 높이 64 · 안쪽 14 20.
 *
 * - 왼쪽: 이름(`text-row` 500)과 그 꼬리 자리 하나(「고침」 꼬리표 등), 그 아래 설명(`text-ui` muted-foreground).
 * - 오른쪽: 컨트롤 — 끝 맞춤, 틈 8.
 * - 아래 줄: 넓은 컨트롤이 두 열을 다 쓴다. 그 안의 미리보기 · 코드 상자는 옅은 면 위의 흰 면(`bg-card`)이다.
 *
 * `nameFor`를 주면 이름 칸이 그 컨트롤의 `<label>`이다 — 이름 글자를 눌러도 컨트롤이 받는다(설정의 스위치). 컨트롤의
 * 이름을 따로 정하지 않은 자리에서는 이 글자가 곧 이름이다. `descriptionId`는 설명 줄의 id다 — 컨트롤이
 * `aria-describedby`로 가리킨다.
 */
export function SettingsRow({
  name,
  nameFor,
  tail,
  description,
  descriptionId,
  control,
  below,
}: {
  name: ReactNode;
  nameFor?: string;
  tail?: ReactNode;
  description?: ReactNode;
  descriptionId?: string;
  control?: ReactNode;
  below?: ReactNode;
}) {
  const Tag = useContext(InList) ? "li" : "div";
  return (
    <Tag
      data-slot="settings-row"
      className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-3 bg-group px-5 py-3.5"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          {nameFor === undefined ? (
            <span className="text-row font-medium">{name}</span>
          ) : (
            <label htmlFor={nameFor} className="text-row font-medium select-none">
              {name}
            </label>
          )}
          {tail}
        </div>
        {description !== undefined && (
          <div id={descriptionId} className="text-ui break-words text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {control !== undefined && (
        <div className="flex min-w-0 items-center justify-end gap-2">{control}</div>
      )}
      {below !== undefined && <div className="col-span-full min-w-0">{below}</div>}
    </Tag>
  );
}
