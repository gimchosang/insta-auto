/**
 * Instagram 발행 (공식 Content Publishing API)
 *
 * 인증 방식: Instagram API with Instagram Login
 *   → 페이스북 페이지 연결이 필요 없어 설정이 단순합니다.
 *   → 엔드포인트는 graph.facebook.com 이 아니라 graph.instagram.com 입니다.
 *
 * 발행은 반드시 2단계입니다:
 *   1) 미디어 컨테이너 생성  POST /{ig-user-id}/media
 *   2) 컨테이너 발행         POST /{ig-user-id}/media_publish
 */

const HOST = 'https://graph.instagram.com';
// Meta 가 새 버전을 내면 이 값만 올리면 됩니다. (GitHub Variables 의 IG_API_VERSION)
const VERSION = process.env.IG_API_VERSION || 'v23.0';

async function igFetch(pathname, params, method = 'POST') {
  const url = new URL(`${HOST}/${VERSION}/${pathname}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, { method, signal: AbortSignal.timeout(60000) });
  const text = await res.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Instagram 응답 파싱 실패 (${res.status}): ${text.slice(0, 300)}`);
  }

  if (!res.ok || json.error) {
    const e = json.error || {};
    throw new Error(
      `Instagram ${res.status} — ${e.message || text.slice(0, 200)}` +
        (e.code ? ` (code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ''})` : '')
    );
  }
  return json;
}

/** 캡션 = 본문 + (출처) + (사진 출처) + 해시태그 */
export function buildCaption(content) {
  const parts = [content.caption.trim()];
  if (content.sourceNote) parts.push('', content.sourceNote);
  if (content.photoNote) parts.push(content.photoNote);

  const tags = (content.hashtags || []).join(' ');
  if (tags) parts.push('', tags);

  return parts.join('\n').trim();
}

/** 남은 발행 가능 횟수 확인 (계정당 24시간 100건) */
export async function checkLimit(igUserId, token) {
  const json = await igFetch(
    `${igUserId}/content_publishing_limit`,
    { fields: 'config,quota_usage', access_token: token },
    'GET'
  );
  const row = json.data?.[0] ?? {};
  return {
    used: row.quota_usage ?? 0,
    total: row.config?.quota_total ?? 100,
  };
}

/** 컨테이너가 발행 가능 상태가 될 때까지 대기 */
async function waitForContainer(containerId, token, maxTries = 12) {
  for (let i = 0; i < maxTries; i++) {
    const json = await igFetch(
      containerId,
      { fields: 'status_code,status', access_token: token },
      'GET'
    );

    if (json.status_code === 'FINISHED') return;
    if (json.status_code === 'ERROR' || json.status_code === 'EXPIRED') {
      throw new Error(`컨테이너 처리 실패: ${json.status_code} — ${json.status || ''}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('컨테이너가 60초 안에 준비되지 않았습니다');
}

/** 단일 이미지 컨테이너 생성 → 발행 */
async function publishSingle({ igUserId, token, imageUrl, caption }) {
  const container = await igFetch(`${igUserId}/media`, {
    image_url: imageUrl,
    caption,
    access_token: token,
  });
  if (!container.id) throw new Error('컨테이너 ID를 받지 못했습니다');
  console.log(`  · 컨테이너 생성됨: ${container.id}`);

  await waitForContainer(container.id, token);

  const published = await igFetch(`${igUserId}/media_publish`, {
    creation_id: container.id,
    access_token: token,
  });
  if (!published.id) throw new Error('발행 ID를 받지 못했습니다');
  return published;
}

/**
 * 캐러셀 발행 (2~10장)
 *
 * 3단계입니다:
 *   1) 장마다 is_carousel_item 컨테이너 생성
 *   2) 그것들을 children 으로 묶는 CAROUSEL 컨테이너 생성 (캡션은 여기에)
 *   3) 캐러셀 컨테이너 발행
 */
async function publishCarousel({ igUserId, token, imageUrls, caption }) {
  const childIds = [];

  for (const [i, imageUrl] of imageUrls.entries()) {
    const item = await igFetch(`${igUserId}/media`, {
      image_url: imageUrl,
      is_carousel_item: true,
      access_token: token,
    });
    if (!item.id) throw new Error(`${i + 1}장 컨테이너 생성 실패`);
    await waitForContainer(item.id, token);
    childIds.push(item.id);
    console.log(`  · ${i + 1}/${imageUrls.length}장 준비됨`);
  }

  // 캡션은 개별 장이 아니라 캐러셀 컨테이너에 붙습니다
  const carousel = await igFetch(`${igUserId}/media`, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption,
    access_token: token,
  });
  if (!carousel.id) throw new Error('캐러셀 컨테이너 생성 실패');

  await waitForContainer(carousel.id, token);

  const published = await igFetch(`${igUserId}/media_publish`, {
    creation_id: carousel.id,
    access_token: token,
  });
  if (!published.id) throw new Error('발행 ID를 받지 못했습니다');
  return published;
}

/**
 * 이미지 발행. 장수에 따라 단일/캐러셀을 알아서 고릅니다.
 * @param {string[]} imageUrls 슬라이드 순서대로
 * @returns {Promise<{id: string}>} 발행된 미디어 ID
 */
export async function publishPost({ igUserId, token, imageUrls, caption }) {
  if (!imageUrls?.length) throw new Error('발행할 이미지가 없습니다');
  if (imageUrls.length > 10) throw new Error('캐러셀은 최대 10장입니다');

  return imageUrls.length === 1
    ? publishSingle({ igUserId, token, imageUrl: imageUrls[0], caption })
    : publishCarousel({ igUserId, token, imageUrls, caption });
}

/**
 * 장기 토큰 갱신 (유효기간 60일, 최소 24시간 경과 후부터 갱신 가능)
 * refresh-token.yml 워크플로가 호출합니다.
 */
export async function refreshToken(token) {
  const url = new URL(`${HOST}/refresh_access_token`);
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', token);

  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const json = await res.json();

  if (!res.ok || json.error) {
    throw new Error(`토큰 갱신 실패: ${json.error?.message || res.status}`);
  }
  return {
    token: json.access_token,
    expiresInDays: Math.round((json.expires_in ?? 0) / 86400),
  };
}
