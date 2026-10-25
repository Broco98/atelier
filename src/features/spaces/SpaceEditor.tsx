import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, Eye, FileText, Layers, SquarePen, TriangleAlert } from "lucide-react";
import { PlainFrame } from "@/components/shell/PlainFrame";
import { navItem } from "@/components/shell/nav-items";
import { Button } from "@/components/ui/button";
import { showProblem } from "@/components/ui/confirm-store";
import { useConfirmLeave } from "@/features/spec-layout/leave";
import { cn } from "@/lib/utils";
import { useSaveSpaceText, useSpaceDraft, useSpaces, useSpaceText } from "./hooks";
import { SpaceGraph } from "./SpaceGraph";
import {
  blankSpaceText,
  canSave,
  caretLineOf,
  editHint,
  fileNote,
  firstCaretLine,
  lineChanges,
  lineEndOffset,
  paintLines,
  pieceOfLine,
  pieceSpan,
  previewOf,
  problemPill,
  type EditMode,
  type Piece,
  type Tone,
} from "./space-edit";
import { CARD_GRAPH, spaceName } from "./space-view";
import type { SpaceDraft } from "./types";

// **Space 파일 고치기 화면**(03 구현 스펙 §13 · 시안 F1-SpaceEdit · F4-SpaceNew · F4-SpaceEditErr) — 관계 편집(그 Space의 파일)과 직접
// 만들기(빈 틀의 새 파일)가 함께 쓰는 「파일 칸 | 미리보기 카드」 두 칸이다. 두 칸이 판을 꽉 채우고(46 : 54) 칸 머리는 52, 가운데 경계선이
// 머리까지 이어진다.
//
//   ┌ 뒤로 · 파일 경로 · 고친 줄 N ─┬─ 미리보기 · 알약 · 취소 · 저장 ┐
//   │ 줄 번호 고정폭 편집기          │ 회색 바탕 위 흰 Space 카드    │
//   │ (문제는 그 줄 끝 붉은 글)      │ 이름 / 관계 그래프 / 설명     │
//   └ 안내 줄(넣을 수 있는 Project) ─┴──────────────────────────────┘
//
// - **검사는 core 하나다**(S7) — 글을 고칠 때마다 `check_space`를 부른다. 문제 · 조각 자리 · 새 Space의 파일 이름 · 등록된 Project가 모두
//   그 답이고, 화면은 따로 검사하지 않는다. 저장(`save_space_text`)도 같은 검사로 거절한다.
// - **커서 줄 ↔ 조각** — 커서가 선 줄의 조각(name · projects · 본문)만 양쪽에 같은 파란 막대 + 옅은 면이 서고, 카드 조각에 「3–6행」이
//   붙는다. 처음 커서는 첫 문제 줄 → 새 Space는 name 줄 → 관계 편집은 projects 줄이다(S14).
// - 저장은 문제가 있거나 고친 것이 없거나 지금 글의 검사 답이 아직 오지 않았으면 꺼진다. 저장하면 그 Space 상세로 간다.
// - **저장하지 않은 고침을 두고 떠나면 묻는다**(스토리 178) — 뒤로 · 취소만이 아니라 사이드바 · 사람 메뉴 · ⌘K · ⌘N · 히스토리도. 길마다
//   묻지 않고 Spec 레이아웃 편집기와 같은 라우터의 막기 하나(`useConfirmLeave`)가 모든 이동을 받는다 — 뒤로 · 취소도 그 막기로 묻는다.
// - 판 안의 뿌리는 `PlainFrame`이다 — 그 본문이 제 글 폭을 판 밖에 알리지 않는다(01 결정).

export default function SpaceEditor({ slug }: { slug: string | null }) {
  const mode: EditMode = slug === null ? "new" : "edit";
  const opened = useSpaceText(slug);
  const [blank] = useState(() => blankSpaceText(new Date()));
  const base = slug === null ? blank : opened.data;
  const { data: spaces } = useSpaces();
  const saved = spaces?.find((space) => space.slug === slug);
  const navigate = useNavigate();
  const label = navItem("spaces").label;
  // 뒤로 · 취소가 가는 곳 — 관계 편집은 그 Space 상세, 새 Space는 목록이다. 이 화면을 히스토리에 남기지 않는다.
  const back = () =>
    void (slug === null
      ? navigate({ to: "/spaces", replace: true })
      : navigate({ to: "/spaces/$slug", params: { slug }, replace: true }));
  const crumb = slug === null ? label : saved ? spaceName(saved) : slug;

  return (
    <PlainFrame
      label={mode === "new" ? "새 Space" : `${crumb} 관계 편집`}
      lead={<Crumb label={crumb} />}
      title={{ name: mode === "new" ? "새 Space" : "관계 편집" }}
    >
      {base !== undefined ? (
        <EditorBody mode={mode} slug={slug} base={base} backLabel={crumb} onLeave={back} />
      ) : (
        opened.isError && <p className="px-10 pt-5.5 text-sm text-fg-tertiary">Space 파일을 읽지 못했어요 — {String(opened.error)}</p>
      )}
    </PlainFrame>
  );
}

