import { useEffect, useId, useRef } from "react";
import { ArrowUp, Database, FilePen, Folder, GitMerge, SquareTerminal, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DecisionItem } from "./work-proposal";

// 「결정은 내가 합니다」 카드(v1 티켓 30 · S31 · 스토리 93 · 캔버스 Cards 보드 「Work 만들기 · 처음 한 번」) — 처음 Work를 만들면 한 번
// 입력창 자리에 선다. Host가 묻고 하는 일(Library Host 정의의 `ask_before` — 기본 파일이면 데이터베이스 스키마 · push)과 Work 밖
// Project를 건드리기 전에 묻는다는 것(S22)을 알린다. 줄은 `decisionItems`가 정의에서 짓는다(코드 리뷰 1차 B7). 「알겠어요」는 본 것을
// 앱 설정에 적고(`seen.decisions`), 「Policy 바꾸기」는 적은 뒤 Library의 Host 파일로 간다. 걸린 물음(승인 · Work 만들기 카드)이 있으면 그것이 먼저 선다 — 이 카드는 기다리는 이가 없는 안내다.
//
// 모양은 보드의 `.ctrl`이다 — r20 · 카드 그림자 · 흰 면 · 안쪽 18, 칸 사이 12. 제목 16 600, 글 13/20 `fg-secondary`, 줄은 아이콘 상자
// (28 · `fill-soft` · `fg-secondary`)와 14/20 글이고, 아래 줄은 왼쪽에 조용한 「Policy 바꾸기」, 오른쪽에 「알겠어요」다.

/** 줄의 아이콘 — 보드의 셋(스키마 · push · Work 밖 Project)에 나머지 갈래를 더했다. */
const ICONS: Readonly<Record<DecisionItem["kind"], LucideIcon>> = {
  schema: Database,
  push: ArrowUp,
  merge: GitMerge,
  edit: FilePen,
  shell: SquareTerminal,
  command: SquareTerminal,
  project: Folder,
};

interface DecisionsCardProps {
  /** 카드의 줄 — 차례대로 선다. */
  items: readonly DecisionItem[];
  /** 「알겠어요」 — 본 것을 적는다. */
  onDone: () => void;
  /** 「Policy 바꾸기」 — 본 것을 적고 Host 파일로 간다. */
  onPolicy: () => void;
}

function DecisionsCard({ items, onDone, onPolicy }: DecisionsCardProps) {
  const titleId = useId();
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const holder = document.activeElement;
    if (holder === null || holder === document.body) box.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section
      ref={box}
      aria-labelledby={titleId}
      tabIndex={-1}
      className="flex shrink-0 flex-col gap-3 rounded-3xl bg-surface p-4.5 shadow-card outline-none"
    >
      <h2 id={titleId} className="text-heading-xs text-fg">
        결정은 내가 합니다
      </h2>
      <p className="text-chat-meta leading-5 text-fg-secondary">
        Host는 아래 일을 하기 전에 늘 먼저 물어봐요. 나머지는 입력창에서 고른 물어보는 정도를 따라요.
      </p>
      <ul className="flex flex-col gap-1.5">
        {items.map(({ kind, text }) => {
          const Icon = ICONS[kind];
          return (
            <li key={text} className="flex items-center gap-2.5 text-sm text-fg">
              <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-fill-soft text-fg-secondary">
                <Icon className="size-3.5" />
              </span>
              {text}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-2 pt-0.5">
        <Button variant="ghost" className="px-1" onClick={onPolicy}>
          Policy 바꾸기
        </Button>
        <span className="flex-1" />
        <Button onClick={onDone}>알겠어요</Button>
      </div>
    </section>
  );
}

export default DecisionsCard;
