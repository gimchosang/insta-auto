/**
 * 오케스트레이터 — 매시 정각에 실행되어, 지금 발행할 계정만 처리합니다.
 *
 *   node src/index.js                    실제 발행
 *   node src/index.js --dry-run          이미지만 만들고 발행은 안 함
 *   node src/index.js --account=univ-humor --force --dry-run   특정 계정 미리보기
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateContent } from './generate.js';
import { collectLocalItems, toMaterial } from './sources/local.js';
import { renderSlides, publicUrl } from './render.js';
import { publishPost, buildCaption, checkLimit } from './publish.js';
import { credentialsFor } from './credentials.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_FILE = path.join(ROOT, 'state', 'published.json');
const HISTORY_LIMIT = 40;

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const FORCE = argv.includes('--force');
const ONLY = argv.find((a) => a.startsWith('--account='))?.split('=')[1];

/* ── 한국 시간 ───────────────────────────────────────── */

function kstNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());

  const get = (t) => parts.find((p) => p.type === t).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
  };
}

/* ── 상태 저장 ───────────────────────────────────────── */

async function loadState() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function saveState(state) {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

async function loadAccounts() {
  const dir = path.join(ROOT, 'accounts');
  const files = (await fs.readdir(dir)).filter(
    (f) => f.endsWith('.json') && !f.startsWith('_')
  );

  const accounts = [];
  for (const f of files) {
    accounts.push(JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')));
  }
  return accounts;
}

/* ── 계정 1건 처리 ───────────────────────────────────── */

async function runAccount(account, state, now) {
  const entry = state[account.id] ?? { recent: [] };
  console.log(`\n▶ ${account.displayName} (${account.id})`);

  if (entry.lastDate === now.date && !FORCE) {
    console.log('  · 오늘 이미 발행됨 — 건너뜁니다');
    return null;
  }

  // 1) 소재 확보
  let material = null;
  let sourceItem = null;

  if (account.source?.type === 'local') {
    const items = await collectLocalItems(account);
    const usedIds = new Set(entry.usedItemIds ?? []);
    sourceItem = items.find((it) => !usedIds.has(it.id));

    if (!sourceItem) {
      // 지어내지 않고 건너뜁니다. 없는 행사를 만들어내는 것보다 하루 쉬는 게 낫습니다.
      console.log(`  · 새 소재 없음 (수집 ${items.length}건, 전부 사용됨) — 건너뜁니다`);
      return null;
    }
    material = toMaterial(sourceItem);
    console.log(`  · 소재: ${sourceItem.title.slice(0, 50)} (${sourceItem.date})`);
  }

  // 2) 문구 생성
  const content = await generateContent(account, material, entry.recent ?? []);
  console.log(`  · 후킹: ${content.slides[0].lines.join(' / ')}`);

  // 3) 카드 렌더링 (캐러셀 전체)
  const rendered = await renderSlides(account, content, now.date, ROOT);
  console.log(`  · 렌더 완료: ${rendered.length}장`);

  const caption = buildCaption(content);

  if (DRY_RUN) {
    console.log('  · [드라이런] 발행 생략');
    console.log('  ┌─ 슬라이드');
    content.slides.forEach((s, i) =>
      console.log(`  │ ${i + 1}. ${s.lines.join(' / ')}`)
    );
    console.log('  ├─ 캡션');
    caption.split('\n').forEach((l) => console.log('  │ ' + l));
    console.log('  └─');
    return { account, content, rendered, sourceItem, published: false };
  }

  // 4) 발행
  const creds = credentialsFor(account.id);
  if (!creds) {
    throw new Error(
      `IG_ACCOUNTS 시크릿에 "${account.id}" 항목이 없습니다. ` +
        `{ "${account.id}": { "token": "...", "userId": "..." } } 형태로 추가하세요.`
    );
  }
  const { token, userId: igUserId } = creds;

  const limit = await checkLimit(igUserId, token);
  console.log(`  · 발행 한도: ${limit.used}/${limit.total}`);
  if (limit.used >= limit.total) {
    console.log('  · 한도 소진 — 건너뜁니다');
    return null;
  }

  const imageUrls = rendered.map((r) => publicUrl(r.relPath));
  console.log(`  · 이미지 ${imageUrls.length}장 — ${imageUrls[0]}`);

  const result = await publishPost({ igUserId, token, imageUrls, caption });
  console.log(`  ✔ 발행 완료 — media id ${result.id}`);

  return { account, content, rendered, sourceItem, published: true, mediaId: result.id };
}

/* ── 메인 ────────────────────────────────────────────── */

async function main() {
  const now = kstNow();
  console.log(`한국시간 ${now.date} ${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`);
  if (DRY_RUN) console.log('모드: 드라이런 (실제 발행 안 함)');

  const all = await loadAccounts();
  const state = await loadState();

  const due = all.filter((a) => {
    if (ONLY) return a.id === ONLY;
    // 실제 발행에서는 enabled 를 반드시 존중합니다.
    // (워밍업 중인 계정이 --force 로 발행되면 안 됩니다)
    if (!a.enabled && !DRY_RUN) return false;
    if (FORCE) return true;
    return Number(a.publishAt.split(':')[0]) === now.hour;
  });

  if (!due.length) {
    console.log('이번 시간에 발행할 계정이 없습니다.');
    return;
  }
  console.log(`대상 계정 ${due.length}개: ${due.map((a) => a.id).join(', ')}`);

  let ok = 0;
  const failures = [];

  for (const account of due) {
    try {
      // 정각에 몰리지 않도록 랜덤 대기
      if (!DRY_RUN && !FORCE && account.jitterMinutes) {
        const waitMs = Math.floor(Math.random() * account.jitterMinutes * 60_000);
        console.log(`\n⏱ ${account.id}: ${Math.round(waitMs / 60000)}분 대기 후 진행`);
        await new Promise((r) => setTimeout(r, waitMs));
      }

      const result = await runAccount(account, state, now);
      if (!result) continue;

      if (result.published) {
        const entry = state[account.id] ?? { recent: [] };
        entry.lastDate = now.date;
        entry.recent = [
          result.content.slides[0].lines.join(' / '),
          ...(entry.recent ?? []),
        ].slice(0, HISTORY_LIMIT);
        if (result.sourceItem) {
          entry.usedItemIds = [result.sourceItem.id, ...(entry.usedItemIds ?? [])].slice(0, 200);
        }
        entry.lastMediaId = result.mediaId;
        state[account.id] = entry;
        ok++;
      }
    } catch (err) {
      console.error(`  ✖ ${account.id} 실패 — ${err.message}`);
      failures.push({ id: account.id, message: err.message });
    }
  }

  if (!DRY_RUN) await saveState(state);

  console.log(`\n───────────────\n발행 성공 ${ok}건, 실패 ${failures.length}건`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✖ ${f.id}: ${f.message}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('치명적 오류:', err);
  process.exit(1);
});
