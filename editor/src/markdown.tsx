import React from 'react';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const inline = (s: string): string =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

export const MiniMarkdown: React.FC<{ text: string }> = ({ text }) => {
  const lines = (text ?? '').split(/\r?\n/);
  const html: string[] = [];
  let listOpen = false;
  let codeOpen = false;
  let tableRows: string[][] = [];
  const flushList = () => {
    if (listOpen) {
      html.push('</ul>');
      listOpen = false;
    }
  };
  const flushTable = () => {
    if (!tableRows.length) return;
    const [head, ...body] = tableRows;
    html.push(
      `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body
        .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`,
    );
    tableRows = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^```/.test(line.trim())) {
      if (codeOpen) {
        html.push('</pre>');
        codeOpen = false;
      } else {
        flushList();
        flushTable();
        html.push('<pre>');
        codeOpen = true;
      }
      continue;
    }
    if (codeOpen) {
      html.push(`${esc(raw)}\n`);
      continue;
    }
    if (/^\|(.+)\|$/.test(line.trim())) {
      const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
      tableRows.push(cells);
      continue;
    }
    flushTable();
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      const l = h[1].length;
      html.push(`<h${l + 1}>${inline(h[2])}</h${l + 1}>`);
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (!listOpen) {
        html.push('<ul>');
        listOpen = true;
      }
      html.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    flushList();
    if (!line.trim()) continue;
    html.push(`<p>${inline(line)}</p>`);
  }
  flushList();
  flushTable();
  if (codeOpen) html.push('</pre>');
  return <div className="md-body" dangerouslySetInnerHTML={{ __html: html.join('') }} />;
};
