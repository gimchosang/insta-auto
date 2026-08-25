/**
 * 장기 토큰 자동 갱신
 *
 * Instagram 장기 토큰은 60일짜리입니다. 만료 전에 갱신하면 다시 60일이 되고,
 * 한 번이라도 놓치면 토큰이 죽어서 수동 재발급을 해야 합니다.
 * 그래서 이 스크립트를 2주에 한 번 돌려 여유 있게 갱신합니다.
 *
 * 갱신한 토큰들은 IG_ACCOUNTS 시크릿 하나에 다시 써넣습니다.
 * 토큰 값은 화면에 절대 출력하지 않습니다.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { refreshToken } from './publish.js';
import { allCredentials, serializeCredentials } from './credentials.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

  const creds = allCredentials();
  if (!Object.keys(creds).length) {
    console.log('IG_ACCOUNTS 시크릿이 비어 있습니다. 갱신할 토큰이 없습니다.');
    return;
  }

  const failures = [];
  let done = 0;
  let skipped = 0;

  for (const file of files) {
    const account = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));
    const entry = creds[account.id];

    if (!entry?.token) {
      console.log(`- ${account.id}: IG_ACCOUNTS 에 없음 — 건너뜀`);
      skipped++;
      continue;
    }

    try {
      const { token, expiresInDays } = await refreshToken(entry.token);
      creds[account.id] = { ...entry, token };
      console.log(`✔ ${account.id}: 갱신 완료 — 앞으로 ${expiresInDays}일 유효`);
      done++;
    } catch (err) {
      console.error(`✖ ${account.id}: ${err.message}`);
      failures.push({ id: account.id, message: err.message });
    }
  }

  // 하나라도 갱신됐으면 시크릿을 통째로 다시 씁니다
  if (done > 0) {
    await setSecret('IG_ACCOUNTS', serializeCredentials(creds));
    console.log('\nIG_ACCOUNTS 시크릿을 갱신했습니다.');
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
      for (const f of failures) lines.push(`- \`${f.id}\` — ${f.message}`);
      lines.push('', '> 실패한 계정은 Meta 콘솔에서 토큰을 새로 발급해 IG_ACCOUNTS 를 직접 고치세요.');
    }
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }

  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('치명적 오류:', err.message);
  process.exit(1);
});
