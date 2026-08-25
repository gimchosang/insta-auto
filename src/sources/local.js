/**
 * 지역 계정용 소재 수집
 *
 * 소스: 서울 열린데이터광장 - 서울시 문화행사 정보 (culturalEventInfo)
 *   무료 인증키 발급: https://data.seoul.go.kr/together/mypage/actKeyList.do
 *   → GitHub Secrets 에 SEOUL_API_KEY 로 저장
 *
 * 공공저작물이라 저작권이 깨끗하고, 자치구 필드(GUNAME)가 있어서
 * 계정 설정의 region.gu 만 바꾸면 다른 지역에 그대로 재사용됩니다.
 *
 * 주의: 이 API는 http + 8088 포트만 지원합니다 (https 미지원).
 */

const BASE = 'http://openapi.seoul.go.kr:8088';
const LOOKAHEAD_DAYS = 21;

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 설정 오류(키 문제 등)는 재시도해도 소용없으므로 즉시 중단시킵니다 */
function fatal(message) {
  return Object.assign(new Error(message), { fatal: true });
}

async function fetchDay(key, dateStr) {
  const url = `${BASE}/${key}/json/culturalEventInfo/1/300/%20/%20/${dateStr}/`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const text = await res.text();

  // 인증키가 틀리면 상태코드 200 에 XML 로 응답합니다. JSON 파싱 전에 걸러냅니다.
  if (text.trimStart().startsWith('<')) {
    const code = text.match(/<CODE>([^<]+)<\/CODE>/)?.[1] ?? '?';
    if (code === 'INFO-100' || code.startsWith('ERROR-3')) {
      throw fatal(`SEOUL_API_KEY 가 유효하지 않습니다 (${code}). 시크릿을 확인하세요.`);
    }
    throw new Error(`서울API XML 오류 ${code} (${dateStr})`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`서울API 응답 파싱 실패 (${dateStr}): ${text.slice(0, 120)}`);
  }

  const node = json.culturalEventInfo;
  const code = node?.RESULT?.CODE ?? json?.RESULT?.CODE;

  // 해당 날짜에 행사가 없으면 최상위에 INFO-200 을 반환합니다 (오류 아님)
  if (code === 'INFO-200') return [];
  if (code === 'INFO-100') {
    throw fatal('SEOUL_API_KEY 가 유효하지 않습니다 (INFO-100). 시크릿을 확인하세요.');
  }
  if (code && code !== 'INFO-000') {
    throw new Error(`서울API ${code}: ${node?.RESULT?.MESSAGE ?? json?.RESULT?.MESSAGE}`);
  }
  return node?.row ?? [];
}

/** API 원본 행 → 내부 표준 형태 */
function normalize(row) {
  return {
    id: `${row.TITLE}|${row.DATE}`.slice(0, 180),
    title: (row.TITLE || '').trim(),
    date: (row.DATE || '').trim(),
    place: (row.PLACE || '').trim(),
    category: (row.CODENAME || '').trim(),
    target: (row.USE_TRGT || '').trim(),
    fee: (row.USE_FEE || '').trim(),
    isFree: (row.IS_FREE || '').trim(),
    org: (row.ORG_NAME || '').trim(),
    program: (row.PROGRAM || '').trim().slice(0, 400),
    link: (row.ORG_LINK || row.HMPG_ADDR || '').trim(),
    startDate: (row.STRTDATE || '').slice(0, 10),
  };
}

/**
 * 대학가 관련도 점수.
 * campusWeight 가 높은 계정은 대학생이 갈 만한 행사를 우선 노출합니다.
 */
function campusScore(item, region) {
  const hay = `${item.title} ${item.place} ${item.target} ${item.program}`;
  let score = 0;

  for (const uni of region.universities) {
    const short = uni.name.replace(/학교$/, '');
    if (hay.includes(short) || hay.includes(uni.area)) score += 3;
  }
  for (const mark of region.landmarks) {
    if (hay.includes(mark)) score += 2;
  }
  if (/청년|대학생|20대|학생/.test(hay)) score += 2;
  if (item.isFree === '무료') score += 1;

  // 주말 행사 가산
  const start = new Date(item.startDate);
  if (!Number.isNaN(start.getTime())) {
    const day = start.getDay();
    if (day === 0 || day === 6) score += 1;
  }
  return score;
}

/**
 * 계정 설정에 맞는 소재 후보를 점수순으로 반환합니다.
 * @returns {Promise<Array>} 표준화된 행사 목록 (없으면 빈 배열)
 */
export async function collectLocalItems(account) {
  const key = process.env.SEOUL_API_KEY;
  if (!key) throw new Error('SEOUL_API_KEY 가 없습니다. GitHub Secrets에 추가하세요.');

  const region = account.source.region;
  const today = new Date();
  const seen = new Set();
  const items = [];

  for (let i = 0; i < LOOKAHEAD_DAYS; i++) {
    const day = new Date(today);
    day.setDate(today.getDate() + i);

    let rows;
    try {
      rows = await fetchDay(key, ymd(day));
    } catch (err) {
      // 키 오류는 21일을 반복해도 똑같이 실패합니다.
      // 조용히 넘어가면 "소재 없음"으로 오인되므로 즉시 중단합니다.
      if (err.fatal) throw err;
      console.log(`  ⚠ ${ymd(day)} 수집 실패, 건너뜀 — ${err.message}`);
      continue;
    }

    for (const row of rows) {
      if (row.GUNAME !== region.gu) continue;
      const item = normalize(row);
      if (!item.title || seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }

  const weight = account.source.campusWeight ?? 0;
  return items
    .map((it) => ({ ...it, _score: campusScore(it, region) * weight }))
    .sort((a, b) => b._score - a._score || a.startDate.localeCompare(b.startDate));
}

/** 선택된 행사를 Gemini 프롬프트에 넣을 텍스트로 변환 */
export function toMaterial(item) {
  const lines = [
    `행사명: ${item.title}`,
    `분류: ${item.category || '미상'}`,
    `기간: ${item.date || '미상'}`,
    `장소: ${item.place || '미상'}`,
  ];
  if (item.target) lines.push(`대상: ${item.target}`);
  if (item.isFree) lines.push(`요금구분: ${item.isFree}`);
  if (item.fee) lines.push(`요금상세: ${item.fee}`);
  if (item.org) lines.push(`주관: ${item.org}`);
  if (item.program) lines.push(`프로그램 설명: ${item.program}`);
  lines.push('', '출처: 서울 열린데이터광장 · 서울시 문화행사 정보 (공공저작물)');
  return lines.join('\n');
}
