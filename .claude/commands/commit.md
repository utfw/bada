Stage and commit changes following this project's commit convention.

## 커밋 메시지 규격

- **타입**: `feat`, `fix`, `perf`, `docs` 중 선택. `refactor` 사용 금지 — 기능 개선/변경은 `feat`으로 통일. 문서(README, 가이드 등)만 변경 시 `docs`
- **스코프**: 변경 대상 모듈명 (예: `agent`, `WhaleShark`, `Fish`, `Ocean`, `controls`)
- **언어**: 영문
- **Co-Authored-By 금지**: 트레일러 줄 없이 메시지만 작성

## 작성자 구분 규칙 (필수)

이 프로젝트는 자율 에이전트(`agent/loop.ts`)도 커밋을 생성한다. 사후 분석·필터링을 위해 작성자 구분 마커를 사용한다:

- **사람(또는 Claude가 사람 지시로) 커밋**: 마커 **없음** (default).
- **에이전트 자동 커밋**: title 끝에 ` [agent]` 접미사 (자동으로 붙음, `agent/loop.ts` 참고).

`/commit` 스킬로 만드는 커밋은 항상 사람 커밋이므로 `[agent]` 마커를 **절대 붙이지 말 것**.

예시:
```
feat(agent): optimize Reviewer token usage and dedup threshold   ← 사람
fix(WhaleShark): correct dorsal fin attachment position          ← 사람
docs(README): document Evolver pipeline stage                    ← 사람
perf(Fish, Lighting): adjust orbit weights and god ray [agent]   ← 에이전트
```

추출:
```bash
# 사람 커밋만
git log --grep "\[agent\]" --invert-grep --oneline

# 에이전트 커밋만
git log --grep "\[agent\]" --oneline
```

## 에이전트 인프라 변경 시 CHANGELOG 갱신 (필수)

스테이징 대상에 `agent/**`(`loop.ts`, `observe.ts`, `evolve.ts`, `report.ts`, `checkChecklist.ts`, `checks/**`, `vision/**`, `pipeline/**`, `REVIEW_CHECKLIST.md` 등)가 **포함된 사람 커밋**이면, 커밋 전에 `agent/CHANGELOG.md` **최상단**(`---` 뒤 첫 항목 앞)에 새 항목을 추가한다:

```
## [YYYY-MM-DD] 제목 (커밋 <sha 있으면>)

### 배경
왜 바꿨는가 1~3줄.

### <파일 또는 영역>
- 무엇을 바꿨는지 불릿.

### 효과 / 검증 (해당 시)
```

- 날짜는 오늘(절대 날짜), 최신 항목이 위로 오도록 역순 유지.
- **`[agent]` 자동 커밋은 기록 대상이 아니다** — 에이전트 자신의 산출물이므로 CHANGELOG는 사람이 인프라를 바꿀 때만 갱신. 순수 `src/**`(씬/엔티티)만 바꾸는 사람 커밋도 대상 아님.
- CHANGELOG 갱신분을 같은 커밋에 함께 스테이징한다.

## 절차

1. `git diff` / `git status`로 변경 내역 확인
2. 스테이징 대상에 `agent/**`가 있으면 위 규칙대로 `agent/CHANGELOG.md` 최상단에 항목 추가
3. 위 규격에 맞는 커밋 메시지 초안 제안 (`[agent]` 마커 없이)
4. 사용자 확인 후 `git add` + `git commit`
