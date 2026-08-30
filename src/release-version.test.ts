/// <reference types="node" />
// node: 접두사를 쓰지 않는 이유는 이웃한 tauri-commands.test.ts의 주석과 같다.
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

// 릴리스가 정하는 버전은 하나인데, 그 하나를 적는 자리가 여섯이다 — 크레이트 넷과
// package.json, tauri.conf.json. 그리고 그중 셋을 갱신하는 목록이 scripts/bump-version.sh
// 안에 **손으로** 적혀 있었다. 판 1이 네 번째 크레이트(atelier-test-bridge)를 들여오자
// 그 목록이 그대로 낡았고, v0.7.0을 자른 뒤에도 그 크레이트만 0.6.1로 남았다.
//
// 스크립트를 읽어 "목록이 맞나"를 보는 검사는 쓰지 않는다. 스크립트가 모양을 바꾸면
// (변수로 뺀다든지) 스캔이 아무것도 못 찾고 **조용히 통과한다** — 이 저장소가 이미
// 한 번 데인 fail-open이다. 대신 결과 상태를 본다: 버전이 갈라지면 빨간불이다.
// 스크립트가 어떻게 생겼든 상관없고, 손으로 고치다 하나를 빠뜨려도 걸린다.
//
// 예외를 두지 않는다. `publish = false`인 크레이트(다리)는 릴리스에 실려 나가지 않으니
// 빼도 된다는 안이 있었지만, 예외를 두면 **그 판별을 스크립트와 검사가 각자** 하게 되고
// 둘이 갈라지는 순간 다시 조용해진다. "워크스페이스는 한 버전으로 움직인다"는 예외가
// 없어서 틀리게 읽힐 자리도 없다. 다리에 붙는 버전은 뜻이 없지만 해롭지도 않다.
const root = fileURLToPath(new URL("..", import.meta.url));

/** 루트 Cargo.toml이 선언한 워크스페이스 멤버들의 매니페스트 경로. */
function memberManifests(): string[] {
  const source = readFileSync(join(root, "Cargo.toml"), "utf8");
  const block = source.match(/^members\s*=\s*\[([\s\S]*?)\]/m);
  // 모양이 바뀌어 못 읽으면 **터진다.** 빈 목록으로 넘어가면 검사가 아무것도 안 보면서
  // 초록이 된다 — 크레이트가 늘어난 바로 그때 눈이 감기는 셈이다.
  if (!block) throw new Error("루트 Cargo.toml에서 members 목록을 찾지 못했다");
  const members = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (members.length === 0) throw new Error("members 목록이 비어 있다");
  return members.map((member) => join(root, member, "Cargo.toml"));
}

/** 매니페스트의 [package] 절만 잘라 낸다 — 의존성의 version과 섞이지 않게. */
function packageSection(manifest: string): string {
  const source = readFileSync(manifest, "utf8");
  const header = source.match(/^\[package\]$/m);
  if (!header) throw new Error(`${manifest}: [package] 절을 찾지 못했다`);
  const rest = source.slice(header.index! + header[0].length);
  const next = rest.match(/^\[/m);
  return next ? rest.slice(0, next.index) : rest;
}

function crateVersion(manifest: string): string {
  const version = packageSection(manifest).match(/^version\s*=\s*"([^"]+)"/m);
  if (!version) throw new Error(`${manifest}: [package]에서 version을 찾지 못했다`);
  return version[1];
}

function jsonVersion(path: string): string {
  const parsed: unknown = JSON.parse(readFileSync(join(root, path), "utf8"));
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== "string") throw new Error(`${path}: version이 문자열이 아니다`);
  return version;
}

function everyVersion(): Record<string, string> {
  const versions: Record<string, string> = {};
  for (const manifest of memberManifests()) {
    versions[manifest.slice(root.length)] = crateVersion(manifest);
  }
  for (const path of ["package.json", "src-tauri/tauri.conf.json"]) {
    versions[path] = jsonVersion(path);
  }
  return versions;
}

describe("릴리스 버전", () => {
  it("워크스페이스 크레이트와 앱 껍데기가 모두 같은 버전을 쓴다", () => {
    const versions = everyVersion();
    const distinct = [...new Set(Object.values(versions))];
    expect(distinct, `버전이 갈라졌다:\n${JSON.stringify(versions, null, 2)}`).toHaveLength(1);
  });

  // 위 검사는 "전부 같다"만 본다. 전부 같은 쓰레기 값이어도 통과하므로 모양도 함께 못 박는다
  // — bump-version.sh가 major.minor.patch만 받고 태그를 `v<버전>`으로 만든다.
  it("그 버전은 major.minor.patch 모양이다", () => {
    const [version] = [...new Set(Object.values(everyVersion()))];
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
