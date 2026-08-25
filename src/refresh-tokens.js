/**
 * 장기 토큰 자동 갱신
 *
 * Instagram 장기 토큰은 60일짜리입니다. 만료 전에 갱신하면 다시 60일이 되고,
 * 한 번이라도 놓치면 토큰이 죽어서 수동 재발급을 해야 합니다.
 * 그래서 이 스크립트를 2주에 한 번 돌려 여유 있게 갱신합니다.
 *
 * 새 토큰은 gh CLI 로 곧바로 GitHub Secrets 에 덮어씁니다.
 * 토큰 값은 화면에 절대 출력하지 않습니다.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { refreshToken } from './publish.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (process.env.ALL_SECRETS) {
  for (const [k, v] of Object.entries(JSON.parse(process.env.ALL_SECRETS))) {
    if (!(k in process.env)) process.env[k] = v;
  }
}

/** 값이 로그에 남지 않도록 stdin 으로 넘깁니다 */
function setSecret(name, value) {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', ['secret', 'set', name], {
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: process.platform === 'win32',
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`gh secret set ${name} 실패 (exit ${code})`))
    );
    child.stdin.write(value);
    child.stdin.end();
  });
}

async function main() {
  const dir = path.join(ROOT, 'accounts');
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json') && !f.startsWith('_'));

  const failures = [];
  let done = 0;
  let skipped = 0;

  for (const file of files) {
    const account = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));
    const name = account.secrets?.token;
    const current = name ? process.env[name] : null;

    if (!current) {
      console.log(`- ${account.id}: 토큰 시크릿(${name}) 없음 — 건너뜀`);
      skipped++;
      continue;
    }

    try {
      const { token, expiresInDays } = await refreshToken(current);
      await setSecret(name, token);
      console.log(`✔ ${account.id}: 갱신 완료 — 앞으로 ${expiresInDays}일 유효`);
      done++;
    } catch (err) {
      console.error(`✖ ${account.id}: ${err.message}`);
      failures.push({ id: account.id, secret: name, message: err.message });
    }
  }

  console.log(`\n갱신 ${done}건, 건너뜀 ${skipped}건, 실패 ${failures.length}건`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      '## 토큰 갱신 결과',
      '',
      `- 갱신 성공: ${done}건`,
      `- 건너뜀: ${skipped}건`,
      `- 실패: ${failures.length}건`,
    ];
    if (failures.length) {
      lines.push('', '### 실패 목록', '');
      for (const f of failures) lines.push(`- \`${f.id}\` (${f.secret}) — ${f.message}`);
      lines.push('', '> 실패한 계정은 Meta 콘솔에서 토큰을 새로 발급해 시크릿을 직접 갱신하세요.');
    }
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }

  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('치명적 오류:', err.message);
  process.exit(1);
});
