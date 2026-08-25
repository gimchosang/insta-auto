/**
 * 뉴스 이슈 소재 수집 — 여러 매체 RSS 교차 검증
 *
 * ★ 왜 여러 매체를 동시에 보나
 * 한 매체만 보도한 내용은 오보일 수 있고, 화제 이슈가 아닐 수도 있습니다.
 * **2개 이상 매체가 같이 다룬 이슈**만 채택하면 두 가지가 동시에 해결됩니다.
 *   1) 사실 신뢰도 — 여러 편집국을 통과한 내용
 *   2) 화제성   — 여러 곳이 다룬다 = 지금 이슈다
 *
 * 저작권: 보도된 '사실'에는 저작권이 없습니다.
 * 기사 문장을 옮기지 않고 사실만 추려 자체 문장으로 쓰며, 캡션에 매체명을 남깁니다.
 * 기사 사진은 언론사 저작물이므로 일절 쓰지 않습니다 (우리는 텍스트 카드만 만듭니다).
 */

const FEEDS = [
  { name: '연합뉴스', url: 'https://www.yna.co.kr/rss/news.xml' },
  { name: '경향신문', url: 'https://www.khan.co.kr/rss/rssdata/total_news.xml' },
  { name: '머니투데이', url: 'https://rss.mt.co.kr/mt_news.xml' },
  { name: 'SBS', url: 'https://news.sbs.co.kr/news/newsflashRssFeed.do?plink=RSSREADER' },
];

const UA = 'Mozilla/5.0 (compatible; insta-auto/1.0)';
const MAX_AGE_HOURS = 36;
const MIN_OUTLETS = 2; // 이슈로 인정할 최소 매체 수

/**
 * ★ 자동 발행하면 안 되는 주제
 *
 * 뉴스 피드 상위는 대부분 사건사고와 정치입니다.
 * 진행 중인 사건을 AI 가 임의로 편집해 매일 올리면
 * 오보 시 명예훼손이고 피해자에게는 2차 가해가 됩니다.
 * 판단을 AI 에게 맡기지 않고 수집 단계에서 먼저 잘라냅니다.
 */
const HARD_BLOCK = [
  // 사건사고 · 수사
  '실종', '숨진', '숨져', '사망', '살해', '살인', '피살', '시신', '변사',
  '체포', '구속', '검거', '입건', '피의자', '용의자', '수사', '검찰', '경찰',
  '기소', '재판', '선고', '판결', '항소', '구형', '영장',
  '성폭행', '성추행', '성범죄', '몰카', '불법촬영', '마약', '학대', '폭행',
  '자살', '극단적', '유족', '참사', '화재', '붕괴', '추락', '실족',
  '음주운전', '뺑소니', '납치', '감금', '아동', '미성년',
  // 정치 · 분쟁
  '대통령', '국회', '여당', '야당', '의원', '장관', '청문회', '탄핵', '개헌',
  '민주당', '국민의힘', '조국혁신당', '대선', '총선', '지방선거',
  '트럼프', '푸틴', '시진핑', '김정은',
  '전쟁', '폭격', '공습', '미사일', '교전', '휴전', '테러',
  // 증시 · 투자 (권유로 읽힐 수 있음)
  '주가', '급등', '급락', '상한가', '하한가', '코인', '비트코인', '투자',
  // 국제 분쟁 · 외교
  '이란', '제재', '외교', '정상회담', '핵합의', '관세', '무역분쟁',
];

/**
 * 우선 고르고 싶은 주제.
 * 차단만 하면 스포츠 경기 결과 같은 게 남는데, 이슈 계정 소재로는 약합니다.
 * "왜 그런가"를 설명할 여지가 있는 생활·과학·소비 이슈를 앞으로 당깁니다.
 * (보여주신 러브버그 방제 건이 정확히 이 부류입니다)
 */
const PREFER = [
  '연구', '조사', '발견', '개발', '실험', '분석', '결과', '효과',
  '기후', '날씨', '폭염', '한파', '미세먼지', '생태', '멸종', '서식',
  '물가', '가격', '요금', '인상', '인하', '소비', '유통', '배달',
  '기술', '인공지능', '반도체', '전기차', '배터리', '우주', '위성',
  '건강', '수면', '영양', '질병', '백신', '의료',
  '트렌드', '유행', '세대', '인구', '출산', '고령', '통계',
];

/* ── RSS 파싱 ────────────────────────────────────────── */

function stripTags(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pick(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? stripTags(m[1]) : '';
}

function parseFeed(xml, outlet) {
  const items = [];
  for (const m of xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = m[1];
    const title = pick(block, 'title');
    if (!title) continue;

    const pub = pick(block, 'pubDate') || pick(block, 'dc:date');
    const at = pub ? new Date(pub) : null;

    items.push({
      outlet,
      title,
      // 기자명/지역 머리말을 떼어냅니다: "(서울=연합뉴스) 홍길동 기자 = 본문..."
      lead: pick(block, 'description').replace(/^\([^)]*\)\s*[^=]*=\s*/, ''),
      link: pick(block, 'link'),
      at: at && !Number.isNaN(at.getTime()) ? at : null,
    });
  }
  return items;
}

