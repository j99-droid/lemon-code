// Chat view drawing: Markdown for what Claude says, helper bubbles with their icon, and question cards with
// their option previews. Loaded before app.js, which decides what happens when you click.
// Text from a transcript is escaped before any tag is added, so nothing in it can inject HTML.
(function (root) {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Enough Markdown for Claude's replies: code blocks, inline code, bold, headings, lists, tables, links.
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  function markdown(text) {
    return text.split(/```[^\n]*\n?([\s\S]*?)```/g).map((part, i) => (i % 2
      ? `<pre><code>${esc(part.replace(/\n$/, ''))}</code></pre>`
      : markdownBlocks(part))).join('');
  }
  function markdownBlocks(text) {
    const html = [];
    let open = null; // 'ul', 'ol' or 'table' while inside one
    const close = () => { if (open) html.push(`</${open}>`); open = null; };
    const enter = (tag) => { if (open !== tag) { close(); open = tag; html.push(`<${tag}>`); } };
    for (const line of text.split('\n')) {
      if (!line.trim()) continue; // blank lines between list items shouldn't restart the numbering
      const item = line.match(/^\s*(?:([-*])|\d+[.)])\s+(.*)/);
      const heading = line.match(/^#{1,4}\s+(.*)/);
      if (line.trim().startsWith('|')) {
        enter('table');
        if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue; // the |---|---| row under the header
        const cells = line.trim().replace(/^\||\|$/g, '').split('|');
        html.push(`<tr>${cells.map((c) => `<td>${inline(c.trim())}</td>`).join('')}</tr>`);
      } else if (item) {
        enter(item[1] ? 'ul' : 'ol');
        html.push(`<li>${inline(item[2])}</li>`);
      } else {
        close();
        html.push(heading ? `<h4>${inline(heading[1])}</h4>` : `<p>${inline(line)}</p>`);
      }
    }
    close();
    return html.join('');
  }

  // A preview is HTML (shown live, in a sandbox), code (shown as code), or Markdown. Claude writes these in
  // option.preview, and the terminal would show them as plain text.
  const HTML_START = /^\s*(<!doctype|<html|<head|<body|<style|<script|<div|<section|<main|<header|<footer|<nav|<form|<table|<ul|<ol|<p[\s>]|<h[1-6]|<span|<button|<svg|<img|<input|<label)/i;
  const CODE_HINT = /\b(function|const|let|var|return)\b|=>/;
  function previewHtml(text) {
    const fenced = text.match(/^\s*```html?\s*\n([\s\S]*?)```\s*$/i);
    if (fenced || HTML_START.test(text)) {
      const doc = fenced ? fenced[1] : text;
      // The document goes in on load (see mountPreviews), so it never touches the page's own HTML.
      return `<iframe class="q-frame" src="preview-frame.html" sandbox="allow-scripts" title="Preview" data-html="${esc(doc)}"></iframe>`;
    }
    if (!text.includes('```') && CODE_HINT.test(text) && !/\n\s*[#*-]\s/.test(text)) {
      return `<pre><code>${esc(text)}</code></pre>`;
    }
    return markdown(text);
  }

  // Each preview frame gets its document once it has loaded. The frame page passes it on to its own sandboxed frame.
  function mountPreviews(container) {
    container.querySelectorAll('iframe[data-html]').forEach((frame) => {
      frame.addEventListener('load', () => frame.contentWindow.postMessage(frame.dataset.html, '*'));
    });
  }

  // Colour per helper, from its key, so each one's bubbles stand apart in the group.
  const hueOf = (key) => [...String(key)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % 360;
  const clipText = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function helperHtml(m) {
    const { name, icon, key } = m.helper;
    const style = `--hue:${hueOf(key)}`;
    if (m.kind === 'start' || m.kind === 'done') {
      const what = m.kind === 'done' ? 'finished' : `started${m.text ? `: ${clipText(m.text, 90)}` : ''}`;
      return `<div class="msg note helper-event" style="${style}">${esc(icon)} ${esc(name)} ${esc(what)}</div>`;
    }
    const avatar = `<span class="avatar" title="${esc(name)}">${esc(icon)}</span>`;
    if (m.kind === 'tool') {
      return `<div class="helper-row activity" style="${style}">${avatar}<div class="msg helper-activity">${esc(m.text)}</div></div>`;
    }
    return `<div class="helper-row" style="${style}">${avatar}<div class="msg helper">`
      + `<div class="who">${esc(name)}</div><div class="rich">${markdown(m.text)}</div></div></div>`;
  }

  // One question card. Options carry their preview in data-preview, and the card starts inactive until the
  // dialog is open in Claude (live), so an old card can't send answers to a dialog that's gone.
  function questionCardHtml(m, live) {
    const blocks = m.questions.map((q, qi) => {
      const options = q.options.map((o, oi) => `<button type="button" class="q-opt" data-o="${oi}" data-preview="${esc(o.preview || '')}">`
        + `<span class="q-mark"></span><span class="q-label"><b>${esc(o.label)}</b>`
        + `${o.description && o.description !== o.label ? `<small>${esc(o.description)}</small>` : ''}</span></button>`).join('');
      // With previews the dialog has no "Type something" row, so the card can't offer one either.
      const other = q.options.some((o) => o.preview) ? ''
        : `<button type="button" class="q-opt q-other" data-o="${q.options.length}">`
          + '<span class="q-mark"></span><span class="q-label"><b>Type something</b></span></button>';
      return `<div class="q-block" data-q="${qi}" data-multi="${q.multiSelect ? 1 : 0}">`
        + `${q.header ? `<span class="q-header">${esc(q.header)}</span>` : ''}`
        + `<div class="q-question">${esc(q.question)}</div>`
        + `<div class="q-hint">${q.multiSelect ? 'Pick any that apply' : 'Pick one'}</div>`
        + `<div class="q-options">${options}${other}</div>`
        + '<input type="text" class="q-own" placeholder="Your answer" maxlength="500" hidden>'
        + '<div class="q-preview" hidden></div></div>';
    }).join('');
    return `<div class="q-card${live ? ' live' : ''}" data-ask="${esc(m.toolUseId)}">${blocks}`
      + '<div class="q-foot"><span class="q-state"></span>'
      + '<button type="button" class="btn primary q-send" disabled>Send answer</button></div></div>';
  }

  function bubbleHtml(m, live) {
    if (m.role === 'helper') return helperHtml(m);
    if (m.role === 'note') return `<div class="msg note">${esc(m.text)}</div>`;
    if (m.role === 'user') return `<div class="msg user">${esc(m.text)}</div>`;
    if (m.ask && m.questions && m.toolUseId) return questionCardHtml(m, live);
    return `<div class="msg assistant${m.ask ? ' question' : ''}"><div class="rich">${markdown(m.text)}</div></div>`;
  }

  root.ChatView = { esc, markdown, previewHtml, bubbleHtml, mountPreviews, questionCardHtml };
})(window);
