import { AppWindow, CircleAlert, CircleQuestionMark, ShieldCheck } from "lucide-react";
import { askThenEnd, endProcesses } from "./actions";
import { foldKey, type Folds } from "./folds";
import { instanceRowLabel, tidyUnknownAsk, type InstanceGroup, type Strays } from "./process-groups";
import {
  exceptionName,
  identitiesOf,
  identityKey,
  processCount,
  processLabel,
  processRowLabel,
  shownNodes,
  type ProcessNode,
  type ShownNode,
} from "./process-tree";
import { Section, SectionButton, TreeRow } from "./tree-rows";

/**
 * **셸 묶음 밑의 네 묶음** — 확정 고아 · 출처 불명 · 다른 인스턴스 · 예외(프로세스 결정 5 · 6 · 10 · 프로세스 스펙 S54 · 티켓 31).
 * 무엇이 어느 묶음인지는 판정이 정한다 — 여기는 판정의 묶음을 트리로 편 것(`straysOf`)을 세울 뿐이다. 빈 묶음은 안 선다.
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
 *
 * **구획과 부모 줄이 접힌다**(ui-refresh 결정 28) — 확정 고아는 펼쳐 열고, 출처 불명 · 다른 인스턴스 · 예외는 접어 연다. 머리의 수와
 * [정리]는 접혀 있어도 선다. [정리]가 넘기는 신원은 접힘과 상관없이 그 묶음 전부다. 접힘은 화면이 든다(`folds`).
 */
function StraySections({ strays, folds }: { strays: Strays; folds: Folds }) {
  const { confirmed, unknown, instances, exceptions } = strays;

  return (
    <>
      {confirmed.length > 0 && (
        <Section
          icon={CircleAlert}
          warn
          title="확정 고아"
          note={processCount(confirmed.length)}
          // 묻지 않는다(프로세스 결정 6) — 누른 순간 화면에 보인 신원 전부다.
          action={<SectionButton onClick={() => void endProcesses(identitiesOf(confirmed))}>정리</SectionButton>}
          fold={folds.section("confirmed")}
        >
          <div role="tree" aria-label="확정 고아" className="flex flex-col">
            {shownNodes(confirmed, folds.closed).map((shown) => (
              <StrayRow key={keyOf(shown)} shown={shown} level={shown.depth} folds={folds} menu />
            ))}
          </div>
        </Section>
      )}
      {unknown.length > 0 && (
        <Section
          icon={CircleQuestionMark}
          title="출처 불명"
          note={processCount(unknown.length)}
          action={
            <SectionButton onClick={() => void askThenEnd(tidyUnknownAsk(unknown.length), identitiesOf(unknown))}>
              정리
            </SectionButton>
          }
          fold={folds.section("unknown")}
        >
          <div role="tree" aria-label="출처 불명" className="flex flex-col">
            {shownNodes(unknown, folds.closed).map((shown) => (
              <StrayRow key={keyOf(shown)} shown={shown} level={shown.depth} folds={folds} menu />
            ))}
          </div>
        </Section>
      )}
      {instances.length > 0 && (
        <Section
          icon={AppWindow}
          title="다른 인스턴스"
          note={processCount(instances.reduce((sum, group) => sum + group.nodes.length, 0))}
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
          icon={ShieldCheck}
          title="예외"
          note={processCount(exceptions.length)}
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

const keyOf = ({ row }: ProcessNode) => identityKey(row.id);

/** 프로세스 결정 10 그림의 「보기 전용」 — 구획 머리의 동작 자리에 선다. 버튼이 아니다. */
function ViewOnly() {
  return <span className="shrink-0 px-2 text-xs text-fg-tertiary">보기 전용</span>;
}

/**
 * 묶음의 프로세스 한 줄 — 셸의 자손 행과 같은 모양이다: 부른 이름(명령줄은 이름 글자의 툴팁 — 줄 안의 ⋯가 앱 툴팁을 들어 줄에 걸면
 * 둘이 겹친다), 숫자 칸, 접근성 이름 「이름, 메모리」. `menu`면 행 메뉴(「예외로 두기」)가 선다. 밑에 줄이 있으면 접힌다(키는 신원).
 */
function StrayRow({
  shown: { row, parent },
  level,
  folds,
  menu = false,
}: {
  shown: ShownNode;
  level: number;
  folds: Folds;
  menu?: boolean;
}) {
  return (
    <TreeRow
      level={level}
      label={processRowLabel(row)}
      kind="process"
      metrics={row.metrics}
      fold={parent ? folds.row(foldKey.process(row.id), processLabel(row)) : undefined}
      menu={menu ? exceptionName(row) : undefined}
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
