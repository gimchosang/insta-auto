/**
 * 캐러셀 문구 + 캡션 생성 (Google Gemini 무료 티어)
 *
 * 무료 키 발급: https://aistudio.google.com/apikey
 * → GitHub Secrets 에 GEMINI_API_KEY 로 저장
 *
 * 구조:
 *   1장(hook)  — 크게 던져서 손가락을 멈추게 하는 문구
 *   2~5장(body) — 후킹이 약속한 것을 실제로 풀어주는 내용
 *
 * 문구는 한 덩어리가 아니라 "줄 배열"로 받습니다.
 * 썸네일에서 줄바꿈 위치가 곧 리듬이고, 마지막 줄이 후킹을 담당합니다.
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * 구글이 모델을 자주 갈아치우고 예전 모델을 종료시킵니다.
 * 하나를 박아두면 어느 날 조용히 발행이 멈추므로, 후보를 순서대로 시도합니다.
 * 무료 티어에서 어떤 모델이 열려 있는지도 계정마다 다를 수 있어서 이 방식이 안전합니다.
 *
 * 쓰고 싶은 모델이 정해져 있으면 GitHub Variables 에 GEMINI_MODEL 을 넣으면 됩니다.
 */
const MODEL_CANDIDATES = [
  process.env.GEMINI_MODEL,
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash-lite',
].filter(Boolean);

// 한 번 성공한 모델을 기억해서 다음 호출부터는 곧바로 씁니다
let activeModel = null;

const HOOK_MAX = 9;
const BODY_MAX = 14;
const LOCAL_HOOK_MAX = 12;

const slideSchema = (desc, maxLen) => ({
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      description: `${desc} 2~3줄로 자르고, 각 줄은 공백 포함 ${maxLen}자 이내.`,
      items: { type: 'string' },
    },
    emphasizeLine: {
      type: 'integer',
      description: '색을 뒤집어 강조할 줄 번호(0부터). 없으면 -1.',
    },
  },
  required: ['lines', 'emphasizeLine'],
});

const HUMOR_SCHEMA = {
  type: 'object',
  properties: {
    hook: slideSchema('1장에 들어갈 후킹 문구.', HOOK_MAX),
    body: {
      type: 'array',
      description: '2장부터 들어갈 내용. 3~4개.',
      items: slideSchema('한 장에 들어갈 문구.', BODY_MAX),
    },
    caption: { type: 'string', description: '인스타 캡션. 2~3줄. 해시태그 제외.' },
  },
  required: ['hook', 'body', 'caption'],
};

const FACTS_SCHEMA = {
  type: 'object',
  properties: {
    hook: slideSchema('1장에 들어갈 후킹 문구.', HOOK_MAX),
    body: {
      type: 'array',
      description: '2장부터 들어갈 사실. 3~4개. 각각 서로 다른 사실이어야 합니다.',
      items: slideSchema('한 장에 들어갈 사실 하나.', BODY_MAX),
    },
    caption: { type: 'string', description: '인스타 캡션. 2~3줄. 해시태그와 출처 제외.' },
  },
  required: ['hook', 'body', 'caption'],
};

const NEWS_SCHEMA = {
  type: 'object',
  properties: {
    suitable: {
      type: 'boolean',
      description: '이 이슈를 자동 발행해도 되는지. 조금이라도 걸리면 false.',
    },
    rejectReason: { type: 'string', description: 'false 인 이유. true 면 빈 문자열.' },
    hook: slideSchema('1장에 들어갈 후킹 문구.', HOOK_MAX),
    body: {
      type: 'array',
      description: '2장부터 들어갈 내용. 3~4개.',
      items: slideSchema('한 장에 들어갈 내용.', BODY_MAX),
    },
    caption: { type: 'string', description: '인스타 캡션. 3~5줄. 해시태그와 출처 제외.' },
  },
  required: ['suitable', 'rejectReason', 'hook', 'body', 'caption'],
};

