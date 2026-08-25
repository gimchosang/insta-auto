/**
 * 계정 자격증명 로딩
 *
 * 계정마다 시크릿을 2개씩 만들면 계정이 늘 때마다 워크플로 파일에
 * 시크릿 전달 줄을 추가해야 합니다. 그렇다고 toJSON(secrets) 로
 * 전부 넘기면 워크플로 안에서 도는 모든 코드(npm 의존성 포함)가
 * 모든 시크릿을 읽을 수 있게 되어 위험합니다.
 *
 * 그래서 계정 자격증명만 IG_ACCOUNTS 시크릿 하나에 JSON 으로 모읍니다.
 * 계정이 30개가 되어도 워크플로는 그대로고, 노출 범위는 이 파일 하나로 제한됩니다.
 *
 * IG_ACCOUNTS 형식:
 * {
 *   "body-facts":  { "token": "IGAA...", "userId": "1784140..." },
 *   "origin-facts":{ "token": "IGAA...", "userId": "1784140..." }
 * }
 */

let cache = null;

function load() {
  if (cache) return cache;

  const raw = process.env.IG_ACCOUNTS;
  if (!raw || !raw.trim()) {
    cache = {};
    return cache;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      'IG_ACCOUNTS 시크릿이 올바른 JSON 이 아닙니다. ' +
        '따옴표나 쉼표가 빠지지 않았는지 확인하세요. (' + err.message + ')'
    );
  }

  if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null) {
    throw new Error('IG_ACCOUNTS 는 { "계정id": { "token": ..., "userId": ... } } 형태여야 합니다.');
  }

  cache = parsed;
  return cache;
}

/**
 * @param {string} accountId accounts/*.json 의 id
 * @returns {{token: string, userId: string} | null}
 */
export function credentialsFor(accountId) {
  const entry = load()[accountId];
  if (!entry) return null;

  const token = entry.token ?? entry.accessToken;
  const userId = entry.userId ?? entry.igUserId ?? entry.id;
  if (!token || !userId) return null;

  return { token: String(token).trim(), userId: String(userId).trim() };
}

/** 등록된 계정 id 목록 */
export function credentialIds() {
  return Object.keys(load());
}

/** 토큰 갱신 후 저장할 JSON 문자열을 만듭니다 */
export function serializeCredentials(map) {
  return JSON.stringify(map, null, 2);
}

/** 전체 맵의 복사본 (갱신 워크플로용) */
export function allCredentials() {
  return JSON.parse(JSON.stringify(load()));
}
