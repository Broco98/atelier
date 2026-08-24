import { ArrowRight, ChevronRight, Copy } from "lucide-react";
import { specDirRef, worktreeDirRef, workDirRef } from "./refs";
import { splitSpecFiles } from "./spec-sections";
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

// 정보 탭 본문 — 헤더와 패널로 갈려 있던 이 작업의 사실을 한 자리에서 말한다.
//
// **순수 표현 컴포넌트다.** 데이터를 스스로 조회하지 않고 전부 prop으로 받는다.
// 상태 배지는 헤더에만 둔다 — 여기에 읽기 전용으로 한 번 더 쓰지 않는다.
function WorkInfo({ work, bases, onCopy, onOpenProject }: WorkInfoProps) {
  const workDir = workDirRef(work.slug);
  const specDir = specDirRef(work.slug);
  // 판은 폴더, 문서는 파일이라 **단위가 달라 더할 수 없고**, 문서 개수는 판 안 문서를
  // 포함한다. spec 탭의 `Documents` 구획(판 **밖** 문서만)과 다른 집합이라, 한 클릭
  // 거리에서 같은 이름이 다른 집합을 가리키지 않도록 `(전체)`를 붙인다.
  const iterations = splitSpecFiles(work.specFiles).iterations.length;
  // 뒷문장은 브랜치가 미정일 때만 참이다. 코어는 프로젝트 없이도 브랜치를 확정해 저장하므로
  // (works.rs의 nothing_to_decide가 세 조건을 **모두** 요구한다) "프로젝트 0개 + 브랜치
  // 있음"이 실재하고, 그 화면에서 뒷문장은 거짓이 된다.
  const noProjects =
    work.branch === null
      ? "아직 프로젝트가 없어요. 프로젝트를 붙이면 브랜치가 정해져요."
      : "아직 프로젝트가 없어요.";

  return (
    // 세로 스크롤은 여기까지 — 탭 바는 패널 카드에 고정되어 항상 보인다 (spec 탭과 같은 경계)
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-0.5 pt-1 scroll-quiet">
      <Section title="작업">
        {/* 제목과 달리 절대 바뀌지 않는 이름이다. 작업 폴더 경로에 들어 있긴 하지만
            따로 읽을 수 있어야 하고, **읽는 것만으로는 절반이다** — 제목이 바뀌어도 같은
            작업을 가리키려면 그 이름이 클립보드로 나가야 한다 (스토리 10). 경로가 아니므로
            접을 것이 없어 보이는 값과 나가는 값이 같다. */}
        <Row label="slug" value={work.slug} copy={{ text: work.slug, title: "slug 복사", onCopy }} />
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
          <p className="px-2 py-1 text-[12px] leading-normal text-tertiary">{noProjects}</p>
        ) : (
          // **워크트리 목록만 돈다.** 코어의 뷰 변환이 워크트리를 프로젝트에서 1:1로 만들어
          // 개수도 순서도 같고 각 항목이 이름·경로·존재·변경을 모두 들고 있다. 두 배열을
          // 맞춰보는 코드는 절대 실행되지 않는 분기가 된다.
          work.worktrees.map((worktree) => {
            const { base, unregistered } = bases[worktree.project];
            const dir = worktreeDirRef(worktree.path);
            return (
              <div key={worktree.project} className="flex flex-col pb-1">
                <button
                  type="button"
                  onClick={() => onOpenProject(worktree.project)}
                  aria-label={`${worktree.project} 프로젝트 상세로 이동`}
                  title="프로젝트 상세로 이동"
                  className="group flex h-7 items-center gap-1.5 rounded-[8px] px-2 text-left text-[12.5px] font-medium transition-colors hover:bg-state-1"
                >
                  <span className="min-w-0 flex-1 truncate">{worktree.project}</span>
                  <ChevronRight
                    className="size-3 shrink-0 text-tertiary opacity-0 transition-opacity group-hover:opacity-100"
                    strokeWidth={2}
                  />
                </button>
                {/* 덩어리 안은 한 칸 들어간다 — 어느 값이 어느 프로젝트 것인지가 위치로 이어진다 */}
                <div className="flex flex-col pl-2.5">
                  {/* base는 **프로젝트마다 다를 수 있다.** 한 줄로 합치면(feat/… → develop, main)
                      어느 base가 어느 프로젝트 것인지 그 줄에서 사라진다.
                      못 찾는 두 경우는 다른 말을 한다 — 그러라고 값이 둘로 갈려 온다. */}
                  {unregistered ? (
                    <Note>알 수 없다 — 프로젝트가 등록돼 있지 않다</Note>
                  ) : (
                    base !== null && (
                      <span className="flex h-6 items-center gap-1 px-2 font-mono text-[12px] text-tertiary">
                        <ArrowRight className="size-2.5 shrink-0" strokeWidth={2} />
                        <span className="min-w-0 truncate">{base}</span>
                      </span>
                    )
                  )}
                  <PathRow label="worktree" path={dir} relativeTo={workDir} onCopy={onCopy} />
                  {/* 아카이빙과 삭제는 커밋 안 된 변경이 있으면 거부되는데, 지금 화면
                      어디에도 그 사실이 없어 거부 대화상자를 보고서야 알게 된다. */}
                  {!worktree.exists ? (
                    <Note>없음</Note>
                  ) : worktree.dirty ? (
                    <Note>변경 있음</Note>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </Section>

      <Section title="문서">
        {/* 세 경로 중 spec만 복사 행이 없었다 */}
        <PathRow label="spec" path={specDir} relativeTo={workDir} onCopy={onCopy} />
        <Note>
          판 {iterations} · 문서 {work.specFiles.length}(전체)
        </Note>
      </Section>
    </div>
  );
}

// 구획 하나. 탭 바가 이미 `info`라 구획 이름은 그보다 한 단 작고 옅다.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col pb-2">
      <span className="px-2 pb-0.5 pt-1.5 text-[12px] font-semibold text-tertiary">{title}</span>
      {children}
    </div>
  );
}

// 라벨–값 한 줄. **값은 원값 그대로다** — 정보 탭은 slug와 경로를 사람 말로 다듬지 않고
// 읽는 자리다. 한 항목만 다듬으면 구획 안에서 등록이 갈린다.
function Row({
  label,
  value,
  copy,
}: {
  label: string;
  value: string;
  // 주면 행 전체가 복사 버튼이 되고 hover 시 복사 아이콘이 뜬다 (spec 트리의 경로 복사와 같다).
  //
  // **셋이 한 덩어리로 오간다.** 나가는 값과 그것을 말하는 툴팁과 실제 동작이 따로 다니면
  // "복사되는 값이 화면 표기와 갈린다"는 사고가 조용히 생긴다 — 접어서 보이는 경로가 있는
  // 화면이라 실재하는 위험이다. 그래서 `text`는 **보이는 값이 아니라 나가는 값**이다.
  copy?: { text: string; title: string; onCopy: (text: string) => void };
}) {
  const body = (
    <>
      <span className="w-[58px] shrink-0 text-tertiary">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{value}</span>
    </>
  );
  if (!copy) {
    return <div className="flex h-7 items-center gap-1.5 px-2 text-[12.5px]">{body}</div>;
  }
  return (
    <button
      type="button"
      title={copy.title}
      onClick={() => copy.onCopy(copy.text)}
      className="group flex h-7 items-center gap-1.5 rounded-[8px] px-2 text-left text-[12.5px] transition-colors hover:bg-state-1"
    >
      {body}
      <Copy
        className="size-3 shrink-0 text-tertiary opacity-0 transition-opacity group-hover:opacity-100"
        strokeWidth={1.8}
      />
    </button>
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
  return <Row label={label} value={value} copy={{ text: path, title: "경로 복사", onCopy }} />;
}

// 값이 아니라 사실 하나를 적는 줄 — 배지를 달지 않는다.
function Note({ children }: { children: React.ReactNode }) {
  return <span className="px-2 py-0.5 text-[12px] text-tertiary">{children}</span>;
}

export default WorkInfo;