const LOCAL_SCHEMA = {
  type: 'object',
  properties: {
    tag: { type: 'string', description: '카테고리. 4자 이내. 예: 행사, 축제, 무료, 마감임박' },
    hook: slideSchema('1장에 들어갈 후킹 문구.', LOCAL_HOOK_MAX),
    meta: {
      type: 'array',
      description: '1장 하단에 넣을 핵심 정보 2개. 원본 자료에 있는 것만.',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: '항목명 2~3자. 예: 기간, 장소, 대상, 요금' },
          value: { type: 'string', description: '내용. 18자 이내로 줄여서.' },
        },
        required: ['key', 'value'],
      },
    },
    body: {
      type: 'array',
      description: '2장부터 들어갈 상세 내용. 2~3개.',
      items: slideSchema('한 장에 들어갈 문구.', BODY_MAX),
    },
    caption: { type: 'string', description: '인스타 캡션. 2~4줄. 해시태그 제외.' },
  },
  required: ['tag', 'hook', 'meta', 'body', 'caption'],
};

/* ── 프롬프트 ────────────────────────────────────────── */

const CAROUSEL_RULES = `
# 캐러셀 구조 (가장 중요)
게시물은 여러 장짜리입니다. 1장은 손가락을 멈추게 하고, 2장부터가 본론입니다.

## 1장 (hook)
인스타를 빠르게 넘기는 사람이 **0.3초 안에** 읽어야 합니다.
글자가 화면을 꽉 채우므로 길면 글씨가 작아지고, 작아지면 아무도 안 봅니다.
- 2~3줄. 각 줄 공백 포함 **${HOOK_MAX}자 이내**. 넘기면 실패입니다.
- 줄바꿈은 의미 단위가 아니라 **호흡 단위**로 끊으세요.
  좋은 예: ["영화표 한 장에", "30만 원", "실화냐"]
  나쁜 예: ["영화표 한 장에 30만 원이라니", "이게 말이 되나요"]
- 마지막 줄은 짧게 던지세요. "실화냐" "나만 그래?" "이게 맞나" 처럼요.
- 마침표 금지. 물음표는 꼭 필요할 때만.

## 2장부터 (body)
- 3~4장. 각 장 2~3줄, 각 줄 공백 포함 **${BODY_MAX}자 이내**.
- **한 장에 한 가지 이야기만** 담으세요.
  한 문장을 여러 장에 이어서 자르면 안 됩니다. 장마다 독립적으로 읽혀야 합니다.
- 1장에서 궁금하게 만든 것을 실제로 풀어주세요.
  후킹만 세고 내용이 없으면 다음부터 아무도 안 봅니다.
- **마지막 장은 마무리 한 방**입니다. 가장 공감되는 것이나 반전을 놓으세요.

## 강조(emphasizeLine)
색이 뒤집히는 강조는 **1장과 마지막 장에만** 쓰세요. 그것도 각각 한 줄만.
중간 장들은 전부 -1 로 두세요. 매 장마다 강조하면 아무것도 강조되지 않습니다.
`;

function humorPrompt(account, recentLines) {
  const p = account.persona;
  const topics = p.topics.map((t) => `- ${t}`).join('\n');
  const recent = recentLines.length
    ? `\n# 최근에 이미 올린 것 (절대 비슷하게 쓰지 마세요)\n${recentLines.map((h) => `- ${h}`).join('\n')}\n`
    : '';

  return `당신은 인스타그램 공감 유머 계정 "${account.displayName}"의 캐러셀 게시물을 만듭니다.

# 화자
${p.who}

# 말투
${p.voice}

# 절대 하지 말 것
${p.avoid}

# 소재 풀 (하나를 골라 아주 구체적인 장면들로 좁히세요)
${topics}
${recent}${CAROUSEL_RULES}

# 공감의 원리
"과제가 힘들다"는 아무도 반응하지 않습니다. "제출 3분 전 파일명 고침"은 반응합니다.
누구나 겪었지만 아무도 입 밖에 안 낸 **구체적인 순간**을 집어내세요.
body 각 장은 같은 주제의 서로 다른 순간이어야 합니다. 같은 말을 바꿔 쓰지 마세요.

# 캡션
캐러셀이 다룬 상황을 한 번 더 짚거나 독자에게 되묻는 식으로 쓰세요.
1장 문구를 그대로 반복하지 마세요.

# 금지
실존 인물·학교·회사·브랜드를 실명으로 비하하지 마세요.

지금 오늘의 게시물 1건을 만드세요.`;
}

