Implement and ship a change to the agent pipeline following this project's protocol. Use after `/agent-diagnose` picks a fix.

`agent/**`(파이프라인·프롬프트·체크리스트) 변경을 규약대로 구현→문서화→검증→커밋→push까지 하는 절차. 커밋 메시지 규격 자체는 `/commit`을 따르되, 여기선 그 앞뒤의 에이전트 특화 규율을 강제한다.

## 1. 구현
- 계획한 파일만 편집한다.
- ⚠️ **관련 없는 미커밋 변경을 스테이징에 휩쓸지 말 것.** `git add`는 **파일을 명시적으로** 지정한다(`git add -A`/`git add .` 금지). 커밋 전 `git status`로 워킹트리에 남은 별개 작업을 확인.

## 2. 문서화 (agent/** 사람 커밋이면 필수)
- **새 버그 패턴을 고쳤으면** `agent/REVIEW_CHECKLIST.md`에 항목 추가. 코드로 검증 가능한 항목엔 `<!-- @src: 파일:심볼 -->` 바인딩을 붙인다(심볼은 **실제 존재**해야 하며 `check:checklist`가 검증). 규칙을 추가·수정·삭제했으면 "갱신 로그"에 한 줄.
- `agent/CHANGELOG.md` **최상단**(`---` 뒤)에 항목 추가:
  ```
  ## [YYYY-MM-DD] 제목
  ### 배경  (왜 — 어떤 로그/증상에서 왔나)
  ### 변경  (무엇을 — 파일·심볼·동작)
  ### 검증  (typecheck·check:checklist·스모크 결과)
  ```
  날짜는 시스템 컨텍스트의 오늘 날짜.

## 3. 검증 게이트 (모두 통과해야 커밋)
```bash
npm run check:checklist                    # @src 바인딩 심볼 존재
npx tsc --noEmit                           # main tsconfig
npx tsc -p tsconfig.agent.json --noEmit    # agent tsconfig
```
- LLM 출력이 git/goals.md/셸로 흘러가면 sanitize 필요 여부를 판단(마커·개행·길이). 단, `git commit -m`은 execFileSync(배열 인자)라 셸 주입은 무관.

## 4. 커밋 (규격은 /commit)
- feat/fix/perf/docs · 영문 title · scope=모듈 · **`[agent]` 금지 · Co-Authored-By 금지** · 사람 커밋은 단일 라인 title 우선.
- 커밋 직전 `git diff --cached --name-only`로 **의도한 파일만** 스테이징됐는지 확인.

## 5. push (러너 push 경합 대비)
러너도 같은 main에 auto-push하므로 non-ff가 흔하다. rebase로 얹는다(autostash가 미커밋 보호):
```bash
git push origin main || { git pull --rebase --autostash origin main && git push origin main; }
```
push 후 확인: 히스토리 선형인지(`git log --oneline -5`), 미커밋 복구본(예: `agent/evolve.ts`)이 보존됐는지.

## 원칙
"고쳤다"고 말하기 전에 검증 게이트를 실제로 통과시킨다. 테스트가 실패하거나 단계를 건너뛰었으면 그대로 보고한다.
