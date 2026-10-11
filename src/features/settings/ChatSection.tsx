import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AGENT_LABEL } from "@/features/chat/ComposerChips";
import type { EngineLists } from "@/features/chat/types";
import { CHAT_AGENTS, defaultAgentOf, engineChoice, type EngineField } from "./chat-settings";
import { SettingsGroup, SettingsRow, SettingsSection } from "./SettingsGroup";
import type { ChatAgent, ChatSettings } from "./types";

// 설정 「대화」의 묶음(three-axes 결정 16 · 티켓 25) — 행 셋: 기본 에이전트 · 기본 모델 · 시작 모드. 모델 · 모드 행에는 엔진마다
// 고르기가 하나씩 선다. 모양(값 표 · 설명 문구)은 캔버스에 없어 지금 설정 화면의 부품(행 · 칩 · 고르기)을 쓴다.
//
// 값을 들지 않는다 — 조각(`SettingsPage.tsx`의 `ChatSettingsPage`)이 들고 이쪽은 그리기만 한다(`TerminalSection`과 같은 까닭).

/** 고르기의 첫 줄 — 값을 비워 둔 것(키 없음)이다. 이 줄의 값이 `null`이라 고르기도 「고르지 않음」을 그대로 든다. */
const ENGINE_DEFAULT_LABEL = "엔진 기본값";

/** 고르기 한 줄 — 값은 엔진이 낸 id, 글은 엔진이 낸 이름이다. */
interface Choice {
  value: string | null;
  label: string;
}

const FIELD_NAME: Record<EngineField, string> = { model: "기본 모델", mode: "시작 모드" };

/**
 * 그 엔진 · 그 칸의 고르기 줄들. 첫 줄은 엔진 기본값이고 그 뒤가 엔진 목록 파일(S16)의 차례 그대로다 — 목록이 없으면(세션을 연 적
 * 없는 엔진 · 아직 못 받음) 엔진 기본값 하나뿐이다. 파일에 적힌 값이 목록에 없으면(목록 파일이 지워진 뒤 · 엔진이 그 모델을 뺀
 * 뒤) 그 값을 끝에 한 줄로 둔다 — 지금 값이 고르기에서 사라져 보이지 않게.
 */
export function choicesOf(lists: EngineLists | null, field: EngineField, current: string | null): Choice[] {
  const listed: Choice[] =
    field === "model"
      ? (lists?.models ?? []).map((model) => ({ value: model.value, label: model.name }))
      : (lists?.modes ?? []).map((mode) => ({ value: mode.id, label: mode.name }));
  const kept = current !== null && !listed.some((choice) => choice.value === current) ? [{ value: current, label: current }] : [];
  return [{ value: null, label: ENGINE_DEFAULT_LABEL }, ...listed, ...kept];
}

export function ChatSection({
  chat,
  lists,
  onChooseAgent,
  onChooseEngine,
}: {
  chat: ChatSettings | undefined;
  /** 엔진마다의 목록. 아직 못 받았거나 읽지 못했으면 `null`이다 — 그 엔진은 엔진 기본값만 고른다. */
  lists: Record<ChatAgent, EngineLists | null>;
  onChooseAgent: (agent: ChatAgent) => void;
  onChooseEngine: (agent: ChatAgent, field: EngineField, value: string | null) => void;
}) {
  const agent = defaultAgentOf(chat);
  // 엔진마다 한 줄 — 엔진 이름 열과 고르기 열이 두 행에서 같은 자리에 선다.
  const engineSelects = (field: EngineField) => (
    <div className="grid grid-cols-[auto_auto] items-center justify-items-start gap-x-2 gap-y-1">
      {CHAT_AGENTS.map((engine) => (
        <EngineSelect
          key={engine}
          engine={engine}
          field={field}
          choices={choicesOf(lists[engine], field, engineChoice(chat, engine, field))}
          value={engineChoice(chat, engine, field)}
          onChange={(value) => onChooseEngine(engine, field, value)}
        />
      ))}
    </div>
  );

  return (
    <SettingsSection head="새 대화">
      <SettingsGroup>
        {/* 기본 에이전트 — 둘 중 하나가 늘 켜져 있다(「테마」 행과 같은 칩 무리). 처음 값은 Claude Code다(three-axes 결정 16). */}
        <SettingsRow
          name="기본 에이전트"
          description={`+로 여는 새 대화의 에이전트예요. 처음은 ${AGENT_LABEL.claude}예요.`}
          control={
            <ToggleGroup
              size="chip"
              aria-label="기본 에이전트"
              value={[agent]}
              deselectable={false}
              onValueChange={([pick]) => onChooseAgent(pick)}
            >
              {CHAT_AGENTS.map((option) => (
                <ToggleGroupItem key={option} value={option}>
                  {AGENT_LABEL[option]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          }
        />
        <SettingsRow
          name={FIELD_NAME.model}
          description="엔진 기본값이면 그 엔진의 설정 그대로예요. 목록은 그 엔진의 대화를 한 번 열면 서요."
          control={engineSelects("model")}
        />
        <SettingsRow
          name={FIELD_NAME.mode}
          description="엔진 기본값이면 터미널에서처럼 그 엔진의 기본 모드로 시작해요. 이미 열린 대화는 바뀌지 않아요."
          control={engineSelects("mode")}
        />
      </SettingsGroup>
    </SettingsSection>
  );
}

/**
 * 한 엔진의 고르기 — 엔진 이름 + 셀렉트 칩(바깥 격자의 두 칸). 칩의 이름은 「Claude Code 기본 모델」처럼 엔진과 칸을 함께 든다 —
 * 보이는 엔진 이름은 그 이름과 겹치므로 읽어 주지 않는다.
 */
function EngineSelect({
  engine,
  field,
  choices,
  value,
  onChange,
}: {
  engine: ChatAgent;
  field: EngineField;
  choices: Choice[];
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  return (
    <>
      <span className="text-ui text-muted-foreground" aria-hidden>
        {AGENT_LABEL[engine]}
      </span>
      <Select items={choices} value={value} onValueChange={(picked) => onChange(picked ?? null)}>
        <SelectTrigger aria-label={`${AGENT_LABEL[engine]} ${FIELD_NAME[field]}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice) => (
            <SelectItem key={choice.value ?? ""} value={choice.value}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
