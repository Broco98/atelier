import { askThenEnd, endProcesses } from "./actions";
import { instanceGroups, instanceRowLabel, tidyUnknownAsk, type InstanceGroup } from "./process-groups";
import {
  exceptionName,
  identitiesOf,
  identityKey,
  processCount,
  processLabel,
  processRowLabel,
  processTree,
  strayTree,
  type ProcessNode,
} from "./process-tree";
import { Actions, Figures, RowButton, RowMenu, Section, TreeRow } from "./tree-rows";
import type { ProcessSnapshot } from "./types";

/**
 * **셸 묶음 밑의 네 묶음** — 확정 고아 · 출처 불명 · 다른 인스턴스 · 예외(프로세스 결정 5 · 6 · 10 · 프로세스 스펙 S54 · 티켓 31).
 * 무엇이 어느 묶음인지는 판정이 정한다 — 여기는 판정의 묶음을 트리로 펴 세울 뿐이다(`process-tree.ts` · `process-groups.ts`). 빈 묶음은
 * 안 선다.
 *
 * - **확정 고아**: [정리] 한 번이면 그 묶음의 신원 전부가 끝내기에 넘어간다 — 기록이 그 셸이 없다고 말한다.
 * - **출처 불명**: [정리]가 확인 창을 한 번 더 띄운다(「출처를 모르는 프로세스 N개를 끝내요」) — 누구의 것인지 모른다.
 * - **다른 인스턴스**: 지금 떠 있는 다른 아틀리에 실행마다 빌드 종류 · 버전을 머리로 세운다. 보기만 한다 — 그 실행이 제 셸을 닫을 때
 *   끝낸다.
 * - **예외**: 우리 트리 안(셸의 자손이나 표식을 문 것)에서 예외 이름에 걸린 것과 그 트리 — 앱 밖의 tmux나 launchd의 `ssh-agent`는
 *   판정 밖이라 안 선다. 보기만 한다 — 무엇으로도 안 끝나는 것이 이 묶음의 뜻이다.
 *
 * 고아 행에는 행 메뉴(「예외로 두기」)가 선다. 다른 인스턴스와 예외 행에는 동작이 하나도 없다. 행마다 숫자 칸은 셸 묶음과 같은
 * 칸이다(`Figures` — 28의 표기 함수).
 */
function StraySections({ snapshot }: { snapshot: ProcessSnapshot }) {
  const confirmed = strayTree(snapshot.verdict.orphans.confirmed);
  const unknown = strayTree(snapshot.verdict.orphans.unknown);
  const instances = instanceGroups(snapshot);
  const exceptions = processTree(snapshot.verdict.exceptions);

  return (
    <>
      {confirmed.length > 0 && (
        <Section
          title="확정 고아"
          note={processCount(confirmed.length)}
          // 묻지 않는다(결정 6) — 누른 순간 화면에 보인 신원 전부다.
          action={<RowButton onClick={() => void endProcesses(identitiesOf(confirmed))}>정리</RowButton>}
        >
          <div role="tree" aria-label="확정 고아" className="flex flex-col gap-0.5">
            {confirmed.map((node) => (
              <StrayRow key={keyOf(node)} node={node} level={node.depth} menu />
            ))}
          </div>
        </Section>
      )}
      {unknown.length > 0 && (
        <Section
          title="출처 불명"
          note={processCount(unknown.length)}
          action={
            <RowButton onClick={() => void askThenEnd(tidyUnknownAsk(unknown.length), identitiesOf(unknown))}>정리</RowButton>
          }
        >
          <div role="tree" aria-label="출처 불명" className="flex flex-col gap-0.5">
            {unknown.map((node) => (
              <StrayRow key={keyOf(node)} node={node} level={node.depth} menu />
            ))}
          </div>
        </Section>
      )}
      {instances.length > 0 && (
        <Section
          title="다른 인스턴스"
          note={processCount(instances.reduce((sum, group) => sum + group.nodes.length, 0))}
          action={<ViewOnly />}
        >
          <div role="tree" aria-label="다른 인스턴스" className="flex flex-col gap-0.5">
            {instances.map((group) => (
              <InstanceRows key={group.generation ?? ""} group={group} />
            ))}
          </div>
        </Section>
      )}
      {exceptions.length > 0 && (
        <Section title="예외" note={processCount(exceptions.length)} action={<ViewOnly />}>
          <div role="tree" aria-label="예외" className="flex flex-col gap-0.5">
            {exceptions.map((node) => (
              <StrayRow key={keyOf(node)} node={node} level={node.depth} />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

const keyOf = ({ row }: ProcessNode) => identityKey(row.id);

/** 결정 10 그림의 「보기 전용」 — 동작 자리에 선다. 버튼이 아니다. */
function ViewOnly() {
  return <span className="shrink-0 px-2 text-[12px] text-tertiary">보기 전용</span>;
}

/**
 * 묶음의 프로세스 한 줄 — 셸의 자손 행과 같은 모양이다: 부른 이름(명령줄은 툴팁), 숫자 칸, 접근성 이름 「이름, 메모리」. `menu`면 행
 * 메뉴(「예외로 두기」)가 선다.
 */
function StrayRow({ node, level, menu = false }: { node: ProcessNode; level: number; menu?: boolean }) {
  const { row } = node;
  return (
    <TreeRow
      level={level}
      label={processRowLabel(row)}
      title={row.command ?? undefined}
      className="text-[12.5px] text-muted-foreground"
    >
      <span className="min-w-0 flex-1 truncate">{processLabel(row)}</span>
      <Figures metrics={row.metrics} />
      <Actions>{menu && <RowMenu name={exceptionName(row)} />}</Actions>
    </TreeRow>
  );
}

/**
 * 다른 인스턴스의 실행 하나 — 머리 줄(빌드 종류 · 버전, 그 실행의 합)과 그 밑의 트리. 머리 줄은 포트 칸이 없다(work 행과 같다). 동작은
 * 없다.
 */
function InstanceRows({ group }: { group: InstanceGroup }) {
  return (
    <>
      <TreeRow level={1} label={instanceRowLabel(group)}>
        <span className="min-w-0 truncate text-[13px] font-medium">{group.label}</span>
        <span className="flex-1" />
        <Figures metrics={group.totals} ports={false} />
        <Actions />
      </TreeRow>
      {group.nodes.map((node) => (
        <StrayRow key={keyOf(node)} node={node} level={1 + node.depth} />
      ))}
    </>
  );
}

export default StraySections;