function factsPrompt(account, article, recentLines) {
  const p = account.persona;
  const recent = recentLines.length
    ? `\n# 최근에 이미 올린 것 (중복 금지)\n${recentLines.map((h) => `- ${h}`).join('\n')}\n`
    : '';

  return `당신은 인스타그램 지식 계정 "${account.displayName}"의 캐러셀을 만듭니다.

# 화자
${p.who}

# 말투
${p.voice}

# 절대 하지 말 것
${p.avoid}

# ★★ 가장 중요한 규칙 — 지어내지 마세요
아래 [문서]에 **실제로 적혀 있는 내용만** 사용하세요.

- 문서에 없는 사실은 **한 줄도** 쓰면 안 됩니다. 알고 있는 것 같아도 쓰지 마세요.
- 숫자, 연도, 이름은 문서에 적힌 그대로만 쓰세요. 반올림하거나 각색하지 마세요.
- 문서 문장을 그대로 베끼지 말고, 사실만 뽑아 당신의 문장으로 다시 쓰세요.
- 문서에서 흥미로운 사실이 3개도 안 나오면, body 를 2장으로 줄이세요.
  억지로 채우려고 지어내는 것보다 짧은 게 낫습니다.

# 무엇이 좋은 사실인가
- **모르던 것**이어야 합니다. "커피는 카페인을 함유한다" 같은 건 아무도 안 봅니다.
- **구체적인 수치나 메커니즘**이 있으면 강합니다. "왜 그런지" 한 단계 더 들어가세요.
- 각 장은 **서로 다른 사실**이어야 합니다. 같은 내용을 말만 바꾸면 안 됩니다.

${CAROUSEL_RULES}

# 1장 후킹은 이렇게
정답을 미리 말하지 말고 궁금하게 만드세요.
  나쁜 예: ["카페인은 아데노신", "수용체를 막는다"]   ← 답을 다 말해버림
  좋은 예: ["카페인은 잠을", "깨우는 게 아니다"]      ← 그럼 뭔데? 하고 넘김
${recent}
# 문서: ${article.title}

${article.material}

위 문서에서 사실을 뽑아 게시물 1건을 만드세요.`;
}

function newsPrompt(account, issue, recentLines) {
  const p = account.persona;
  const recent = recentLines.length
    ? `\n# 최근에 이미 올린 것 (중복 금지)\n${recentLines.map((h) => `- ${h}`).join('\n')}\n`
    : '';

  return `당신은 인스타그램 이슈 계정 "${account.displayName}"의 캐러셀을 만듭니다.

# 화자
${p.who}

# 말투
${p.voice}

# 절대 하지 말 것
${p.avoid}

# ★★ 첫 번째로 할 일 — 이 소재를 써도 되는지 판단
아래 기사들을 읽고, 다음 중 하나라도 해당하면 suitable 을 false 로 두세요.
- 사건·사고·범죄·수사·재판에 관한 것
- 정치인, 정당, 선거, 국제 분쟁에 관한 것
- 특정 개인이 식별되는 내용 (피해자, 당사자, 유명인 사생활)
- 질병·죽음·재난 등 누군가 상처받을 수 있는 내용
- 기사들끼리 내용이 어긋나 사실이 불분명한 것
- 사실 확인 없이 단정하면 특정 기업·집단에 손해가 될 수 있는 것

**애매하면 false 로 두세요.** 하루 쉬는 게 사고보다 낫습니다.
false 일 때는 hook/body/caption 을 대충 채워도 됩니다. 어차피 쓰지 않습니다.

# suitable 이 true 일 때만 아래를 지켜서 만드세요

## 사실 취급 원칙
- **여러 기사에 공통으로 나오는 사실**을 우선 쓰세요. 한 기사에만 있는 건 피하세요.
- 기사에 없는 내용은 한 줄도 쓰면 안 됩니다. 배경지식으로 보충하지 마세요.
- 숫자, 기관명, 지역명은 기사에 적힌 그대로.
- **기사 문장을 그대로 옮기지 마세요.** 사실만 뽑아 당신의 문장으로 다시 쓰세요.
- 추정은 추정으로 쓰세요. 기사가 "~로 보인다"면 단정하지 마세요.

## 무엇이 좋은 이슈 카드인가
독자가 궁금한 건 "무슨 일이 있었나"보다 **"왜 그렇게 됐나"** 입니다.
현상만 나열하지 말고 원인과 과정을 짚으세요.
  약함: ["올해 러브버그가", "줄었다"]
  강함: ["러브버그 줄어든 건", "우연이 아니었다"]  ← 그럼 뭘 했는데?

${CAROUSEL_RULES}
${recent}
# 기사들 (같은 이슈를 여러 매체가 보도한 것)

${issue.material}

위 기사들을 바탕으로 판단하고, 적합하면 게시물 1건을 만드세요.`;
}

