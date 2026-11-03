import { askThenEnd, endProcesses } from "./actions";
import { useEndMark } from "./endings-store";
import { foldKey, type Folds } from "./folds";
import { sumMetrics } from "./metrics";
import { endAsk, instanceRowLabel, tidyUnknownAsk, type InstanceGroup, type Strays } from "./process-groups";
import {
  exceptionName,
  identitiesOf,
  identityKey,
  processCount,
  processLabel,
  processRowLabel,
  shownNodes,
  subtreeAt,
  withMemory,
  type ProcessNode,
  type ShownNode,
} from "./process-tree";
import { Section, SectionButton, TreeRow, ViewOnly, countNote } from "./tree-rows";
import type { ProcessMetrics } from "./types";

/**
 * **셸 묶음 밑의 묶음** — 손볼 것(확정 고아 · 출처 불명) · 다른 인스턴스 · 예외(프로세스 결정 5 · 6 · 10 · 프로세스 스펙 S54 · 티켓 31).
 * 무엇이 어느 묶음인지는 판정이 정한다 — 여기는 판정의 묶음을 트리로 편 것(`straysOf`)을 세울 뿐이다. 빈 묶음은 안 선다.
 *
 * - **손볼 것**(restart 03-11 · 시안 Processes 「손볼 것」 — 기다림의 잉크): 주인 없이 남은 프로세스다. 갈래마다 묶는 줄이 서고 그 끝에
 *   [정리]가 선다 — 확정 고아는 한 번에 그 갈래의 신원 전부를 끝내기에 넘긴다(기록이 그 셸이 없다고 말한다 — 묻지 않는다). 출처 불명은 확인
 *   창을 한 번 더 띄운다(「출처를 모르는 프로세스 N개를 끝내요」 — 누구의 것인지 모른다). 줄마다 [끝내기]도 선다(시안). 한때 확정 고아 ·
 *   출처 불명이 따로 구획이었다.
 * - **다른 인스턴스**: 지금 떠 있는 다른 아틀리에 실행마다 빌드 종류 · 버전을 머리로 세운다. 보기만 한다 — 그 실행이 제 셸을 닫을 때
 *   끝낸다.
 * - **예외**: 우리 트리 안(셸의 자손이나 표식을 문 것)에서 예외 이름에 걸린 것과 그 트리 — 앱 밖의 tmux나 launchd의 `ssh-agent`는
 *   판정 밖이라 안 선다. 보기만 한다 — 무엇으로도 안 끝나는 것이 이 묶음의 뜻이다.
 *
 * 고아 행에는 행 메뉴(「예외로 두기」)가 선다. 다른 인스턴스와 예외 행에는 동작이 하나도 없다. 구획 머리에 그 묶음의 합이 선다.
 *
 * **구획과 부모 줄이 접힌다**(ui-refresh 결정 28) — 손볼 것은 펼쳐 열고, 다른 인스턴스 · 예외는 접어 연다. [정리]가 넘기는 신원은 접힘과
 * 상관없이 그 갈래 전부다. 접힘은 화면이 든다(`folds`).
 */
