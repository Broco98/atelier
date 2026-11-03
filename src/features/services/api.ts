import { invoke } from "@tauri-apps/api/core";
import type { ReadingScope, ScopeOf } from "./scope";
import type { DeletedService, RestoredService, Service, ServiceDetail, ServiceDraft, ServiceUsage } from "./types";

export const servicesApi = {
  list: () => invoke<Service[]>("list_services"),
  /** Service 파일들의 폴더(홈은 `~` — restart 03-3). ⋯ 「경로 복사」가 그 아래 `<slug>.md`를 짓는다(`serviceFile`). */
  folder: () => invoke<string>("services_folder"),
  get: (slug: string) => invoke<ServiceDetail>("get_service", { slug }),
  // 고치기 화면(03 구현 스펙 §13 — 파일로 고치기). core는 `slug` 없는 새 Service도 받지만 그 화면(「직접 만들기」)은 걷혔다(restart 03-15c).
  readText: (slug: string) => invoke<string>("read_service_text", { slug }),
  check: (slug: string, text: string) => invoke<ServiceDraft>("check_service", { slug, text }),
  saveText: (slug: string, text: string) => invoke<Service>("save_service_text", { slug, text }),
  /** 읽는 범위(§7) — Thread가 있으면 그 Thread의 것, 없으면 보내기 전의 새 Thread(입력창이 쥔 Work · Service)의 것이다. */
  scope: ({ thread, work, service, project }: ScopeOf) =>
    invoke<ReadingScope>("reading_scope", { thread: thread ?? null, work: work ?? null, service: service ?? null, project: project ?? null }),
  // 지우기(03 티켓 07) — 확인 창의 쓰임(core만), 지우기 · 되돌리기(엔진 — 비운 곳마다 「지워짐」 · 「되돌림」 줄을 남긴다).
  usage: (slug: string) => invoke<ServiceUsage>("service_usage", { slug }),
  remove: (slug: string) => invoke<DeletedService>("thread_delete_service", { slug }),
  restore: (slug: string) => invoke<RestoredService>("thread_restore_service", { slug }),
};
