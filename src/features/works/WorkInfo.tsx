import { ArrowRight, ChevronRight, Copy, Folder, GitBranch, PanelTop } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ProjectView } from "@/features/projects/types";
import { specDirRef, worktreeDirRef, workDirRef } from "./refs";
import type { WorkView } from "./types";

// 프로젝트 하나의 base 판정. **두 경우가 구분되는 값으로 내려와야 한다** —
// `base: string | null` 하나로는 "목록이 아직 안 왔다"와 "등록이 사라졌다"가 같은 값이 되어
// 화면이 둘을 다르게 말할 수 없다.
export interface ProjectBase {
  // 등록된 프로젝트에서 읽은 base 브랜치. 목록이 아직 안 왔으면 null이고 unregistered도 false다.
  base: string | null;
  // 목록은 왔는데 이 프로젝트의 등록이 없다. 프로젝트를 지워도 그것을 쓰는 작업은 남는다.
  unregistered: boolean;
}

interface WorkInfoProps {
  work: WorkView;
  // 프로젝트 slug → base 판정. **조회는 WorkPanel이 한다** — 이 컴포넌트가 스스로 조회하면
  // 쿼리 프로바이더 없이 그릴 수 없어져 정적 마크업 테스트가 닫힌다.
  //
  // 아래가 도는 `work.worktrees`의 모든 항목에 대해 키가 있다고 본다. 그것을 만드는 쪽과
  // 여기가 같은 배열을 쓰므로 빠질 수 없다.
  bases: Record<string, ProjectBase>;
  // 맨 위 브랜치 줄의 꼬리에 적을 base. 한 줄로 말할 수 없으면 null이다(아래 sharedBase — 그것도 WorkPanel이 부른다).
  branchBase: string | null;
  // 완성된 참조 문자열을 클립보드로 (+토스트). 참조 조립은 refs.ts가 한다.
  onCopy: (text: string) => void;
  onOpenProject: (slug: string) => void;
}

/**
 * 작업 폴더를 기준으로 접은 표기. **공통 접두어를 한 번만 쓰기 위한 것이다** —
 * 세 경로(작업 폴더 · 워크트리 · spec)가 같은 앞부분을 공유해서, 좁은 패널에서 관습대로
 * 꼬리를 자르면 세 줄의 보이는 글자가 전부 같아지고 그 줄을 구분해 주는 유일한 부분만
 * 잘려 나간다. 값 열이 라벨이 이미 말한 것 외에 아무것도 더 말하지 않는 장식이 된다.
 *
 * 돌려주는 것은 언제나 입력의 **꼬리**다 — 복사되는 것은 전체 경로 그대로이고 표기만 줄인다.
 * 접두어가 맞지 않으면(데이터 루트를 옮긴 설치) 전체를 그대로 보인다.
 */
export function relativeToWorkDir(path: string, workDir: string): string {
  return path.startsWith(workDir) ? path.slice(workDir.length) : path;
}

/**
 * 프로젝트들이 **한 base를 공유할 때만** 그 이름을 돌려준다.
 *
 * 맨 위 브랜치 줄의 꼬리는 한 칸뿐인데 base는 프로젝트마다 다를 수 있다. 아무 값이나 하나
 * 골라 적으면 그 줄이 거짓을 말한다 — 프로젝트별 base를 제대로 보여주는 자리는 아래 「프로젝트」
 * 구획이고, 꼬리는 "한 줄로 말할 수 있을 때만 말한다".
 *
 * 목록이 아직 안 왔을 때와 등록이 사라진 프로젝트가 섞였을 때도 null이다. 셋을 같은
 * 값으로 묶어도 되는 것은 결과가 같기 때문이다 — 꼬리를 그리지 않는다.
 */
export function sharedBase(projects: ProjectView[] | undefined, slugs: string[]): string | null {
  if (!projects || slugs.length === 0) return null;
  const bases = slugs.map((slug) => projects.find((p) => p.slug === slug)?.baseBranch);
  const [first] = bases;
  if (first === undefined) return null;
  return bases.every((b) => b === first) ? first : null;
}

