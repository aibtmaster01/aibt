/**
 * 문제 지문/보기/해설에서 HTML(<br>, <b> 등)과 LaTeX($...$, $$...$$, \(...\))를
 * 화면에 반영하기 위한 유틸
 */
import katex from 'katex';
import DOMPurify from 'dompurify';

const PREFIX = '\u200B\u200B'; // zero-width spaces to avoid collision
const DISP = `${PREFIX}KD`;
const INL = `${PREFIX}KI`;

function renderLatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex.trim(), {
      throwOnError: false,
      displayMode,
      strict: false, // 한글 등 유니코드가 수식 안에 섞여도 경고 비활성화
    });
  } catch {
    return `<span class="katex-error">${escapeHtml(tex)}</span>`;
  }
}

function escapeHtml(s: string): string {
  const div = { innerHTML: '', textContent: s };
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 문자열 내 LaTeX와 허용된 HTML을 반영한 안전한 HTML 문자열로 변환
 * - $$...$$ : 디스플레이 수식
 * - $...$ : 인라인 수식
 * - \(...\) : 인라인 수식
 * - \[...\] : 디스플레이 수식
 * - <br>, <b>, <i>, <sub>, <sup> 등 허용 태그 유지
 */
export function richTextToHtml(text: string): string {
  if (!text || typeof text !== 'string') return '';
  let out = text
    .replace(/\\n/g, '<br>')  // literal \n (backslash+n) → <br>
    .replace(/\n/g, '<br>');  // actual newline → <br>
  const displayBlocks: string[] = [];
  const inlineBlocks: string[] = [];

  // 1) $$...$$ (display)
  out = out.replace(/\$\$([\s\S]*?)\$\$/g, (_, tex) => {
    const i = displayBlocks.length;
    displayBlocks.push(tex);
    return `${DISP}${i}${PREFIX}`;
  });
  // 2) \[...\] (display)
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, (_, tex) => {
    const i = displayBlocks.length;
    displayBlocks.push(tex);
    return `${DISP}${i}${PREFIX}`;
  });
  // 3) $...$ (inline, not $$)
  out = out.replace(/\$([^\$\n]+?)\$/g, (_, tex) => {
    const i = inlineBlocks.length;
    inlineBlocks.push(tex);
    return `${INL}${i}${PREFIX}`;
  });
  // 4) \(...\) (inline)
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_, tex) => {
    const i = inlineBlocks.length;
    inlineBlocks.push(tex);
    return `${INL}${i}${PREFIX}`;
  });

  // placeholders → KaTeX HTML
  displayBlocks.forEach((tex, i) => {
    out = out.replace(`${DISP}${i}${PREFIX}`, renderLatex(tex, true));
  });
  inlineBlocks.forEach((tex, i) => {
    out = out.replace(`${INL}${i}${PREFIX}`, renderLatex(tex, false));
  });

  return DOMPurify.sanitize(out, {
    ALLOWED_TAGS: [
      'br', 'b', 'i', 'em', 'strong', 'sub', 'sup', 'span', 'p', 'div', 'ul', 'ol', 'li',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
      'pre', 'code', 'h1', 'h2', 'h3',
    ],
    ALLOWED_ATTR: ['class', 'style', 'href', 'aria-hidden', 'data-id'],
  });
}
