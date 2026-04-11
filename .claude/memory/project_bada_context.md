---
name: Project BADA 컨텍스트
description: Project BADA의 기술 스택, 자동화 루프 구성, 테스트 전략
type: project
---

모바일 웹 기반 3D 해양 체험 프로젝트 (Three.js + TypeScript + Vite).

**Why:** 포트폴리오용 프로젝트. 자이로 센서, 날씨 API, Three.js 3D 렌더링 기술 어필 목적.

**How to apply:** Three.js 씬 관련 코드는 모바일 GPU 최적화를 우선 고려. 날씨 API 변경은 Lighting/Ocean/SkyBox 모두에 전파 필요.

## 자동화 루프 구성 (2026-04-11 기준)

- `.claude/settings.json` 훅: Edit/Write 후 `tsc --noEmit` 자동 실행 → 타입 오류 즉시 피드백
- Playwright (Chromium): `npm run test`로 E2E 테스트, Vite 서버 자동 시작
- `tests/smoke.spec.ts`: 스모크 + 날씨별 시나리오 + 모바일 터치 인터랙션
- `CLAUDE.md`: 에이전트 컨텍스트 파일 (명령어, 아키텍처 규칙, 디버깅 팁)

## 테스트 전략

Jest 대신 Playwright 선택. Three.js 캔버스는 실제 브라우저 WebGL 필요.
- `window.__scene`, `window.__weather` dev 전역 변수로 씬 상태 검증
- 날씨 API는 Playwright route mock으로 대체