/** 머리 줄 이름 앞 흐린 「결제 서비스 /」 · 「Space /」(시안 `.tb-c .muted`). 누르는 길은 칸 머리의 뒤로 하나다. */
function Crumb({ label }: { label: string }) {
  return (
    <>
      <span className="min-w-0 truncate text-sm text-fg-titlebar">{label}</span>
      <span aria-hidden className="shrink-0 text-sm text-fg-titlebar">
        /
      </span>
    </>
  );
}

function EditorBody({
  mode,
  slug,
  base,
  backLabel,
  onLeave,
}: {
  mode: EditMode;
  slug: string | null;
  base: string;
  backLabel: string;
  onLeave: () => void;
}) {
  const [text, setText] = useState(base);
  const [caretLine, setCaretLine] = useState<number | null>(null);
  const { data: draft, isPlaceholderData } = useSpaceDraft(slug, text);
  const save = useSaveSpaceText();
  const navigate = useNavigate();
  // 저장한 글 — 저장한 뒤 그 Space 상세로 가는 이동은 떠날 때 확인을 지난다(고친 것이 남지 않았다).
  const [kept, setKept] = useState<string | null>(null);
  const changes = lineChanges(base, text);
  const dirty = text !== base && text !== kept;
  const problems = draft?.space.problems ?? [];
  const pill = problemPill(problems);
  const savable = canSave({ dirty, draft, checked: !isPlaceholderData, saving: save.isPending });
  const piece = draft && caretLine !== null ? pieceOfLine(draft.pieces, caretLine) : null;

  const write = async (): Promise<string | null> => {
    try {
      const space = await save.mutateAsync({ slug, text });
      // 막기가 이 렌더의 값을 읽도록 곧바로 그린다 — 다음 줄의 이동이 「저장하지 않은 고침」으로 붙잡히지 않게.
      flushSync(() => setKept(text));
      return space.slug;
    } catch (e) {
      await showProblem(`Space를 저장하지 못했어요 — ${e}`);
      return null;
    }
  };
  useConfirmLeave({ unsaved: dirty, savable, save: async () => (await write()) !== null });
  const leave = () => onLeave();
  const commit = async () => {
    const saved = await write();
    if (saved !== null) void navigate({ to: "/spaces/$slug", params: { slug: saved }, replace: true });
  };
  const path = draft ? `${draft.folder}/${draft.space.slug || "이름"}.md` : "";

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,46fr)_minmax(0,54fr)] grid-rows-[auto_minmax(0,1fr)]">
      <div className="flex h-13 min-w-0 items-center gap-2.5 border-b border-separator-soft pr-3.5 pl-4">
        <button
          type="button"
          onClick={leave}
          className="inline-flex h-7.5 shrink-0 items-center gap-1.5 rounded-full border border-separator-soft pr-3 pl-2 text-chat-meta text-fg transition-colors hover:bg-fill-soft focus-ring"
        >
          <ArrowLeft aria-hidden className="size-3.5 text-fg-icon" />
          {backLabel}
        </button>
        <span className="flex min-w-0 items-center gap-1.5 text-xs whitespace-nowrap text-fg-secondary">
          <FileText aria-hidden className="size-3.5 shrink-0 text-fg-icon" />
          <span aria-label="파일 경로" className="min-w-0 truncate font-mono">
            {path}
          </span>
        </span>
        {fileNote(mode, changes.count) && (
          <span className="ml-auto shrink-0 text-xs whitespace-nowrap text-fg-tertiary">{fileNote(mode, changes.count)}</span>
        )}
      </div>
      <div className="flex h-13 min-w-0 items-center gap-2.5 border-b border-l border-separator-soft pr-3.5 pl-4">
        <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
          <Eye aria-hidden className="size-4 shrink-0 text-fg-icon" />
          <span className="text-chat-meta font-medium text-fg">미리보기</span>
          <span className="min-w-0 truncate text-xs text-fg-tertiary">
            {mode === "new" ? "Space 목록 · 상세에 이렇게 보여요" : "Space 상세에 이렇게 보여요"}
          </span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {draft && (
            <span
              role="status"
              className={cn(
                "mr-1 inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap",
                pill.ok ? "bg-ok-soft text-fg-ok" : "bg-problem-soft text-fg-problem",
              )}
            >
              {pill.ok ? <Check aria-hidden className="size-3" /> : <TriangleAlert aria-hidden className="size-3" />}
              {pill.text}
            </span>
          )}
          <Button variant="outline" size="top" className="rounded-full" onClick={leave}>
            취소
          </Button>
          <Button size="top" className="rounded-full" disabled={!savable} onClick={() => void commit()}>
            {mode === "new" ? "만들기" : "저장"}
          </Button>
        </span>
      </div>
      <section aria-label="Space 파일" className="flex min-h-0 min-w-0 flex-col">
        <SourceEditor text={text} draft={draft} mode={mode} added={mode === "edit" ? changes.added : []} piece={piece} onText={setText} onCaret={setCaretLine} />
        {draft && (
          <p className="flex shrink-0 items-start gap-2 border-t border-separator-soft px-4 pt-2.5 pb-3 text-xs text-fg-tertiary">
            <SquarePen aria-hidden className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
            <span>{editHint(mode, draft)}</span>
          </p>
        )}
      </section>
      <Preview draft={draft} piece={piece} />
    </div>
  );
}