function localPrompt(account, material, recentLines) {
  const p = account.persona;
  const r = account.source.region;
  const unis = r.universities.map((u) => `${u.name}(${u.area})`).join(', ');
  const recent = recentLines.length
    ? `\n# 최근에 이미 올린 것 (중복 금지)\n${recentLines.map((h) => `- ${h}`).join('\n')}\n`
    : '';

  return `당신은 ${r.gu} 지역 정보 인스타그램 계정 "${account.displayName}"의 캐러셀을 만듭니다.

# 화자
${p.who}

# 말투
${p.voice}

# 절대 하지 말 것
${p.avoid}

# 지역 배경
자치구: ${r.gu}
주요 지역: ${r.landmarks.join(', ')}
관내 대학: ${unis}

# ★ 가장 중요한 규칙
아래 [원본 자료]에 **실제로 적혀 있는 사실만** 사용하세요.
- 날짜, 장소, 대상, 비용은 자료에 있는 그대로만 쓰고 추측하지 마세요.
- 자료에 없는 정보는 meta 와 body 에서 통째로 빼세요. 빈칸을 지어내면 안 됩니다.
- 자료가 부실하면 장수를 줄이세요. 채우려고 지어내면 안 됩니다.

# 1장 (hook)
- 2~3줄. 각 줄 공백 포함 **${LOCAL_HOOK_MAX}자 이내**.
- 행사명을 그대로 옮기지 마세요. 사람들이 궁금해할 각도로 다시 쓰세요.
  나쁜 예: ["2026 성북구 가을", "문화예술축제 개최"]
  좋은 예: ["안암 한복판에서", "이번 주말 무료로"]
- 무료인지, 주말인지, 걸어갈 수 있는지 — 대학생이 실제로 따지는 것부터 앞세우세요.

# 2장부터 (body)
- 2~3장. 각 장 2~3줄, 각 줄 **${BODY_MAX}자 이내**.
- 한 장에 한 가지만. 무엇을 하는지 / 언제 가면 좋은지 / 알아둘 점 순서가 무난합니다.

# 독자
${r.gu} 주민과 관내 대학생입니다.
${recent}
# 원본 자료
${material}

위 자료를 바탕으로 게시물 1건을 만드세요.`;
}

/* ── API 호출 ────────────────────────────────────────── */

/**
 * 구글이 키 형식을 바꾸는 중입니다.
 *   AIza...  = Standard key (구형). 2026년 9월부터 거부됩니다.
 *   AQ.Ab... = Authorization key (신형). AI Studio 신규 발급분은 전부 이쪽입니다.
 *
 * 공식 문서는 x-goog-api-key 헤더를 안내하고, 신형 키는 헤더 방식이 안전합니다.
 * 다만 계정에 따라 한쪽만 통하는 사례가 보고돼 있어 두 방식을 순서대로 시도합니다.
 *
 * ※ 헤더와 쿼리를 동시에 보내면 "Multiple authentication credentials received" 로
 *   거부되므로, 반드시 둘 중 하나만 써야 합니다.
 */
const AUTH_MODES = ['header', 'query'];
let activeAuthMode = null;

