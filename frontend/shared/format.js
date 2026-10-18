/**
 * shared/format.js
 * Safe, sanitized Markdown renderer and response structuring utility.
 * Converts headings, bullet lists, numbered lists, code blocks, bold, italics,
 * and paragraphs into accessible HTML without raw innerHTML injection.
 */

/**
 * Escapes HTML characters to prevent XSS injection.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Validates basic RFC5322-compatible email format.
 * @param {string} str
 * @returns {boolean}
 */
export function isValidEmail(str) {
  if (!str || typeof str !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

/**
 * Converts markdown text into structured, sanitized HTML.
 * Organizes content into readable paragraphs, headings, bullet lists,
 * and code blocks safely without risking raw unescaped HTML injection.
 * @param {string} text
 * @returns {string}
 */
export function renderSafeMarkdown(text) {
  if (!text || typeof text !== 'string' || !text.trim()) return '';

  const raw = text.trim();

  // 1. Extract and preserve fenced code blocks safely
  const codeBlocks = [];
  const placeholderPrefix = '___CODE_BLOCK_PLACEHOLDER_';
  const textWithoutCode = raw.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    const id = codeBlocks.length;
    const escapedCode = escapeHtml(code.trimEnd());
    const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : '';
    codeBlocks.push(`<pre class="code-block"><code${langAttr}>${escapedCode}</code></pre>`);
    return `${placeholderPrefix}${id}___`;
  });

  // 2. Escape all remaining text to eliminate XSS
  const escapedText = escapeHtml(textWithoutCode);

  // 3. Process block elements line-by-line
  const lines = escapedText.split('\n');
  const processedBlocks = [];
  let currentList = null; // { type: 'ul' | 'ol', items: [] }

  const flushList = () => {
    if (currentList) {
      const tag = currentList.type;
      const itemsHtml = currentList.items.map((it) => `<li>${it}</li>`).join('');
      processedBlocks.push(`<${tag} class="markdown-${tag}">${itemsHtml}</${tag}>`);
      currentList = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check for code block placeholder
    const codeMatch = trimmed.match(new RegExp(`^${placeholderPrefix}(\\d+)___$`));
    if (codeMatch) {
      flushList();
      const codeIndex = parseInt(codeMatch[1], 10);
      processedBlocks.push(codeBlocks[codeIndex] || '');
      continue;
    }

    // Empty line separates blocks
    if (!trimmed) {
      flushList();
      continue;
    }

    // Headings (###, ##, #)
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushList();
      const level = Math.min(headingMatch[1].length + 2, 5); // map # -> h3, ## -> h4, ### -> h5
      processedBlocks.push(`<h${level} class="markdown-heading">${formatInline(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Unordered List (- item or * item)
    const ulMatch = line.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      if (!currentList || currentList.type !== 'ul') {
        flushList();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(formatInline(ulMatch[1]));
      continue;
    }

    // Ordered List (1. item)
    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (!currentList || currentList.type !== 'ol') {
        flushList();
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(formatInline(olMatch[1]));
      continue;
    }

    // Regular text line
    flushList();
    processedBlocks.push(`<p class="markdown-p">${formatInline(trimmed)}</p>`);
  }

  flushList();

  return processedBlocks.join('');
}

/**
 * Formats inline Markdown elements (bold, italics, inline code).
 * Assumes text has already been HTML-escaped.
 * @param {string} escapedText
 * @returns {string}
 */
function formatInline(escapedText) {
  return escapedText
    // Inline code `code`
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    // Bold **text** or __text__
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    // Italics *text* or _text_
    .replace(/(^|[^\*])\*([^\*]+)\*([^\*]|$)/g, '$1<em>$2</em>$3')
    .replace(/(^|[^_])_([^_]+)_([^_]|$)/g, '$1<em>$2</em>$3');
}
