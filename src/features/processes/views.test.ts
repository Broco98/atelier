import { describe, expect, it } from "vitest";
import { foldApps, otherAppRows } from "./breakdown";
import { chatGroups, engineShareOf } from "./chat-tree";
import { breakdownOf, metricsOf as 지표, otherAppOf, pidNamedRow as 행, poolShell, snapshotFixture } from "./process-fixture";
import { straysOf } from "./process-groups";
import { processTree } from "./process-tree";
import { flatRows, sortRows, type FlatInput } from "./views";

// restart 03-11 — **CPU 순 · 메모리 순 보기**(스토리 137 · 시안 Processes · ProcessSheet 「보기와 움직임」). 묶음을 풀고 프로세스 하나하나를
// 숫자로 줄 세운다. 재는 것은 무엇이 줄로 서는가(줄을 더하면 묶음 보기와 같은 합이다), 차례, 그리고 어느 줄을 끝낼 수 있는가다.

const MiB = 1024 * 1024;

/** 채팅 하나(Runtime · MCP는 엔진의 몫, 그 밑의 dev 서버), 셸 하나(도우미 · 자손 둘), 확정 고아 · 예외 · 다른 인스턴스 하나씩, 앱 본체, 다른 앱. */
function 장면(): FlatInput {
  const claude = 행(401, 400, 4_010, { name: "claude", metrics: 지표(600 * MiB, 3.1) });
  const mcp = 행(402, 401, 4_020, { name: "node", metrics: 지표(88 * MiB, 0.2) });
  const vitest = 행(403, 401, 4_030, { name: "vitest", metrics: 지표(400 * MiB, 2.3, [51204]) });
  const helper = 행(501, 500, 5_010, { name: "gitstatusd", metrics: 지표(8 * MiB, 0.0) });
  const vite = 행(502, 500, 5_020, { name: "vite", metrics: 지표(340 * MiB, 1.1, [1420]) });
  const esbuild = 행(503, 502, 5_030, { name: "esbuild", metrics: 지표(30 * MiB, 0.4) });
  const next = 행(601, 1, 6_010, { name: "next", metrics: 지표(510 * MiB, 1.0, [3000]) });
  const tmux = 행(701, 1, 7_010, { name: "tmux", metrics: 지표(12 * MiB, 0.1) });
  const other = 행(801, 1, 8_010, { name: "cargo", metrics: 지표(90 * MiB, 0.6) });
  const snapshot = snapshotFixture({
    verdict: {
      chats: { T1: [claude, mcp, vitest] },
      runtimes: [claude.id, mcp.id],
      descendants: { "G-1": [helper, vite, esbuild] },
      helpers: [helper.id],
      orphans: { confirmed: { "F-1": [next] }, unknown: {} },
      exceptions: [tmux],
      otherInstances: { "H-1": [other] },
    },
    pool: [poolShell(1, "G-1", 0, 지표(5 * MiB, 0.0))],
    instances: [{ generation: "H", build: "dev", version: "0.20.0", keys: ["H-1"] }],
    body: { rust: 지표(180 * MiB, 0.7), webview: 지표(640 * MiB, 1.3), webkit: ["GPU"] },
    breakdown: breakdownOf({ apps: [otherAppOf("Sketchpad", 41, 2048 * MiB, 9.1), otherAppOf(null, 200, 1024 * MiB, 4.0)] }),
  });
  const share = engineShareOf(snapshot);
  return {
    chats: chatGroups(snapshot, [], () => null).map((group) => ({ ...group, name: "실패 신호 구현" })),
    share,
    shells: [
      {
        name: "zsh",
        node: { pool: snapshot.pool[0], helpers: [helper], descendants: processTree([vite, esbuild]) },
      },
    ],
    body: snapshot.body,
    strays: straysOf(snapshot),
    apps: foldApps(otherAppRows(snapshot), 3),
  };
}

describe("CPU 순 · 메모리 순의 줄", () => {
  // **묶음 보기에 숫자로 선 것이 모두 한 줄씩 선다** — 채팅의 프로세스, 셸 자신 · 도우미 · 자손, 앱 본체 · 웹뷰, 고아 · 예외 · 다른 인스턴스,
  // 다른 앱. 그래서 줄을 더하면 묶음 보기의 아틀리에와 다른 앱의 합이다(시스템 · 못 읽음과 합계는 표의 끝 줄이다). CPU 순은 CPU가 큰 것이
  // 위다.
  it("CPU 순은 묶음의 모든 줄을 CPU가 큰 차례로 세운다", () => {
    const rows = sortRows(flatRows(장면()), "cpu");
    expect(rows.map((row) => [row.name, row.metrics.cpu])).toEqual([
      ["Sketchpad", 9.1],
      ["그 밖의 프로세스", 4.0],
      ["claude", 3.1],
      ["vitest", 2.3],
      ["웹뷰", 1.3],
      ["vite", 1.1],
      ["next", 1.0],
      ["앱 본체", 0.7],
      ["cargo", 0.6],
      ["esbuild", 0.4],
      ["node", 0.2],
      ["tmux", 0.1],
      ["gitstatusd", 0.0],
      ["zsh", 0.0],
    ]);
  });

  it("메모리 순은 메모리가 큰 차례다", () => {
    const rows = sortRows(flatRows(장면()), "memory");
    expect(rows.slice(0, 4).map((row) => row.name)).toEqual(["Sketchpad", "그 밖의 프로세스", "웹뷰", "claude"]);
    expect(rows[rows.length - 1].name).toBe("zsh");
  });

  // 줄만 보고는 어디서 왔는지 모른다 — 설명 글이 그 묶음을 말한다(채팅 이름 · 셸 이름 · 묶음 이름). 다른 앱만 아틀리에 밖이다(막대가 옅다).
  it("설명 글이 그 줄이 어디서 왔는지 말하고, 다른 앱만 아틀리에 밖이다", () => {
    const byName = new Map(flatRows(장면()).map((row) => [row.name, row]));
    expect(byName.get("vitest")?.note).toBe("실패 신호 구현");
    expect(byName.get("esbuild")?.note).toBe("zsh");
    expect(byName.get("gitstatusd")?.note).toBe("zsh · 셸 도우미");
    expect(byName.get("zsh")?.note).toBe("셸");
    expect(byName.get("next")?.note).toBe("확정 고아");
    expect(byName.get("tmux")?.note).toBe("예외");
    expect(byName.get("cargo")?.note).toBe("다른 인스턴스 · dev 빌드 · v0.20.0");
    expect(byName.get("웹뷰")?.note).toBe("WebContent · GPU");
    expect([...byName.values()].filter((row) => row.outside).map((row) => row.name)).toEqual(["Sketchpad", "그 밖의 프로세스"]);
  });

  // **[끝내기]는 묶음 보기와 같은 줄에만 선다** — 셸의 자손, 채팅의 dev 서버, 고아. 넘기는 것은 그 줄과 그 밑이다(누른 순간의 표본).
  // 엔진의 몫(Runtime · MCP), 셸 자신 · 도우미, 앱 본체, 예외 · 다른 인스턴스, 다른 앱에는 없다.
  it("끝낼 수 있는 줄은 묶음 보기와 같고, 그 밑까지 넘긴다", () => {
    const rows = flatRows(장면());
    const endable = rows.filter((row) => row.ends !== null).map((row) => [row.name, row.ends?.map((id) => id.pid)]);
    expect(endable).toEqual([
      ["vitest", [403]],
      ["vite", [502, 503]],
      ["esbuild", [503]],
      ["next", [601]],
    ]);
    expect(rows.find((row) => row.name === "claude")?.runtime).toBe(true);
  });
});
