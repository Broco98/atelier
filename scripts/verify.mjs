// 이 저장소에서 "검증"이 무엇인지는 이 파일에만 정의된다. CI도 자기 목록을 갖는 대신
// 이 명령을 부르게 한다 (#119) — 로컬과 CI가 다른 것을 검사하면 "통과했다"가 두 가지
// 뜻을 갖는다.
//
//   pnpm verify          기본 기어 — 고치고 바로 다시 돌리는 층
//   pnpm verify --full   느린 관통 층까지

import { spawnSync } from "node:child_process";

/** 기본 기어에서 도는 층. */
const FAST = [
  ["L0 타입", "pnpm", ["exec", "tsc", "--noEmit"]],
  // vite.config.ts는 별도 프로젝트(tsconfig.node.json)에 있고, tsc는 -b 없이는
  // project reference를 따라가지 않는다. 어느 테스트가 도는지를 정하는 파일이라
  // 타입 사각지대에 두면 실행되지 않은 테스트가 초록으로 통과한다.
  ["L0 타입 (설정)", "pnpm", ["exec", "tsc", "--noEmit", "-p", "tsconfig.node.json"]],
  // `--workspace`를 명시한다. 누가 나중에 default-members를 넣으면 맨 `cargo test`는
  // 조용히 좁아지고, 데스크톱 앱 크레이트가 어느 CI에서도 컴파일되지 않는다 (D18).
  ["L1 Rust", "cargo", ["test", "--workspace"]],
  ["L2 프론트엔드", "pnpm", ["test"]],
  ["L3 브라우저", "pnpm", ["exec", "playwright", "test"]],
];

/** --full에서만 도는 층. L4 관통 테스트가 여기 붙는다. */
const FULL_ONLY = [];

const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg !== "--full");
if (unknown.length > 0) {
  // 조용히 기본 기어로 도는 것이 최악이다 — `--fulll` 오타 하나로 관통 검증을
  // 건너뛴 채 "통과했다"가 된다.
  console.error(`모르는 인자입니다: ${unknown.join(" ")} — 쓸 수 있는 것은 --full 뿐입니다.`);
  process.exit(2);
}

const full = args.includes("--full");
const layers = full ? [...FAST, ...FULL_ONLY] : FAST;
console.log(`검증 기어: ${full ? "--full" : "기본"} — ${layers.length}개 층`);
if (full && FULL_ONLY.length === 0) {
  console.log("(--full에서만 도는 층은 아직 없습니다. L4가 여기 붙습니다.)");
}

for (const [name, command, commandArgs] of layers) {
  console.log(`\n── ${name}`);
  const startedAt = Date.now();
  const result = spawnSync(command, commandArgs, { stdio: "inherit" });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (result.error) {
    console.error(`\n✗ ${name} — ${command} 실행에 실패했습니다: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\n✗ ${name} 실패 (${elapsed}초)`);
    process.exit(result.status ?? 1);
  }
  console.log(`✓ ${name} (${elapsed}초)`);
}

console.log(`\n검증 통과${full ? " (--full)" : ""}`);
