import type { OtherAppRow } from "./breakdown";
import { endableIn, isRuntimeNode, type ChatGroup } from "./chat-tree";
import type { Strays } from "./process-groups";
import { processLabel, subtreeAt, type ProcessNode } from "./process-tree";
import { HELPER_LABEL, type ShellProcesses } from "./shell-tree";
import { webviewParts } from "./summary-card";
import type { BodyRows, ProcessIdentity, ProcessMetrics, ProcessRow } from "./types";

// **`Processes`의 세 보기**(restart 03-11 · 스토리 137 · 시안 Processes 「묶음 · CPU 순 · 메모리 순」). 묶음은 구획과 트리이고, CPU 순 ·
// 메모리 순은 묶음을 풀어 숫자로 선 것을 한 줄씩 숫자 차례로 세운다 — 「지금 무엇이 내 컴퓨터를 먹나」를 한 줄로 답한다. 순수 함수다. 표
// 위에 포인터가 있는 동안 차례가 멈추는 것은 화면이 든다(`useHeldOrder`).

/** 보기 — 묶음(구획과 트리), CPU 순, 메모리 순. */
export type ProcessView = "tree" | "cpu" | "memory";

/** 보기 단추의 이름 — 시안 Processes의 보기 도구 그대로다. */
export const VIEW_NAMES: Readonly<Record<ProcessView, string>> = { tree: "묶음", cpu: "CPU 순", memory: "메모리 순" };

/** 숫자 차례 보기의 한 줄. */
export interface FlatRow {
  /** 줄의 열쇠 — 멈춘 차례와 React가 이것으로 줄을 찾는다. */
  key: string;
  name: string;
  /** 어디서 온 줄인지 — 채팅 이름 · 셸 이름 · 묶음 이름(시안 `.pr-row .d`). */
  note: string;
  metrics: ProcessMetrics;
  /** 아틀리에 밖(다른 앱) — 막대가 옅은 잉크다(시안 `data-out`). */
  outside: boolean;
  /** 판정의 행이면 그 행 — 명령줄 툴팁 · 끝내기 표시 · 행 메뉴가 읽는다. 셸 자신 · 앱 본체 · 다른 앱은 없다. */
  row: ProcessRow | null;
  /** [끝내기]가 넘길 신원 — 그 줄과 그 밑(묶음 보기와 같은 트리). 끝내지 않는 줄은 `null`이다. */
  ends: ProcessIdentity[] | null;
  /** 꼬리표 「Runtime」이 서는 줄(엔진의 몫의 맨 위). */
  runtime: boolean;
}

/** 숫자 차례 보기의 재료 — 화면이 묶음 보기를 세우려고 이미 편 것들이다. */
export interface FlatInput {
  chats: ReadonlyArray<ChatGroup>;
  /** 엔진의 몫(`engineShareOf`). */
  share: ReadonlySet<string>;
  /** 화면에 선 셸(작업공간 셸 · 주인 잃은 셸 · 화면 밖 셸)과 그 이름. */
  shells: ReadonlyArray<{ name: string; node: ShellProcesses }>;
  body: BodyRows;
  strays: Strays;
  /** 다른 앱의 줄 — 화면에 선 그대로(앞의 셋과 「그 밖의 앱」 · 「그 밖의 프로세스」). */
  apps: ReadonlyArray<OtherAppRow>;
}

/** 판정의 행 하나의 줄 — 트리(`nodes`)의 `at`번째. 끝낼 수 있으면 그 줄과 그 밑을 넘긴다. */
function processRow(nodes: ReadonlyArray<ProcessNode>, at: number, note: string, endable: boolean): FlatRow {
  const { row } = nodes[at];
  return {
    key: `p:${row.id.pid}@${row.id.startedUs}`,
    name: processLabel(row),
    note,
    metrics: row.metrics,
    outside: false,
    row,
    ends: endable ? subtreeAt(nodes, at) : null,
    runtime: false,
  };
}

/**
 * **묶음 보기에 숫자로 선 것을 한 줄씩** — 채팅의 프로세스, 셸 자신 · 셸 도우미 · 자손, 앱 본체 · 웹뷰, 고아 · 예외 · 다른 인스턴스, 다른 앱.
 * 묶음 보기의 아틀리에 줄과 다른 앱 줄을 모두 지나므로 줄을 더하면 그 둘의 합이다(시스템 · 못 읽음과 합계는 표의 끝 줄이 그대로 든다).
 * [끝내기]는 묶음 보기와 같은 줄에만 선다 — 셸의 자손, 엔진의 몫이 아닌 채팅 줄, 고아. 차례는 아직 묶음의 차례다(`sortRows`가 세운다).
 */
export function flatRows({ chats, share, shells, body, strays, apps }: FlatInput): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const group of chats) {
    group.nodes.forEach((node, at) => {
      rows.push({
        ...processRow(group.nodes, at, group.name, endableIn(share, node.row)),
        runtime: isRuntimeNode(share, node),
      });
    });
  }
  for (const { name, node } of shells) {
    rows.push({
      key: `s:${node.pool.ptyId}/${node.pool.shellKey}`,
      name,
      note: "셸",
      metrics: node.pool.metrics,
      outside: false,
      row: null,
      ends: null,
      runtime: false,
    });
    const helpers = node.helpers.map((row): ProcessNode => ({ row, depth: 1 }));
    helpers.forEach((_, at) => rows.push(processRow(helpers, at, `${name} · ${HELPER_LABEL}`, false)));
    node.descendants.forEach((_, at) => rows.push(processRow(node.descendants, at, name, true)));
  }
  rows.push(
    { key: "b:rust", name: "앱 본체", note: "Rust", metrics: body.rust, outside: false, row: null, ends: null, runtime: false },
    {
      key: "b:webview",
      name: "웹뷰",
      note: webviewParts(body.webkit),
      metrics: body.webview,
      outside: false,
      row: null,
      ends: null,
      runtime: false,
    },
  );
  strays.confirmed.forEach((_, at) => rows.push(processRow(strays.confirmed, at, "확정 고아", true)));
  strays.unknown.forEach((_, at) => rows.push(processRow(strays.unknown, at, "출처 불명", true)));
  for (const group of strays.instances) {
    group.nodes.forEach((_, at) => rows.push(processRow(group.nodes, at, `다른 인스턴스 · ${group.label}`, false)));
  }
  strays.exceptions.forEach((_, at) => rows.push(processRow(strays.exceptions, at, "예외", false)));
  for (const app of apps) {
    rows.push({ key: `a:${app.key}`, name: app.name, note: app.note, metrics: app.metrics, outside: true, row: null, ends: null, runtime: false });
  }
  return rows;
}

/**
 * **숫자 차례** — CPU 순은 CPU가, 메모리 순은 메모리가 큰 줄이 위다. 못 잰 값(「—」)은 아래이고, 같으면 다른 숫자가 큰 것이 위, 그다음 이름
 * 순이다. 박자마다 숫자가 바뀌어 차례도 바뀐다 — 포인터가 표 위에 있는 동안은 화면이 멈춘다(`useHeldOrder`).
 */
export function sortRows(rows: ReadonlyArray<FlatRow>, by: "cpu" | "memory"): FlatRow[] {
  const cpu = (row: FlatRow) => row.metrics.cpu ?? -1;
  const memory = (row: FlatRow) => row.metrics.memory ?? -1;
  const [first, second] = by === "cpu" ? [cpu, memory] : [memory, cpu];
  return [...rows].sort((a, b) => first(b) - first(a) || second(b) - second(a) || a.name.localeCompare(b.name));
}
