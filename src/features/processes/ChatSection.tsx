import { MessageSquare } from "lucide-react";
import { askThenEnd } from "./actions";
import { chatProcessLabel, chatRowLabel, endableIn, isRuntimeNode, type ChatGroup } from "./chat-tree";
import { foldKey, type Folds } from "./folds";
import { endAsk } from "./process-groups";
import { exceptionName, identityKey, processLabel, shownNodes, subtreeAt } from "./process-tree";
import { RowButton, Section, TreeRow } from "./tree-rows";

/**
 * **「채팅」 구획**(restart 03-7 · 스펙 「03 — Processes」 Runtime · 스토리 126 · 127 · 시안 Processes · ProcessSheet) — 화면의 맨 위다. 채팅마다
 * 머리 줄(채팅 이름 · Runtime 이름과 그 채팅의 합)이 서고, 그 밑에 Runtime과 Runtime이 띄운 것(MCP · dev 서버)이 트리로 선다. 무엇이 어느
 * 채팅에 드는지는 판정이 정한다 — 여기는 그 묶음을 편 것(`chatGroups`)을 세울 뿐이다. 행이 선 채팅이 없으면 안 선다.
 *
 * **엔진의 몫에는 [끝내기]가 없다**(`endableIn`) — Runtime과 그 프로세스 그룹(MCP · Codex의 app-server)은 엔진이 채팅을 닫거나 앱을 끌 때
 * 그룹째 끝낸다. Runtime이 띄운 dev 서버(제 그룹)와 부모가 먼저 죽어 Runtime 키로 묶인 dev 서버에는 [끝내기]와 행 메뉴(「예외로 두기」)가
 * 선다 — 셸의 자손 줄과 같은 길이다. Runtime 줄에는 꼬리표 「Runtime」이 선다.
 *
 * 구획은 펼쳐 열고(`OPEN_AT_FIRST`), 채팅 줄은 늘 밑에 줄이 있어 접힌다(키는 채팅 id).
 */
function ChatSection({ groups, share, folds }: { groups: ReadonlyArray<ChatGroup>; share: ReadonlySet<string>; folds: Folds }) {
  if (groups.length === 0) return null;
  return (
    <Section icon={MessageSquare} title="채팅" note={`채팅 ${groups.length}개`} fold={folds.section("chats")}>
      <div role="tree" aria-label="채팅" className="flex flex-col">
        {groups.map((group) => (
          <ChatRows key={group.thread} group={group} share={share} folds={folds} />
        ))}
      </div>
    </Section>
  );
}

/**
 * 채팅 하나의 줄들 — 머리 줄과 그 밑의 트리. 머리 줄은 셸 줄의 규격이고 포트 칸이 없다(다른 인스턴스의 실행 줄과 같다). 머리 줄의 글리프는
 * 사이드바 채팅 줄의 것이다. 프로세스 줄의 명령줄 전체는 이름 글자의 툴팁이다(셸의 자손 줄과 같은 까닭).
 */
function ChatRows({ group, share, folds }: { group: ChatGroup; share: ReadonlySet<string>; folds: Folds }) {
  const fold = folds.row(foldKey.chat(group.thread), group.name);
  return (
    <>
      <TreeRow
        level={1}
        label={chatRowLabel(group)}
        kind="shell"
        metrics={group.totals}
        ports={false}
        fold={fold}
        data-chat={group.thread}
      >
        <MessageSquare aria-hidden className="size-3.5 shrink-0 text-fg-tertiary" />
        <span className="min-w-0 truncate">{group.name}</span>
        {group.runtime !== null && <span className="shrink-0 text-xs text-fg-tertiary">{group.runtime}</span>}
      </TreeRow>
      {fold.open &&
        shownNodes(group.nodes, folds.closed).map((node) => {
          const { row, depth, at, parent } = node;
          const endable = endableIn(share, row);
          return (
            <TreeRow
              key={identityKey(row.id)}
              level={1 + depth}
              label={chatProcessLabel(share, node)}
              kind="process"
              metrics={row.metrics}
              fold={parent ? folds.row(foldKey.process(row.id), processLabel(row)) : undefined}
              menu={endable ? exceptionName(row) : undefined}
              actions={
                endable && (
                  // 넘기는 신원은 누른 순간 화면에 보인 표본의 그 줄과 그 밑이다(셸의 자손 줄과 같다).
                  <RowButton
                    onClick={() => {
                      const targets = subtreeAt(group.nodes, at);
                      void askThenEnd(endAsk(processLabel(row), targets.length), targets);
                    }}
                  >
                    끝내기
                  </RowButton>
                )
              }
            >
              <span title={row.command ?? undefined} className="min-w-0 truncate">
                {processLabel(row)}
              </span>
              {isRuntimeNode(share, node) && <RuntimeTag />}
            </TreeRow>
          );
        })}
    </>
  );
}

/**
 * 꼬리표 「Runtime」 — 시안의 `ra-tag`(20 · 알약 · 12 · `fill-soft` 위 `fg-secondary`)다. 안쪽 7은 눈금의 8로 적는다. 귀로는 줄의 접근성
 * 이름이 같은 말을 한다(`chatProcessLabel`).
 */
function RuntimeTag() {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-fill-soft px-2 text-xs text-fg-secondary">
      Runtime
    </span>
  );
}

export default ChatSection;
