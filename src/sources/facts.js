/**
 * "재미있는 사실" 계정용 소재 수집 — 한국어 위키백과
 *
 * ★ 이 모듈이 존재하는 이유
 * AI 에게 "재밌는 사실 알려줘" 라고 하면 그럴듯한 거짓말을 지어냅니다.
 * 그걸 매일 자동 발행하면 계정 신뢰가 무너집니다.
 * 그래서 AI 가 사실을 '만들지' 못하게 하고, 실제 문서를 읽고 '뽑아내게' 합니다.
 *
 * 저작권: 사실 자체에는 저작권이 없습니다. 위키백과 문장을 그대로 옮기지 않고
 * 사실만 추려 자체 문장으로 쓰며, 캡션에 출처를 표기합니다.
 */

const API = 'https://ko.wikipedia.org/w/api.php';
const UA = 'insta-auto/1.0 (personal content pipeline)';

const MIN_LENGTH = 900; // 이보다 짧으면 사실이 몇 개 안 나옵니다
const MAX_MATERIAL = 7000; // 프롬프트에 넣을 최대 길이

async function wiki(params) {
  const url = new URL(API);
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`위키백과 ${res.status}`);
  return res.json();
}

/** 키워드로 실제 존재하는 문서 제목들을 찾습니다 */
async function searchTitles(keyword, limit = 5) {
  const json = await wiki({
    action: 'query',
    list: 'search',
    srsearch: keyword,
    srlimit: limit,
    srnamespace: 0,
  });
  return (json?.query?.search ?? []).map((r) => r.title);
}

/**
 * 문서 본문(순수 텍스트).
 * 넘겨주기, 동음이의 문서 등은 본문이 비어서 돌아오므로 호출부에서 걸러야 합니다.
 */
async function fetchExtract(title) {
  const json = await wiki({
    action: 'query',
    prop: 'extracts',
    explaintext: 1,
    redirects: 1,
    titles: title,
  });

  const pages = json?.query?.pages ?? {};
  const page = Object.values(pages)[0];
  return { title: page?.title ?? title, text: (page?.extract ?? '').trim() };
}

/** 각주 번호, 빈 줄, 문서 말미의 목록 섹션을 정리합니다 */
function tidyArticle(text) {
  const cut = text.split(/\n=+ *(?:같이 보기|각주|참고 문헌|외부 링크|참고자료)/)[0];
  return cut
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\[\d+\]/g, '')
    .trim()
    .slice(0, MAX_MATERIAL);
}

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

/**
 * 계정의 주제 시드 중 아직 안 쓴 것을 골라 실제 문서를 확보합니다.
 *
 * @param {object} account 계정 설정 (source.seeds 필요)
 * @param {string[]} usedTopics 이미 다룬 문서 제목
 * @returns {Promise<{seed: string, title: string, material: string, url: string} | null>}
 */
export async function collectFactArticle(account, usedTopics = []) {
  const seeds = account.source?.seeds ?? [];
  if (!seeds.length) throw new Error(`${account.id}: source.seeds 가 비어 있습니다`);

  const used = new Set(usedTopics);
  const fresh = seeds.filter((s) => !used.has(s));
  // 시드를 다 소진했으면 처음부터 다시 씁니다.
  // 같은 문서라도 최근 문구 목록이 중복을 막아주므로 다른 사실이 뽑힙니다.
  const pool = fresh.length ? fresh : seeds;

  for (const seed of shuffle(pool).slice(0, 6)) {
    let titles;
    try {
      titles = await searchTitles(seed);
    } catch (err) {
      console.log(`  ⚠ "${seed}" 검색 실패 — ${err.message}`);
      continue;
    }

    for (const title of titles) {
      if (used.has(title)) continue;

      let article;
      try {
        article = await fetchExtract(title);
      } catch (err) {
        console.log(`  ⚠ "${title}" 본문 실패 — ${err.message}`);
        continue;
      }

      // 넘겨주기·동음이의 문서는 본문이 비거나 너무 짧습니다
      if (article.text.length < MIN_LENGTH) continue;

      return {
        seed,
        title: article.title,
        material: tidyArticle(article.text),
        url: `https://ko.wikipedia.org/wiki/${encodeURIComponent(article.title)}`,
      };
    }
  }

  return null;
}
