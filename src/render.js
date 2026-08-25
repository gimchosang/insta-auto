/**
 * HTML 템플릿 → 1080x1080 JPEG 렌더링 (캐러셀 여러 장)
 *
 * 인스타그램 이미지 발행은 JPEG 만 받습니다 (PNG 불가).
 * 렌더된 파일은 docs/img/ 아래에 저장되고 GitHub Pages 로 공개됩니다.
 */

import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const SIZE = 1080;

/**
 * 썸네일용 한글 디스플레이 폰트.
 * 본문 폰트(Pretendard 등)를 쓰면 피드에서 존재감이 없어서,
 * 굵고 동글한 디스플레이 폰트만 씁니다.
 */
const FONTS = {
  jua: {
    family: "'Jua', sans-serif",
    url: 'https://fonts.googleapis.com/css2?family=Jua&display=swap',
  },
  blackhan: {
    family: "'Black Han Sans', sans-serif",
    url: 'https://fonts.googleapis.com/css2?family=Black+Han+Sans&display=swap',
  },
  dohyeon: {
    family: "'Do Hyeon', sans-serif",
    url: 'https://fonts.googleapis.com/css2?family=Do+Hyeon&display=swap',
  },
  gaegu: {
    family: "'Gaegu', cursive",
    url: 'https://fonts.googleapis.com/css2?family=Gaegu:wght@700&display=swap',
  },
};

const DEFAULT_STYLE = {
  bg: '#7FE8C4',
  fg: '#FF6FA5',
  stroke: '#FFFFFF',
  hit: '#FFFFFF',
  font: 'jua',
};

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 줄 배열 → HTML.
 * 줄바꿈이 리듬을 만들기 때문에 자동 줄바꿈에 맡기지 않고 줄마다 요소를 만듭니다.
 */
function buildLines(lines, emphasizeIndex) {
  return (lines ?? [])
    .map((text, i) => {
      const cls = i === emphasizeIndex ? 'ln hit' : 'ln';
      return `<div class="${cls}">${escapeHtml(text)}</div>`;
    })
    .join('\n    ');
}

/** 1장 하단의 핵심 정보 — 표가 아니라 큰 글자 두세 줄 */
function buildMetaRows(meta = []) {
  return (meta ?? [])
    .filter((r) => r && r.key && r.value)
    .slice(0, 3)
    .map(
      (r) =>
        `<div class="row"><div class="key">${escapeHtml(r.key)}</div>` +
        `<div class="val">${escapeHtml(r.value)}</div></div>`
    )
    .join('\n    ');
}

/** 몇 장 중 몇 번째인지 알려주는 점 */
function buildDots(total, current) {
  return Array.from({ length: total }, (_, i) => `<i class="${i === current ? 'on' : ''}"></i>`).join('');
}

function fillTemplate(html, vars) {
  return html.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

/**
 * 캐러셀 전체를 렌더링합니다. 브라우저는 한 번만 띄웁니다.
 *
 * @param {object} account 계정 설정
 * @param {object} content generate.js 결과 ({ slides, tag, meta, ... })
 * @param {string} dateStr YYYY-MM-DD
 * @param {string} rootDir 프로젝트 루트
 * @returns {Promise<Array<{absPath: string, relPath: string}>>} 슬라이드 순서대로
 */
export async function renderSlides(account, content, dateStr, rootDir) {
  const style = { ...DEFAULT_STYLE, ...(account.style ?? {}) };
  const font = FONTS[style.font] ?? FONTS.jua;
  const handle = account.handle || `@${account.id.replace(/-/g, '_')}`;

  // 템플릿 파일을 미리 읽어둡니다 (같은 걸 여러 번 읽지 않도록)
  const cache = new Map();
  const readTemplate = async (name) => {
    if (!cache.has(name)) {
      cache.set(name, await fs.readFile(path.join(rootDir, 'templates', `${name}.html`), 'utf8'));
    }
    return cache.get(name);
  };

  const outDir = path.join(rootDir, 'docs', 'img', account.id);
  await fs.mkdir(outDir, { recursive: true });

  // 미리보기에서 같은 날 여러 번 뽑을 때 덮어쓰지 않도록 접미사를 붙입니다
  const suffix = process.env.FILE_SUFFIX ? `-r${process.env.FILE_SUFFIX}` : '';
  const total = content.slides.length;
  const results = [];

  const browser = await chromium.launch({ args: ['--font-render-hinting=none'] });
  try {
    const page = await browser.newPage({
      viewport: { width: SIZE, height: SIZE },
      deviceScaleFactor: 1,
    });

    for (let i = 0; i < total; i++) {
      const slide = content.slides[i];
      // 1장은 계정 고유의 후킹 템플릿, 2장부터는 공통 본문 템플릿
      const templateName = slide.kind === 'hook' ? account.template : 'body';
      const raw = await readTemplate(templateName);

      const html = fillTemplate(raw, {
        bg: style.bg,
        fg: style.fg,
        stroke: style.stroke,
        hit: style.hit,
        fontFamily: font.family,
        fontUrl: font.url,
        lines: buildLines(slide.lines, slide.emphasizeLine),
        tag: escapeHtml(content.tag),
        metaRows: buildMetaRows(content.meta),
        handle: escapeHtml(handle),
        slideNo: String(i + 1),
        dots: buildDots(total, i),
      });

      await page.setContent(html, { waitUntil: 'networkidle', timeout: 30000 });
      await page
        .waitForFunction(() => window.__READY__ === true, { timeout: 15000 })
        .catch(() => console.log(`  ⚠ ${i + 1}장 폰트 맞춤 시간 초과 — 그대로 렌더합니다`));

      const fileName = `${dateStr}${suffix}-${i + 1}.jpg`;
      const absPath = path.join(outDir, fileName);

      await page.screenshot({
        path: absPath,
        type: 'jpeg',
        quality: 92,
        clip: { x: 0, y: 0, width: SIZE, height: SIZE },
      });

      results.push({ absPath, relPath: `img/${account.id}/${fileName}` });
    }
  } finally {
    await browser.close();
  }

  return results;
}

/**
 * 렌더된 이미지의 공개 URL.
 * GitHub Pages 가 docs/ 폴더를 서빙하도록 설정되어 있어야 합니다.
 */
export function publicUrl(relPath) {
  const base = process.env.PAGES_BASE_URL;
  if (!base) throw new Error('PAGES_BASE_URL 이 없습니다 (예: https://아이디.github.io/insta-auto)');
  return `${base.replace(/\/$/, '')}/${relPath}`;
}
