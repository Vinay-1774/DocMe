import React from 'react';
import './MarkdownView.css';

/**
 * Safely parses basic Markdown (headings, lists, bold, code blocks) without innerHTML.
 */
export default function MarkdownView({ content }) {
  if (!content) return null;

  // Split by code blocks first
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="markdown-content">
      {parts.map((part, index) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const lines = part.slice(3, -3).trim().split('\n');
          // Optional language line
          const firstLine = lines[0]?.trim();
          const isLang = /^[a-zA-Z0-9_-]+$/.test(firstLine);
          const code = isLang ? lines.slice(1).join('\n') : lines.join('\n');
          return (
            <pre key={index} className="markdown-code-block">
              <code>{code}</code>
            </pre>
          );
        }

        // Process standard markdown lines
        const lines = part.split('\n');
        const elements = [];
        let currentList = null; // { type: 'ul' | 'ol', items: [] }

        const flushList = () => {
          if (currentList) {
            const ListTag = currentList.type;
            elements.push(
              <ListTag key={`list-${elements.length}`} className={`markdown-${currentList.type}`}>
                {currentList.items.map((it, i) => (
                  <li key={i}>{renderInline(it)}</li>
                ))}
              </ListTag>
            );
            currentList = null;
          }
        };

        lines.forEach((line, lineIdx) => {
          const trimmed = line.trim();

          if (!trimmed) {
            flushList();
            return;
          }

          // Headings
          if (trimmed.startsWith('### ')) {
            flushList();
            elements.push(
              <h3 key={`h3-${lineIdx}`} className="markdown-heading-3">
                {renderInline(trimmed.slice(4))}
              </h3>
            );
            return;
          }
          if (trimmed.startsWith('## ')) {
            flushList();
            elements.push(
              <h2 key={`h2-${lineIdx}`} className="markdown-heading-2">
                {renderInline(trimmed.slice(3))}
              </h2>
            );
            return;
          }
          if (trimmed.startsWith('# ')) {
            flushList();
            elements.push(
              <h1 key={`h1-${lineIdx}`} className="markdown-heading-1">
                {renderInline(trimmed.slice(2))}
              </h1>
            );
            return;
          }

          // Bullet List (- or *)
          if (/^[-*]\s+/.test(trimmed)) {
            if (!currentList || currentList.type !== 'ul') {
              flushList();
              currentList = { type: 'ul', items: [] };
            }
            currentList.items.push(trimmed.replace(/^[-*]\s+/, ''));
            return;
          }

          // Numbered List (1. item)
          if (/^\d+\.\s+/.test(trimmed)) {
            if (!currentList || currentList.type !== 'ol') {
              flushList();
              currentList = { type: 'ol', items: [] };
            }
            currentList.items.push(trimmed.replace(/^\d+\.\s+/, ''));
            return;
          }

          // Regular paragraph line
          flushList();
          elements.push(
            <p key={`p-${lineIdx}`}>
              {renderInline(trimmed)}
            </p>
          );
        });

        flushList();
        return <React.Fragment key={index}>{elements}</React.Fragment>;
      })}
    </div>
  );
}

function renderInline(text) {
  if (!text) return '';
  // Split inline code `code`
  const codeParts = text.split(/(`[^`]+`)/g);

  return codeParts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={i} className="inline-code">
          {part.slice(1, -1)}
        </code>
      );
    }

    // Bold **text**
    const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
    return boldParts.map((bPart, bIdx) => {
      if (bPart.startsWith('**') && bPart.endsWith('**') && bPart.length > 4) {
        return <strong key={`${i}-${bIdx}`}>{bPart.slice(2, -2)}</strong>;
      }
      return bPart;
    });
  });
}