function StraySections({ strays, folds }: { strays: Strays; folds: Folds }) {
  const { confirmed, unknown, instances, exceptions } = strays;
  const orphans = [...confirmed, ...unknown];

  return (
    <>
      {orphans.length > 0 && (
        <Section warn title="손볼 것" note={countNote(orphans.length)} sum={totalsOf(orphans)} fold={folds.section("strays")}>
          <div role="tree" aria-label="손볼 것" className="flex flex-col">
            {confirmed.length > 0 && (
              <StrayKind
                kind="confirmed"
                name="확정 고아"
                note="닫은 셸에서 남음"
                nodes={confirmed}
                folds={folds}
                // 묻지 않는다(프로세스 결정 6) — 누른 순간 화면에 보인 신원 전부다.
                action={<SectionButton onClick={() => void endProcesses(identitiesOf(confirmed))}>정리</SectionButton>}
              />
            )}
            {unknown.length > 0 && (
              <StrayKind
                kind="unknown"
                name="출처 불명"
                note="어느 셸에서 떴는지 몰라요"
                nodes={unknown}
                folds={folds}
                action={
                  <SectionButton onClick={() => void askThenEnd(tidyUnknownAsk(unknown.length), identitiesOf(unknown))}>
                    정리
                  </SectionButton>
                }
              />
            )}
          </div>
        </Section>
      )}
      {instances.length > 0 && (
        <Section
          title="다른 인스턴스"
          note={countNote(instances.reduce((sum, group) => sum + group.nodes.length, 0))}
          sum={sumMetrics(instances.map((group) => group.totals))}
          action={<ViewOnly />}
          fold={folds.section("instances")}
        >
          <div role="tree" aria-label="다른 인스턴스" className="flex flex-col">
            {instances.map((group) => (
              <InstanceRows key={group.generation ?? ""} group={group} folds={folds} />
            ))}
          </div>
        </Section>
      )}
      {exceptions.length > 0 && (
        <Section
          title="예외"
          note={countNote(exceptions.length)}
          sum={totalsOf(exceptions)}
          action={<ViewOnly />}
          fold={folds.section("exceptions")}
        >
          <div role="tree" aria-label="예외" className="flex flex-col">
            {shownNodes(exceptions, folds.closed).map((shown) => (
              <StrayRow key={keyOf(shown)} shown={shown} level={shown.depth} folds={folds} />
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

/** 줄들의 합 — 구획 머리 · 묶는 줄의 숫자. */
function totalsOf(nodes: ReadonlyArray<ProcessNode>): ProcessMetrics {
  return sumMetrics(nodes.map(({ row }) => row.metrics));
}

/**
 * 손볼 것의 갈래 하나 — 묶는 줄(이름 · 무엇인지 · 그 갈래의 합 · [정리])과 그 밑의 트리. 묶는 줄은 늘 밑에 줄이 있어 접힌다(키는 갈래). 줄마다
 * [끝내기]가 선다 — 넘기는 것은 그 줄과 그 밑이다(셸의 자손 줄과 같다).
 */
function StrayKind({
  kind,
  name,
  note,
  nodes,
  folds,
  action,
}: {
  kind: "confirmed" | "unknown";
  name: string;
  note: string;
  nodes: ProcessNode[];
  folds: Folds;
  action: React.ReactNode;
}) {
  const fold = folds.row(foldKey.strays(kind), name);
  const totals = totalsOf(nodes);
  return (
    <>
      <TreeRow
        level={1}
        label={withMemory([name, processCount(nodes.length)], totals.memory)}
        kind="shell"
        metrics={totals}
        ports={false}
        fold={fold}
        actions={action}
        data-strays={kind}
      >
        <span className="shrink-0 font-medium">{name}</span>
        <span className="min-w-0 truncate text-fg-tertiary">{note}</span>
      </TreeRow>
      {fold.open &&
        shownNodes(nodes, folds.closed).map((shown) => (
          <StrayRow key={keyOf(shown)} shown={shown} level={1 + shown.depth} folds={folds} menu ends={subtreeAt(nodes, shown.at)} />
        ))}
    </>
  );
}

const keyOf = ({ row }: ProcessNode) => identityKey(row.id);

/**
 * 묶음의 프로세스 한 줄 — 셸의 자손 행과 같은 모양이다: 부른 이름(명령줄은 이름 글자의 툴팁 — 줄 안의 ⋯가 앱 툴팁을 들어 줄에 걸면
 * 둘이 겹친다), 숫자 칸, 접근성 이름 「이름, 메모리」. `menu`면 행 메뉴(「예외로 두기」)가 선다. `ends`면 [끝내기]가 서고 그 신원을 넘긴다
 * (restart 03-11). 밑에 줄이 있으면 접힌다(키는 신원). [정리] · [끝내기]로 끝낸 줄에는 「끝내는 중」과 결과가 선다(`end` — restart 03-10).
 */
function StrayRow({
  shown: { row, parent },
  level,
  folds,
  menu = false,
  ends,
}: {
  shown: ShownNode;
  level: number;
  folds: Folds;
  menu?: boolean;
  ends?: ReturnType<typeof subtreeAt>;
}) {
  const end = useEndMark(row.id)?.state;
  return (
    <TreeRow
      level={level}
      label={processRowLabel(row)}
      kind="process"
      metrics={row.metrics}
      fold={parent ? folds.row(foldKey.process(row.id), processLabel(row)) : undefined}
      menu={menu ? exceptionName(row) : undefined}
      end={end}
      ending={ends ? { ask: endAsk(processLabel(row), ends.length), targets: ends } : undefined}
    >
      <span title={row.command ?? undefined} className="min-w-0 truncate">
        {processLabel(row)}
      </span>
    </TreeRow>
  );
}

/**
 * 다른 인스턴스의 실행 하나 — 머리 줄(빌드 종류 · 버전, 그 실행의 합)과 그 밑의 트리. 머리 줄은 셸 줄의 규격이고 포트 칸이 없다(work
 * 행과 같다). 동작은 없다. 머리 줄은 늘 밑에 줄이 있어 접힌다(키는 실행의 세대).
 */
function InstanceRows({ group, folds }: { group: InstanceGroup; folds: Folds }) {
  const fold = folds.row(foldKey.run(group.generation), group.label);
  return (
    <>
      <TreeRow level={1} label={instanceRowLabel(group)} kind="shell" metrics={group.totals} ports={false} fold={fold}>
        <span className="min-w-0 truncate font-medium">{group.label}</span>
      </TreeRow>
      {fold.open &&
        shownNodes(group.nodes, folds.closed).map((shown) => (
          <StrayRow key={keyOf(shown)} shown={shown} level={1 + shown.depth} folds={folds} />
        ))}
    </>
  );
}

export default StraySections;
