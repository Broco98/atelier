import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// 설정 화면의 틀(판 06 · 「같은 날 더 정한 것」 설정 화면의 정렬 — Codex 설정을 참고했다). **큰 제목 → 구획 제목 → 묶음**
// 차례이고, 묶음의 행은 왼쪽에 이름 · 설명, 오른쪽에 컨트롤이 선다. 넓은 컨트롤(칩 무리 · 글상자 · 미리보기)은 행의 아래
// 줄로 내린다. 디자인 시스템 「Atelier」의 `SettingsGroup`(`.at-set*`)이고(codex-ds 티켓 23), spec 레이아웃 편집기의 폼도 이 틀을
// 쓴다.
//
// **묶음은 DS의 흰 묶음이다** — 카드 안의 흰 면(`surface`) · `radius-xl` · 0.5px `border-heavy` 링이고, 행 사이는 0.5px 선이
// 가른다(DS `.at-set-group`). 프로젝트 상세의 흰 목록 묶음(`ProjectDetail`의 `LIST`, DS `.at-list`)과 같은 얼굴이다. 한때는
// ui-refresh 결정 16의 옅은 면 묶음이었다(행마다 `surface-under`, 행 사이 2px 틈).

/**
 * 몸의 틀(`.at-set`) — 글 폭(`size-thread`) 가운데에 서고 위 24 · 아래 48이다(DS 「글 거터 20 · 위 24」). 글 거터(옆 20)는 이 상자
 * 밖(스크롤하는 쪽)이 들어 글자가 서는 폭이 48rem 그대로다 — 문서 글(`bodyColumn`)과 같은 나눔이고, 스펙 2절 「글 폭은 `size-thread`」를
 * 글자의 폭으로 읽은 것이다(DS `tokens.json`의 `size-thread` 「문서 · 설정 글 폭 상한」). 프로젝트 상세(`ProjectDetail`)도 같은 나눔이라
 * 넓은 창에서 세 화면의 글 폭이 같다. DS 미리보기 `.at-set`은 거터를 이 폭 **안**에 두어(border-box) 글자가 48rem − 40이다 — 앱은 글
 * 폭 상한을 글자에 거는 쪽을 골랐다(codex-ds 티켓 25).
 */
export function SettingsBody({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-(--size-thread) pt-6 pb-12">{children}</div>;
}

/** 큰 제목 바로 아래의 머리글 한 문단(DS `.at-set-lead` — 14/20 `fg-secondary`, 제목에서 4). */
export function SettingsLead({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-sm text-fg-secondary">{children}</p>;
}

/**
 * 구획 하나 — 구획 제목과 그 아래 묶음. 구획 제목은 **제목 요소가 아니다**: 페이지의 제목 역할은 큰 제목 하나가 지고
 * (`SettingsPage`), 접근성 트리의 제목 · 영역은 이 틀로 바뀌기 전과 같다(판 06 「지키는 것」). 묶음이 하나뿐인 쪽은 구획
 * 제목 없이 묶음만 선다 — 자리(큰 제목에서 28)는 같다. 구획 제목은 14/20 · 600에 왼쪽 2, 묶음까지 10이다(DS `.at-set-sec`).
 */
export function SettingsSection({ head, children }: { head?: string; children: ReactNode }) {
  return (
    <div className="mt-7">
      {head !== undefined && <div className="mb-2.5 pl-0.5 text-sm font-semibold">{head}</div>}
      {children}
    </div>
  );
}

/**
 * 바닥 줄 — 폼 버튼(에이전트 훅의 설치 · 제거)이 마지막 묶음 아래 오른쪽 끝에 선다(DS 「저장은 마지막 묶음 아래 오른쪽 끝」 — 구획
 * 사이와 같은 28). 실패 글은 버튼의 왼쪽이다. 쪽의 저장은 여기가 아니라 머리 카드에 선다(codex-ds 스펙 §7 — `SettingsPage`의
 * `SaveButton`).
 */
export function SettingsFoot({ children }: { children: ReactNode }) {
  return <div className="mt-7 flex items-center justify-end gap-2">{children}</div>;
}

/** 묶음이 목록인가 — 그러면 행이 `li`로 선다. 묶음의 `as` 하나가 둘을 함께 바꾼다. */
const InList = createContext(false);

/**
 * 묶음 — 흰 면 · `radius-xl` · 0.5px `border-heavy` 링(DS `.at-set-group`의 `0 0 0 0.5px border-heavy`). 행 사이 선은 행이 든다(`SettingsRow`). 목록 의미가 있는 자리(spec
 * 레이아웃의 레이아웃 줄)는 `as="ul"`이고, 그 안의 `SettingsRow`가 저절로 `li`가 된다. 표식 `data-slot`은 그 모양을 재는 검사가 집는다
 * (e2e `settings-group`).
 */
export function SettingsGroup({ as: Tag = "div", children }: { as?: "div" | "ul"; children: ReactNode }) {
  return (
    <InList.Provider value={Tag === "ul"}>
      <Tag data-slot="settings-group" className="flex flex-col rounded-xl bg-surface ring-[0.5px] ring-border-heavy">
        {children}
      </Tag>
    </InList.Provider>
  );
}

/**
 * 묶음의 행 하나(`.at-set-row`) — 격자 두 열(`minmax(0,1fr) auto`), 열 틈 16 · 줄 틈 12 · 최소 높이 60 · 안쪽 12 16. 둘째 행부터는
 * 위끝에 0.5px `border-heavy` 선이 선다(DS 「행 사이 hairline」) — 테두리가 아니라 위끝에 겹쳐 칠한 면(`::before`)이라 자리를 먹지
 * 않는다(0.5px 테두리는 엔진마다 굵기가 갈린다 — 앱의 다른 0.5px 선과 같은 손버릇).
 *
 * - 왼쪽: 이름(`text-sm` 500)과 그 꼬리 자리 하나(「고침」 꼬리표 등), 그 아래 설명(`text-chat-meta` `fg-secondary` — 읽는 글이라
 *   DS 값 `fg-tertiary`보다 한 단 짙다, codex-ds 스펙 S17).
 * - 오른쪽: 컨트롤 — 끝 맞춤, 틈 8.
 * - 아래 줄: 넓은 컨트롤이 두 열을 다 쓴다.
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
      className={cn(
        "relative grid min-h-15 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-4 py-3",
        "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-[0.5px] before:bg-border-heavy first:before:hidden",
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          {nameFor === undefined ? (
            <span className="text-sm font-medium">{name}</span>
          ) : (
            <label htmlFor={nameFor} className="text-sm font-medium select-none">
              {name}
            </label>
          )}
          {tail}
        </div>
        {description !== undefined && (
          <div id={descriptionId} className="text-chat-meta break-words text-fg-secondary">
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