async function fetchFeed(feed) {
  const res = await fetch(feed.url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${feed.name} ${res.status}`);
  return parseFeed(await res.text(), feed.name);
}

/* ── 이슈 묶기 ───────────────────────────────────────── */

const STOPWORDS = new Set([
  '기자', '뉴스', '속보', '단독', '종합', '오늘', '내일', '어제', '올해', '작년',
  '지난해', '이번', '관련', '대한', '위해', '통해', '따라', '대해', '한다', '했다',
  '있다', '없다', '된다', '이다', '까지', '부터', '에서', '으로', '하는', '하고',
  '그리고', '하지만', '이런', '저런', '무슨', '누구', '사람', '정부', '국내',
]);

/** 제목에서 의미 있는 낱말만 추립니다 (한글 2자 이상, 영문/숫자 포함) */
function keywords(title) {
  const tokens = title.match(/[가-힣]{2,}|[A-Za-z]{3,}|\d{2,}/g) ?? [];
  return [...new Set(tokens.filter((t) => !STOPWORDS.has(t) && t.length <= 12))];
}

/**
 * 같은 이슈를 다룬 기사끼리 묶습니다.
 * 형태소 분석기 없이도, 제목의 낱말이 겹치는지로 충분히 잡힙니다.
 */
function clusterIssues(articles) {
  const byKeyword = new Map();

  for (const a of articles) {
    a.keys = keywords(a.title);
    for (const k of a.keys) {
      if (!byKeyword.has(k)) byKeyword.set(k, []);
      byKeyword.get(k).push(a);
    }
  }

  const clusters = [];
  for (const [key, group] of byKeyword) {
    const outlets = new Set(group.map((a) => a.outlet));
    if (outlets.size < MIN_OUTLETS) continue;

    // 설명할 여지가 있는 주제인지 (러브버그 방제 같은)
    const text = group.map((a) => `${a.title} ${a.lead}`).join(' ');
    const preferHits = PREFER.filter((w) => text.includes(w)).length;

    clusters.push({
      key,
      outlets: [...outlets],
      articles: group.slice(0, 6),
      // 매체 수 > 소재 적합도 > 기사 수 순으로 우선합니다
      score: outlets.size * 10 + Math.min(preferHits, 6) * 4 + Math.min(group.length, 8),
    });
  }

  // 같은 이슈가 여러 낱말로 중복 검출되므로, 기사가 겹치면 큰 쪽만 남깁니다
  clusters.sort((a, b) => b.score - a.score);
  const taken = new Set();
  const unique = [];
  for (const c of clusters) {
    const ids = c.articles.map((a) => a.title);
    if (ids.some((id) => taken.has(id))) continue;
    ids.forEach((id) => taken.add(id));
    unique.push(c);
  }
  return unique;
}

/* ── 공개 함수 ───────────────────────────────────────── */

/**
 * 지금 화제인 이슈 중 아직 안 다룬 것을 하나 고릅니다.
 *
 * @param {object} account 계정 설정 (source.exclude 로 제외 키워드 지정 가능)
 * @param {string[]} usedKeys 이미 다룬 이슈 키
 * @returns {Promise<{key, outlets, material, sources} | null>}
 */
export async function collectNewsIssue(account, usedKeys = []) {
  const results = await Promise.allSettled(FEEDS.map(fetchFeed));

  const articles = [];
  for (const [i, r] of results.entries()) {
    if (r.status === 'fulfilled') articles.push(...r.value);
    else console.log(`  ⚠ ${FEEDS[i].name} 수집 실패 — ${r.reason?.message ?? r.reason}`);
  }
  if (!articles.length) throw new Error('뉴스를 한 건도 가져오지 못했습니다');

  // 오래된 기사 제외 (날짜가 없으면 남겨둡니다)
  const cutoff = Date.now() - MAX_AGE_HOURS * 3600_000;
  const recent = articles.filter((a) => !a.at || a.at.getTime() >= cutoff);

  // 차단어는 제목과 리드 양쪽에서 봅니다. 계정별 추가 차단어도 합칩니다.
  const blocked = [...HARD_BLOCK, ...(account.source?.exclude ?? [])];
  const filtered = recent.filter((a) => {
    const hay = `${a.title} ${a.lead}`;
    return !blocked.some((w) => hay.includes(w));
  });

  console.log(
    `  · 기사 ${articles.length}건 → 최근 ${recent.length}건 → 발행 가능 ${filtered.length}건`
  );

  const used = new Set(usedKeys);
  const clusters = clusterIssues(filtered).filter((c) => !used.has(c.key));
  if (!clusters.length) return null;

  const chosen = clusters[0];

  // 여러 매체의 제목과 리드를 그대로 넘겨서, AI 가 교차 확인하며 쓰게 합니다
  const material = chosen.articles
    .map((a, i) => `[기사 ${i + 1} · ${a.outlet}]\n제목: ${a.title}\n내용: ${a.lead || '(요약 없음)'}`)
    .join('\n\n');

  return {
    key: chosen.key,
    outlets: chosen.outlets,
    material,
    sources: chosen.articles.map((a) => ({ outlet: a.outlet, title: a.title })),
  };
}