function buildRequest(model, key, body, mode) {
  const headers = { 'Content-Type': 'application/json' };
  let url = `${API_BASE}/${model}:generateContent`;

  if (mode === 'header') headers['x-goog-api-key'] = key;
  else url += `?key=${encodeURIComponent(key)}`;

  return { url, init: { method: 'POST', headers, body: JSON.stringify(body) } };
}

/** 모델 하나로 호출. 일시적 오류는 재시도하고, 모델 자체가 없으면 표시해서 올립니다. */
async function callModel(model, key, body, authMode) {
  const { url, init } = buildRequest(model, key, body, authMode);
  let lastErr;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, init);

      // 인증 방식이 이 키와 안 맞음 → 다른 방식으로 다시 시도해볼 신호
      if (res.status === 401) {
        throw Object.assign(
          new Error(`${authMode} 방식 인증 거부: ${(await res.text()).slice(0, 200)}`),
          { authRejected: true }
        );
      }
      // 모델이 없거나 이 키로 접근할 수 없음 → 재시도 말고 다음 후보로
      if (res.status === 404 || res.status === 403) {
        throw Object.assign(new Error(`${model}: ${res.status}`), { modelUnavailable: true });
      }
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      if (!res.ok) {
        const text = (await res.text()).slice(0, 300);
        // 잘못된 모델명이 400 으로 오는 경우도 있습니다
        if (/model/i.test(text) && /not found|not supported|unsupported/i.test(text)) {
          throw Object.assign(new Error(`${model}: ${text}`), { modelUnavailable: true });
        }
        throw Object.assign(new Error(`Gemini ${res.status}: ${text}`), { fatal: true });
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Gemini 응답이 비었습니다: ' + JSON.stringify(data).slice(0, 300));
      return JSON.parse(text);
    } catch (err) {
      if (err.fatal || err.modelUnavailable || err.authRejected) throw err;
      lastErr = err;
      if (attempt < 3) {
        const wait = attempt * 4000;
        console.log(`  ↻ Gemini 재시도 ${attempt}/3 (${wait / 1000}초 후) — ${err.message}`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

async function callGemini(prompt, schema) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY 가 없습니다. GitHub Secrets에 추가하세요.');

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 1.0,
      topP: 0.95,
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  };

  // 지난번에 성공한 모델이 있으면 그것부터
  const order = activeModel
    ? [activeModel, ...MODEL_CANDIDATES.filter((m) => m !== activeModel)]
    : MODEL_CANDIDATES;

  // 지난번에 통한 인증 방식이 있으면 그것부터
  const modes = activeAuthMode
    ? [activeAuthMode, ...AUTH_MODES.filter((m) => m !== activeAuthMode)]
    : AUTH_MODES;

  const tried = [];
  const authErrors = [];

  for (const mode of modes) {
    for (const model of order) {
      try {
        const result = await callModel(model, key, body, mode);
        if (activeModel !== model || activeAuthMode !== mode) {
          console.log(`  · Gemini 모델: ${model} (인증: ${mode})`);
          activeModel = model;
          activeAuthMode = mode;
        }
        return result;
      } catch (err) {
        if (err.authRejected) {
          // 이 인증 방식은 이 키에 안 맞습니다. 모델을 바꿔봐야 소용없으니 방식을 바꿉니다.
          authErrors.push(err.message);
          console.log(`  · ${mode} 인증 방식이 거부됨 — 다른 방식으로 시도합니다`);
          break;
        }
        if (!err.modelUnavailable) throw err;
        tried.push(model);
        console.log(`  · ${model} 사용 불가 — 다음 후보로 넘어갑니다`);
      }
    }
  }

  if (authErrors.length) {
    throw new Error(
      'Gemini 인증에 실패했습니다. 헤더/쿼리 두 방식 모두 거부됐습니다.\n' +
        `상세: ${authErrors.join(' | ')}\n` +
        'GEMINI_API_KEY 값에 공백이 섞였는지 확인하고, 그래도 안 되면 ' +
        'AI Studio 에서 키를 새로 발급해 보세요.'
    );
  }

  throw new Error(
    `사용 가능한 Gemini 모델이 없습니다. 시도한 모델: ${[...new Set(tried)].join(', ')}\n` +
      'https://ai.google.dev/gemini-api/docs/models 에서 현재 모델명을 확인하고 ' +
      'GitHub Variables 의 GEMINI_MODEL 에 넣으세요.'
  );
}

/* ── 후처리 ──────────────────────────────────────────── */

/**
 * 모델이 규칙을 어기고 긴 줄을 뱉는 경우가 있습니다.
 * 렌더러가 글씨를 줄여서 처리하긴 하지만, 너무 길면 썸네일이 죽으므로 손봅니다.
 */
function tidyLines(lines, maxLen) {
  const out = [];
  for (const raw of Array.isArray(lines) ? lines : []) {
    let line = String(raw ?? '').trim().replace(/[.]+$/, '');
    if (!line) continue;

    while (line.length > maxLen) {
      const cut = line.lastIndexOf(' ', maxLen);
      if (cut <= 0) break;
      out.push(line.slice(0, cut));
      line = line.slice(cut + 1);
    }
    out.push(line);
  }
  return out.slice(0, 4);
}

function toSlide(raw, kind, maxLen) {
  const lines = tidyLines(raw?.lines, maxLen);
  if (!lines.length) return null;

  const e = Number.isInteger(raw?.emphasizeLine) ? raw.emphasizeLine : -1;
  return {
    kind, // 'hook' | 'body'
    lines,
    // 줄을 손보면서 인덱스가 밀렸을 수 있으니 범위를 넘으면 강조를 끕니다
    emphasizeLine: e >= 0 && e < lines.length ? e : -1,
  };
}

function pickHashtags(account) {
  const { fixed = [], pool = [], poolSize = 5 } = account.hashtags || {};
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return [...fixed, ...shuffled.slice(0, poolSize)];
}

/**
 * @param {object} account 계정 설정
 * @param {object|string|null} material
 *   - local : 행사 정보 문자열
 *   - facts : collectFactArticle() 결과 객체 ({ title, material, url })
 *   - 그 외 : null
 * @param {string[]} recentLines 최근 발행 문구 (중복 회피용)
 * @returns {Promise<{slides: Array, caption: string, hashtags: string[], sourceNote?: string}>}
 */
export async function generateContent(account, material, recentLines = []) {
  const type = account.source?.type ?? 'ai';
  const isLocal = type === 'local';
  const isFacts = type === 'facts';
  const isNews = type === 'news';

  let result;
  if (isLocal) result = await callGemini(localPrompt(account, material, recentLines), LOCAL_SCHEMA);
  else if (isFacts)
    result = await callGemini(factsPrompt(account, material, recentLines), FACTS_SCHEMA);
  else if (isNews)
    result = await callGemini(newsPrompt(account, material, recentLines), NEWS_SCHEMA);
  else result = await callGemini(humorPrompt(account, recentLines), HUMOR_SCHEMA);

  // 필터를 통과했더라도 AI 가 부적합하다고 보면 그날은 발행하지 않습니다.
  if (isNews && result.suitable === false) {
    return { skip: true, reason: result.rejectReason || '(사유 미기재)' };
  }

  const hook = toSlide(result.hook, 'hook', isLocal ? LOCAL_HOOK_MAX : HOOK_MAX);
  if (!hook) throw new Error('1장(후킹) 문구 생성에 실패했습니다');

  const body = (Array.isArray(result.body) ? result.body : [])
    .map((s) => toSlide(s, 'body', BODY_MAX))
    .filter(Boolean);

  // 인스타 캐러셀 상한은 10장입니다.
  const slides = [hook, ...body].slice(0, 10);

  return {
    tag: result.tag,
    meta: result.meta,
    slides,
    caption: result.caption,
    // 어디서 온 내용인지 캡션에 반드시 남깁니다.
    // AI 에게 맡기면 빠뜨리므로 코드에서 붙입니다.
    sourceNote: isFacts
      ? `출처: 위키백과 「${material.title}」`
      : isNews
        ? `출처: ${material.outlets.join(', ')} 보도 종합`
        : undefined,
    hashtags: pickHashtags(account),
  };
}