/** 글자 갈래의 색(시안 `.tk-*`) — 칸 이름은 파랑(`fg-yaml-key` #2c67c5), 경계 · 기호 · 주석은 옅게, 값 · 본문은 글자색이다. */
const TONE: Record<Tone, string> = {
  mark: "text-fg-faint",
  key: "text-fg-yaml-key",
  punct: "text-fg-faint",
  value: "text-fg",
  comment: "text-fg-faint",
  body: "text-fg",
  plain: "",
};

/** 편집기 글자 — 고정폭 13 · 줄 22. 칠한 줄(뒤)과 입력칸(앞)이 같은 글자 · 안쪽 · 줄바꿈이라야 글자가 겹친다(시안 `.hl` · `.srcta`). */
const SOURCE = "font-mono text-code leading-5.5 whitespace-pre-wrap wrap-anywhere [tab-size:2]";

/**
 * 줄 번호가 서는 고정폭 편집기 — 칠한 줄들 위에 투명한 입력칸을 겹친다(시안 `.edw`). 줄 번호는 왼쪽 36 칸, 글은 52에서 선다. 문제 줄은 붉은
 * 면 · 붉은 줄 번호 · 값 밑 물결이고 그 줄 끝에 말이 붙는다. 관계 편집에서 새로 들어온 줄은 줄 머리에 초록 막대가 선다. 판이 글만큼 길어지고
 * 칸이 구른다.
 */
