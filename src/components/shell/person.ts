import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";

// 사람 메뉴의 사람(v1 구현 스펙 S27 · 티켓 07) — 사이드바 맨 아래 줄에 서는 이름과 얼굴 글자. 이름은 앱이 이 컴퓨터 계정에서 읽는다
// (`person_name` — 계정의 전체 이름, 없으면 로그인 이름). 앱이 이름을 묻거나 적어 두지 않는다.

/** 이름을 모를 때(읽기 전 · 거절 · 계정에 이름이 없음) 서는 말. */
export const PERSON_FALLBACK = "나";

/** 그 사람의 이름 — 앱이 뜬 동안 한 번 읽는다. 모르면 「나」다. */
export function usePersonName(): string {
  const { data } = useQuery({
    queryKey: ["person-name"],
    queryFn: () => invoke<string | null>("person_name"),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  return data ?? PERSON_FALLBACK;
}

/** 세 음절 한글 이름 — 성 하나 + 이름 둘의 흔한 꼴이다. */
const KOREAN_NAME = /^[가-힣]{3}$/;

/**
 * 얼굴에 서는 글자 하나(캔버스 보드 「사람은 글자」). 세 음절 한글 이름은 성을 뺀 이름의 첫 글자다 — 보드가 「김효연」을 「효」로 그렸고,
 * 한국에서 사람을 부르는 쪽이 이름이다. 그 밖은 첫 글자를 대문자로 쓴다.
 */
export function initialOf(name: string): string {
  const letters = [...name.trim()];
  if (KOREAN_NAME.test(letters.join(""))) return letters[1];
  return (letters[0] ?? PERSON_FALLBACK).toUpperCase();
}