// info 몸 — 헤더와 패널로 갈려 있던 이 작업의 사실을 한 자리에서 말한다. 작업 정보는 레일의 info 한 곳에
// 모인다(ui-refresh 결정 14) — 바탕 줄의 ⓘ 팝오버에 살던 복사 줄 셋이 맨 위 묶음으로 올라왔다.
//
// **순수 표현 컴포넌트다.** 데이터를 스스로 조회하지 않고 전부 prop으로 받는다.
// 상태 배지는 바탕 줄에만 둔다 — 여기에 읽기 전용으로 한 번 더 쓰지 않는다.
function WorkInfo({ work, bases, branchBase, onCopy, onOpenProject }: WorkInfoProps) {
  const workDir = workDirRef(work.slug);
  const specDir = specDirRef(work.slug);
  // 뒷문장은 브랜치가 미정일 때만 참이다. 코어는 프로젝트 없이도 브랜치를 확정해 저장하므로
  // (works.rs의 nothing_to_decide가 세 조건을 **모두** 요구한다) "프로젝트 0개 + 브랜치
  // 있음"이 실재하고, 그 화면에서 뒷문장은 거짓이 된다.
  const noProjects =
    work.branch === null
      ? "아직 프로젝트가 없어요. 프로젝트를 붙이면 브랜치가 정해져요."
      : "아직 프로젝트가 없어요.";

  return (
    // 세로 스크롤은 여기까지 — 머리는 패널 카드에 고정되어 항상 보인다 (spec 몸과 같은 경계)
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-0.5 pt-1 scroll-quiet">
      {/* **맨 위는 「한 클릭에 복사하고 싶은 것」이다**(ui-refresh 결정 14) — 에이전트에게 작업을 넘길 때 가장 자주 집는
          값 셋이다. 테두리 없는 옅은 면 묶음이다(ui-refresh 결정 16). 아래 구획(작업 · 프로젝트)에도 작업 폴더 · 워크트리 복사가 있어
          값이 겹친다 — 그쪽은 전체 메타를 읽는 자리이고, 이쪽은 한 번에 집는 자리다(프로토타입 Works-info도 둘 다 그린다). */}
      <div className="flex flex-col rounded-card bg-group p-1">
        <WorkMetaRows work={work} base={branchBase} onCopy={onCopy} />
      </div>
      {/* 아래 구획은 셋 다 「이름 | 값」 두 칸 표다(프로토타입 Works-info — DS `.at-subhead` · `.at-props.narrow`). */}
      <Section title="작업" first>
        {/* 제목과 달리 절대 바뀌지 않는 이름이다. 작업 폴더 경로에 들어 있긴 하지만
            따로 읽을 수 있어야 하고, **읽는 것만으로는 절반이다** — 제목이 바뀌어도 같은
            작업을 가리키려면 그 이름이 클립보드로 나가야 한다 (스토리 10). 경로가 아니므로
            접을 것이 없어 보이는 값과 나가는 값이 같다. */}
        <Row label="slug" value={work.slug} copy={{ text: work.slug, help: "slug 복사", onCopy }} />
        {/* 코어가 내려준 `%Y-%m-%d` 그대로다. 저장소의 formatCreated는 "8월 16일"을 내며
            **연도를 버려서**, 이 탭의 쓰임 하나인 "오래된 작업을 정리할지 판단한다"에
            답하지 못한다. 어휘 통일보다 사실 보존이 앞서는 자리다. */}
        <Row label="생성일" value={work.createdAt} />
        {/* 브랜치는 첫 프로젝트가 붙을 때 정해진다 — 그전에는 보여줄 이름이 없다.
            프로젝트 유무와는 **독립이다** (위 noProjects 주석). */}
        {work.branch !== null && <Row label="브랜치" value={work.branch} />}
        {/* 아래 상대 경로들의 **기준**이라 맨 위에 온다 — 기준이 먼저 나와야 읽힌다 */}
        <PathRow label="작업 폴더" path={workDir} onCopy={onCopy} />
      </Section>

      <Section title="프로젝트">
        {work.projects.length === 0 ? (
          <p className="px-1.5 py-1 text-caption leading-normal text-tertiary">{noProjects}</p>
        ) : (
          // **워크트리 목록만 돈다.** 코어의 뷰 변환이 워크트리를 프로젝트에서 1:1로 만들어
          // 개수도 순서도 같고 각 항목이 이름·경로·존재·변경을 모두 들고 있다. 두 배열을
          // 맞춰보는 코드는 절대 실행되지 않는 분기가 된다.
          work.worktrees.map((worktree) => {
            const { base, unregistered } = bases[worktree.project];
            const dir = worktreeDirRef(worktree.path);
            return (
              // 프로젝트 하나가 줄 덩어리 하나다 — 프로젝트 이름이 첫 줄의 이름 칸에 서서, 아래 줄들이 어느 프로젝트 것인지가
              // 위치로 이어진다. 덩어리 사이는 줄 사이(4)보다 한 단 넓다.
              <div key={worktree.project} className="flex flex-col gap-1 not-first:mt-2">
                <div className="flex min-h-7 items-center text-ui">
                  {/* 이름 칸이 버튼이다 — 값 칸(base · 알 수 없다)은 버튼 밖이라 접근성 이름에 묻히지 않고 읽힌다. */}
                  <Hint
                    text="프로젝트 상세로 이동"
                    type="button"
                    onClick={() => onOpenProject(worktree.project)}
                    aria-label={`${worktree.project} 프로젝트 상세로 이동`}
                    className={cn(
                      PROJECT_LABEL,
                      "group flex h-7 items-center gap-0.5 rounded-lg px-1.5 text-left text-muted-foreground transition-colors hover:bg-state-1 hover:text-foreground",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{worktree.project}</span>
                    <ChevronRight
                      className="size-3 shrink-0 text-tertiary opacity-0 transition-opacity group-hover:opacity-100"
                      strokeWidth={2}
                    />
                  </Hint>
                  {/* base는 **프로젝트마다 다를 수 있다.** 한 줄로 합치면(feat/… → develop, main)
                      어느 base가 어느 프로젝트 것인지 그 줄에서 사라진다.
                      못 찾는 두 경우는 다른 말을 한다 — 그러라고 값이 둘로 갈려 온다. */}
                  {unregistered ? (
                    <span className="min-w-0 flex-1 py-1.5 text-caption text-tertiary">
                      알 수 없다 — 프로젝트가 등록돼 있지 않다
                    </span>
                  ) : (
                    base !== null && (
                      <span className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-mono-sm">
                        <ArrowRight className="size-3 shrink-0 text-tertiary" strokeWidth={2} />
                        <span className="min-w-0 truncate">{base}</span>
                      </span>
                    )
                  )}
                </div>
                <PathRow label="worktree" path={dir} relativeTo={workDir} onCopy={onCopy} />
                {/* 아카이빙과 삭제는 커밋 안 된 변경이 있으면 거부되는데, 지금 화면
                    어디에도 그 사실이 없어 거부 대화상자를 보고서야 알게 된다.
                    「없음」은 worktree 줄의 값에 딸린 사실이라 이름 칸을 비우고 그 아래 선다 — 「변경」 칸에 두면
                    「변경 없음」으로 읽힌다. */}
                {!worktree.exists ? (
                  <Note>없음</Note>
                ) : worktree.dirty ? (
                  <Row label="변경" value="변경 있음" prose />
                ) : null}
              </div>
            );
          })
        )}
      </Section>

      <Section title="문서">
        {/* 세 경로 중 spec만 복사 행이 없었다 */}
        <PathRow label="spec" path={specDir} relativeTo={workDir} onCopy={onCopy} />
        {/* 개수는 「문서」 줄 하나다 — 판 안 문서를 포함한 spec 파일 전부. 판을 세지 않는다(spec 레이아웃
            결정 24): 폴더가 곧 개념이라 `02-editor/`가 스스로 판을 말하고, 화면이 판이라는 세는
            말을 따로 갖지 않는다. `(전체)` 꼬리도 뗐다 — spec 탭의 `Documents` 구획(판 밖 문서만)과
            가르려고 붙였던 것이라, 구획이 사라지면서 가를 상대가 없다. */}
        <Row label="문서" value={String(work.specFiles.length)} />
      </Section>
    </div>
  );
}

/**
 * 맨 위 묶음의 줄들 — 브랜치(공유 base 꼬리) · 작업 폴더 · 워크트리마다 한 줄. 행을 누르면(Enter 포함) 그 값이
 * 클립보드로 가고 토스트가 선다(`onCopy` — 패널의 다른 복사와 같은 길).
 */
function WorkMetaRows({
  work,
  base,
  onCopy,
}: {
  work: WorkView;
  // 브랜치 줄의 꼬리에 적을 base. 한 줄로 말할 수 없으면 null이다 (위 sharedBase).
  base: string | null;
  onCopy: (text: string) => void;
}) {
  return (
    <>
      {/* 브랜치는 첫 프로젝트가 붙을 때 정해진다 — 그전에는 보여줄 이름이 없다.
          빈 줄로 남기면 누를 수는 있는데 아무것도 복사되지 않는 줄이 된다. */}
      {work.branch !== null && (
        <MetaRow
          glyph={<GitBranch className="size-[13px] shrink-0 text-tertiary" strokeWidth={1.7} />}
          value={work.branch}
          tail={base ? <span className="shrink-0 text-meta text-tertiary">{base}</span> : undefined}
          onCopy={onCopy}
        />
      )}
      <MetaRow
        glyph={<Folder className="size-[13px] shrink-0 text-tertiary" strokeWidth={1.7} />}
        value={workDirRef(work.slug)}
        onCopy={onCopy}
      />
      {/* **작업 폴더 기준으로 접는다.** 두 경로는 `~/.atelier/works/<slug>/`를 통째로
          공유해서, 좁은 패널에서 꼬리를 자르면 두 줄의 보이는 글자가 완전히 같아진다 —
          그 줄을 구분해 주는 유일한 부분만 잘려 나간다. 기준 행이 바로 위에 있으니
          여기를 그것에 상대로 적을 수 있다 (아래 PathRow와 같은 계약). */}
      {work.worktrees.map((worktree) => (
        <MetaRow
          key={worktree.project}
          glyph={<PanelTop className="size-[13px] shrink-0 text-tertiary" strokeWidth={1.7} />}
          value={worktreeDirRef(worktree.path)}
          relativeTo={workDirRef(work.slug)}
          onCopy={onCopy}
        />
      ))}
    </>
  );
}

// 묶음의 줄 하나 — 행 전체가 복사 버튼이다. 끝의 복사 글리프는 늘 보인다(프로토타입 Works-info) — 아래 구획의 행처럼
// hover에만 뜨면 키로 온 사람에게 「누르면 복사된다」가 안 보인다(스토리 66).
//
// **전체 값을 받아 꼬리를 여기서 만든다** (PathRow와 같은 계약). 접힌 값을
// 받고 전체 값을 따로 받는 모양이었는데, 그러면 둘이 갈릴 수 있는 자리가 호출부마다
// 생긴다 — 한 줄을 빠뜨려도 타입은 통과하고, 화면은 멀쩡한데 클립보드로 나가는 것만
// 조용히 잘린다. 여기서 접으면 **나가는 값은 언제나 받은 값 그대로**라 갈릴 수가 없다.
// 나가는 값은 L3 `works-floating`의 복사 줄 검사가 클립보드 손잡이로 잰다 — 브랜치 줄(Enter)과 접힌 워크트리 줄(클릭)이다.
function MetaRow({
  glyph,
  value,
  relativeTo,
  tail,
  onCopy,
}: {
  glyph: React.ReactNode;
  // 클립보드로 나가는 값. 화면에는 relativeTo만큼 접혀 보인다.
  value: string;
  // 접어서 보일 기준. **기준 행 자신은 받지 않는다** — 자기에 대해 접으면 빈 문자열이 된다.
  relativeTo?: string;
  // 없으면 복사 글리프가 온다. base처럼 늘 보여야 하는 꼬리가 있는 줄만 넘긴다.
  tail?: React.ReactNode;
  onCopy: (text: string) => void;
}) {
  const shown = relativeTo ? relativeToWorkDir(value, relativeTo) : value;
  // 도움말 「복사」는 툴팁이다. 행의 이름은 값이라, 「누르면 복사한다」는 이름보다 더 말하는 것 — 설명으로도
  // 남긴다(S28 — 툴팁은 스크린리더에 아무것도 주지 않는다).
  //
  // 모양은 DS의 묶음 행(`.at-group-row.sm`)이다 — 32px · 좌우 12 · 사이 10 · 10px 모서리, 옅은 면 위라 hover는 한 단 짙은 state-2다.
  return (
    <Hint
      text="복사"
      announce="description"
      type="button"
      onClick={() => onCopy(value)}
      className="flex h-8 items-center gap-2.5 rounded-lg px-3 text-left text-ui transition-colors hover:bg-state-2"
    >
      {glyph}
      <span className="min-w-0 flex-1 truncate font-mono text-mono-sm">{shown}</span>
      {tail ?? <Copy className="size-3 shrink-0 text-tertiary" strokeWidth={1.8} />}
    </Hint>
  );
}

// 이름 칸 — DS `.at-props.narrow`의 76px 열이다. 줄의 왼쪽 안쪽(6) 뒤에 서서 값 칸이 82에서 선다. 버튼인 이름 칸(프로젝트)은
// 그 안쪽을 제가 들어 폭이 82다(아래 `PROJECT_LABEL`) — 어느 줄이든 값 칸이 같은 세로선에 선다.
const LABEL = "w-[76px] shrink-0";
const PROJECT_LABEL = "w-[82px] shrink-0";

// 구획 하나 — 제목은 DS `.at-subhead`(13px · 600 · 본문 색)이고 위 28 · 아래 10이 구획 사이의 리듬이다(Projects 상세의 소제목과
// 같은 값). 맨 위 묶음 바로 아래의 첫 구획만 위가 24다(프로토타입 22를 4px 격자에 — ui-refresh 결정 12). 줄 사이는 4다.
// 제목과 이름 칸의 글자는 카드 왼쪽에서 14에 선다(몸의 안쪽 8 + 줄의 안쪽 6) — 프로토타입 Works-info의 그 자리다.
function Section({ title, first = false, children }: { title: string; first?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className={cn("mb-2.5 px-1.5 text-ui font-semibold", first ? "mt-6" : "mt-7")}>{title}</span>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

// 「이름 | 값」 한 줄(DS `.at-props.narrow` — 이름 13px `muted-foreground`, 값 12px 고정폭 본문 색, 줄 28).
// **값은 원값 그대로다** — 정보 탭은 slug와 경로를 사람 말로 다듬지 않고 읽는 자리다. 한 항목만 다듬으면 구획 안에서 등록이 갈린다.
// 값이 원값이 아니라 사실을 적는 말이면(「변경 있음」) `prose`로 고정폭을 뗀다(프로토타입의 그 줄도 그렇다).
function Row({
  label,
  value,
  prose = false,
  copy,
}: {
  label: string;
  value: string;
  prose?: boolean;
  // 주면 행 전체가 복사 버튼이 되고 hover 시 복사 아이콘이 뜬다 (spec 트리의 경로 복사와 같다).
  //
  // **셋이 한 덩어리로 오간다.** 나가는 값과 그것을 말하는 툴팁과 실제 동작이 따로 다니면
  // "복사되는 값이 화면 표기와 갈린다"는 사고가 조용히 생긴다 — 접어서 보이는 경로가 있는
  // 화면이라 실재하는 위험이다. 그래서 `text`는 **보이는 값이 아니라 나가는 값**이다.
  //
  // `help`는 도움말이다 — 툴팁의 글자이고, 행의 이름(라벨과 값)보다 더 말하는 「누르면 복사한다」라 설명
  // (`aria-description`)으로도 남는다(S28 — 툴팁은 스크린리더에 아무것도 주지 않는다).
  copy?: { text: string; help: string; onCopy: (text: string) => void };
}) {
  const body = (
    <>
      <span className={cn(LABEL, "truncate pr-2 text-muted-foreground")}>{label}</span>
      <span className={cn("min-w-0 flex-1 truncate", prose ? "text-caption" : "font-mono text-mono-sm")}>{value}</span>
    </>
  );
  if (!copy) {
    return <div className="flex h-7 items-center px-1.5 text-ui">{body}</div>;
  }
  return (
    <Hint
      text={copy.help}
      announce="description"
      type="button"
      onClick={() => copy.onCopy(copy.text)}
      className="group flex h-7 items-center rounded-lg px-1.5 text-left text-ui transition-colors hover:bg-state-1"
    >
      {body}
      <Copy
        className="ml-1.5 size-3 shrink-0 text-tertiary opacity-0 transition-opacity group-hover:opacity-100"
        strokeWidth={1.8}
      />
    </Hint>
  );
}

// 경로 한 줄.
//
// **전체 경로를 받아 꼬리를 여기서 만든다.** 보이는 값과 나가는 값이 갈릴 수 있는 자리를
// 호출부 셋에서 이 한 곳으로 줄이려는 것이다 — 화면을 믿고 붙여 넣은 경로가 다른 곳을
// 가리키는 사고는 조용하다.
function PathRow({
  label,
  path,
  relativeTo,
  onCopy,
}: {
  label: string;
  path: string;
  // 접어서 보일 기준. **기준 행 자신은 받지 않는다** — 자기에 대해 접으면 빈 문자열이 되고,
  // 아래 상대 경로들이 무엇에 상대인지 말해 줄 유일한 줄이 사라진다.
  relativeTo?: string;
  onCopy: (text: string) => void;
}) {
  const value = relativeTo ? relativeToWorkDir(path, relativeTo) : path;
  // 보이는 것은 접힌 꼬리, 나가는 것은 전체 경로다 (Row의 copy 주석).
  return <Row label={label} value={value} copy={{ text: path, help: "경로 복사", onCopy }} />;
}

// 값이 아니라 사실 하나를 적는 줄 — 배지를 달지 않는다. 바로 위 줄의 값에 딸린 말이라 이름 칸을 비우고 값 칸에 선다.
function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-7 items-center px-1.5">
      <span aria-hidden className={LABEL} />
      <span className="min-w-0 flex-1 text-caption text-tertiary">{children}</span>
    </div>
  );
}

export default WorkInfo;