function SourceEditor({
  text,
  draft,
  mode,
  added,
  piece,
  onText,
  onCaret,
}: {
  text: string;
  draft: SpaceDraft | undefined;
  mode: EditMode;
  added: readonly number[];
  piece: Piece | null;
  onText: (text: string) => void;
  onCaret: (line: number) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const placed = useRef(false);
  // 처음 커서(S14) — 첫 검사가 오면 한 번, 그 줄 끝에 둔다.
  useEffect(() => {
    if (!draft || placed.current || !input.current) return;
    placed.current = true;
    const line = firstCaretLine(draft.space.problems, draft.pieces, mode);
    const at = lineEndOffset(text, line);
    input.current.focus({ preventScroll: true });
    input.current.setSelectionRange(at, at);
    onCaret(caretLineOf(text, at));
  }, [draft, mode, text, onCaret]);
  const follow = () => {
    const field = input.current;
    if (field && placed.current) onCaret(caretLineOf(field.value, field.selectionStart));
  };
  const painted = paintLines(text, draft?.space.problems ?? []);

  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto scroll-quiet">
      <div className="relative min-h-full">
        <div aria-hidden className={cn(SOURCE, "pointer-events-none pt-4 pb-3")}>
          {painted.map((line, index) => {
            const number = index + 1;
            const on = piece !== null && draft !== undefined && pieceOfLine(draft.pieces, number) === piece;
            const wrong = line.problem !== null;
            return (
              <div
                key={index}
                data-line={number}
                className={cn(
                  "relative min-h-5.5 pr-4 pl-13",
                  wrong ? "bg-problem-soft" : on ? "bg-piece-soft" : added.includes(number) && "bg-diff-added-line/50",
                  on && "after:absolute after:inset-y-0 after:left-0 after:w-0.5 after:bg-accent-solid",
                )}
              >
                {!wrong && added.includes(number) && (
                  <span className="absolute inset-y-1 left-10.5 w-0.5 rounded-2xs bg-diff-added" />
                )}
                <span className={cn("absolute left-0 w-9 text-right select-none", wrong ? "text-fg-problem" : "text-fg-line-number")}>
                  {number}
                </span>
                {line.tokens.map((token, at) => (
                  <span
                    key={at}
                    className={cn(
                      TONE[token.tone],
                      wrong && token.tone === "value" && token.text.trim() !== "" && "text-fg-problem underline decoration-fg-problem decoration-wavy underline-offset-3",
                    )}
                  >
                    {token.text}
                  </span>
                ))}
                {line.problem && (
                  <span className="absolute top-0 right-4 font-sans text-xs leading-5.5 whitespace-nowrap text-fg-problem">
                    ← {line.problem}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <textarea
          ref={input}
          value={text}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Space 파일"
          onChange={(event) => {
            onText(event.target.value);
            onCaret(caretLineOf(event.target.value, event.target.selectionStart));
          }}
          onSelect={follow}
          onKeyUp={follow}
          onClick={follow}
          className={cn(
            SOURCE,
            "absolute inset-0 size-full resize-none overflow-hidden bg-transparent pt-4 pr-4 pb-3 pl-13 text-transparent caret-fg outline-none",
          )}
        />
      </div>
    </div>
  );
}

/**
 * 미리보기 — 회색 바탕 위 흰 Space 카드 하나(시안 `.exp` · `.pvcard`). 파일의 세 부분을 모두 그린다: 이름(+ Project N · 함께 쓰는 Space N),
 * 관계 그래프(상세와 같은 그림 — 카드 배치), 설명. 고칠 때마다 다시 그린다.
 */
function Preview({ draft, piece }: { draft: SpaceDraft | undefined; piece: Piece | null }) {
  const preview = draft && previewOf(draft);
  return (
    <div className="min-h-0 overflow-y-auto border-l border-separator-soft bg-surface-preview px-7 pt-7 pb-11 scroll-quiet">
      {draft && preview && (
        <>
          <article aria-label="Space 카드" className="mx-auto max-w-150 overflow-hidden rounded-2xl border border-border-preview-card bg-surface shadow-card">
            <CardPiece on={piece === "name"} span={pieceSpan(draft.pieces, "name")}>
              <div className="mb-2 flex items-center gap-1.5 text-xs text-fg-tertiary">
                <Layers aria-hidden className="size-3" />
                Space
              </div>
              <h2 className={cn("text-heading-md", preview.name ? "text-fg" : "text-fg-placeholder")}>{preview.name ?? "이름 없음"}</h2>
              <p className="mt-1 text-xs text-fg-tertiary">{preview.aside}</p>
            </CardPiece>
            <CardPiece on={piece === "projects"} span={pieceSpan(draft.pieces, "projects")} flush>
              <SpaceGraph space={preview.space} shared={preview.shared} layout={CARD_GRAPH} tinted={piece === "projects"} />
            </CardPiece>
            <CardPiece on={piece === "body"} span={pieceSpan(draft.pieces, "body")}>
              <h3 className="mb-2 text-xs font-medium text-fg-tertiary">설명</h3>
              <p className={cn("text-chat-body whitespace-pre-wrap", draft.space.description ? "text-fg" : "text-fg-tertiary")}>
                {draft.space.description || "아직 설명이 없어요 — 마지막 --- 아래에 적으면 Agent가 이 Space에서 일할 때 처음 읽어요"}
              </p>
            </CardPiece>
          </article>
          <p className="mx-auto mt-3 max-w-150 text-center text-xs text-fg-tertiary">
            커서가 있는 줄의 조각이 파랗게 · Agent도 이 내용으로 읽어요
          </p>
        </>
      )}
    </div>
  );
}

/**
 * 카드 조각 하나 — 조각 사이는 옅은 선. 커서 줄의 조각이면 왼쪽 파란 막대 · 옅은 면과 오른쪽 위 「3–6행」 꼬리표가 선다(시안 `.lk.on` ·
 * `.lkt`). 그래프 조각(`flush`)은 안쪽 여백 없이 판이 꽉 차고, 면은 판이 든다(`tinted`).
 */
function CardPiece({ on, span, flush = false, children }: { on: boolean; span: string; flush?: boolean; children: ReactNode }) {
  return (
    <section
      data-piece-on={on || undefined}
      className={cn(
        "relative border-separator-soft not-first:border-t",
        !flush && "px-6 pt-5 pb-5.5",
        on && !flush && "bg-piece-soft",
        on && "before:absolute before:inset-y-0 before:left-0 before:z-10 before:w-0.5 before:bg-accent-solid",
      )}
    >
      {on && span && (
        <span className="absolute top-2.5 right-3 z-10 rounded-sm bg-piece-tag px-1.5 font-mono text-xs text-fg-piece-tag">{span}</span>
      )}
      {children}
    </section>
  );
}
