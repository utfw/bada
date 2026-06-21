/// <reference types="node" />
/**
 * Project BADA — 체크리스트 stale 바인딩 검사 (결정적, LLM 미사용)
 *
 * REVIEW_CHECKLIST.md의 각 항목에 박힌 `<!-- @src: file:symbol -->` 태그를 추출해,
 * 해당 file에서 symbol이 실제로 존재하는지 grep으로 확인한다. 코드가 리팩터링으로
 * 이동·삭제되면 바인딩이 끊긴(stale) 항목을 자동 감지 → 사람/Planner가 갱신하도록.
 *
 * "심볼이 존재하는가?"는 결정적 질문이므로 LLM을 쓰지 않는다 (같은 입력 → 같은 답).
 *
 * 실행: npm run check:checklist
 * 종료 코드: stale 바인딩이 1개 이상이면 1, 모두 정상이면 0 (CI/파이프라인 게이트용).
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const CHECKLIST_FILE = path.join(ROOT, "agent", "REVIEW_CHECKLIST.md");

interface Binding {
  line: number; // 체크리스트 내 줄 번호 (1-based)
  file: string; // src 상대 경로
  symbol: string; // 함수/상수/클래스 이름
  raw: string; // 원본 태그 텍스트
}

// `<!-- @src: src/scene/Ocean.ts:addGodRays -->` 형태를 한 줄에서 모두 추출.
// 한 항목에 여러 심볼을 바인딩할 수 있으므로 콤마 구분도 허용:
//   <!-- @src: src/utils/constants.ts:FISH_ORBIT_WEIGHT,BOID_SEPARATION_WEIGHT -->
function extractBindings(text: string): Binding[] {
  const bindings: Binding[] = [];
  const tagRe = /<!--\s*@src:\s*([^>]+?)\s*-->/g;
  for (const m of text.matchAll(tagRe)) {
    const body = m[1].trim(); // "file:sym1,sym2"
    const colon = body.indexOf(":");
    if (colon === -1) continue;
    const file = body.slice(0, colon).trim();
    // 문서 내 예시 플레이스홀더("file:symbol", "src/파일.ts:심볼")를 실제 바인딩과 구분.
    // 진짜 태그는 src/ 또는 agent/ 로 시작하고 .ts로 끝나는 경로만 인정한다.
    if (!/^(src|agent)\/.+\.ts$/.test(file)) continue;
    const line = text.slice(0, m.index).split("\n").length;
    const symbols = body.slice(colon + 1).split(",").map((s) => s.trim()).filter(Boolean);
    for (const symbol of symbols) {
      bindings.push({ line, file, symbol, raw: m[0] });
    }
  }
  return bindings;
}

type Status = "ok" | "stale-symbol" | "missing-file";

interface Result extends Binding {
  status: Status;
}

// symbol이 file에 존재하는지 확인. 식별자 경계로 감싸 부분일치 오탐 방지
// (예: FISH_ORBIT_WEIGHT가 FISH_ORBIT_WEIGHTS에 잘못 매칭되지 않도록).
// 같은 파일을 가리키는 바인딩이 여럿이므로 파일 내용은 cache로 한 번만 읽는다.
function checkBinding(b: Binding, cache: Map<string, string | null>): Status {
  const filePath = path.join(ROOT, b.file);
  if (!cache.has(filePath)) {
    cache.set(filePath, fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : null);
  }
  const content = cache.get(filePath)!;
  if (content === null) return "missing-file";
  const symRe = new RegExp(`\\b${escapeRegExp(b.symbol)}\\b`);
  return symRe.test(content) ? "ok" : "stale-symbol";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function main(): void {
  if (!fs.existsSync(CHECKLIST_FILE)) {
    console.error(`체크리스트가 없습니다: ${CHECKLIST_FILE}`);
    process.exit(1);
  }
  const text = fs.readFileSync(CHECKLIST_FILE, "utf-8");
  const bindings = extractBindings(text);

  console.log(`\n${"═".repeat(80)}`);
  console.log(`🔗 체크리스트 stale 바인딩 검사 — ${bindings.length}개 바인딩`);
  console.log("═".repeat(80));

  if (bindings.length === 0) {
    console.log(`\n바인딩(@src 태그)이 하나도 없습니다.`);
    console.log(`항목에 \`<!-- @src: src/파일.ts:심볼 -->\` 태그를 추가하면 자동 검사됩니다.\n`);
    return;
  }

  const fileCache = new Map<string, string | null>();
  const results: Result[] = bindings.map((b) => ({ ...b, status: checkBinding(b, fileCache) }));
  const stale = results.filter((r) => r.status !== "ok");

  for (const r of results) {
    const mark = r.status === "ok" ? "✓" : "⚠️ STALE";
    const detail =
      r.status === "missing-file" ? " (파일 없음)" :
      r.status === "stale-symbol" ? " (심볼 사라짐)" : "";
    console.log(`  ${mark}  L${r.line}  ${r.file}:${r.symbol}${detail}`);
  }

  console.log(`\n${"─".repeat(80)}`);
  if (stale.length === 0) {
    console.log(`✅ 모든 바인딩 정상 — 체크리스트가 현재 코드와 일치합니다.\n`);
    process.exit(0);
  }
  console.log(`⚠️  STALE 바인딩 ${stale.length}개 — 코드가 이동/삭제됨. 체크리스트 항목 갱신 필요:`);
  for (const r of stale) {
    console.log(`   L${r.line}: ${r.file}:${r.symbol} → 코드에서 찾을 수 없음`);
  }
  console.log("");
  process.exit(1);
}

main();
