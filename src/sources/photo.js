/**
 * 카드 배경 사진 — Pexels 무료 이미지
 *
 * 무료 키 발급: https://www.pexels.com/api/  → GitHub Secrets 에 PEXELS_API_KEY
 *
 * ★ 왜 뉴스 사진을 안 쓰고 스톡 사진을 쓰나
 * 기사 사진은 언론사·통신사 저작물이라 해상도를 낮추든 AI 로 다시 그리든 침해입니다.
 * Pexels 이미지는 상업적 사용이 허용되어 있어 마음 놓고 쓸 수 있습니다.
 *
 * ★ 사진은 '배경'입니다
 * 실제 사건 현장 사진처럼 오해되면 안 되므로, 진하게 어둡게 깔아
 * 분위기만 만들고 정보는 자막이 전달하게 합니다.
 */

const API = 'https://api.pexels.com/v1/search';

/**
 * @param {string} query 영문 검색어 (한글은 결과가 거의 없습니다)
 * @returns {Promise<{url: string, photographer: string, page: string} | null>}
 */
export async function findPhoto(query) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return null; // 키가 없으면 단색 배경으로 갑니다 (실패시키지 않음)
  if (!query || !query.trim()) return null;

  const url = new URL(API);
  url.searchParams.set('query', query.trim());
  url.searchParams.set('orientation', 'square');
  url.searchParams.set('per_page', '15');

  let json;
  try {
    const res = await fetch(url, {
      headers: { Authorization: key },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.log(`  ⚠ Pexels ${res.status} — 배경 사진 없이 진행합니다`);
      return null;
    }
    json = await res.json();
  } catch (err) {
    console.log(`  ⚠ Pexels 실패 (${err.message}) — 배경 사진 없이 진행합니다`);
    return null;
  }

  const photos = json?.photos ?? [];
  if (!photos.length) {
    console.log(`  ⚠ "${query}" 사진을 못 찾음 — 배경 사진 없이 진행합니다`);
    return null;
  }

  // 상위 결과 중 무작위로 골라야 매번 같은 사진이 나오지 않습니다
  const pick = photos[Math.floor(Math.random() * Math.min(photos.length, 8))];

  return {
    url: pick.src?.large2x || pick.src?.large || pick.src?.original,
    photographer: pick.photographer ?? '',
    page: pick.url ?? '',
  };
}

/** 캡션에 넣을 사진 출처 한 줄 (Pexels 라이선스상 필수는 아니지만 남겨둡니다) */
export function photoCredit(photo) {
  if (!photo?.photographer) return null;
  return `사진: ${photo.photographer} / Pexels`;
}
