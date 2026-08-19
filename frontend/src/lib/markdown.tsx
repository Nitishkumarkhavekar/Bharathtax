// Tiny markdown renderer for assistant replies. Handles only what
// bharattax-rag actually emits: bold, inline code, bullet/numbered lists,
// section headings, blockquotes, autolinks, and inline citations [1].
// Avoid adding a heavy markdown dep just for these.

import { ReactNode } from "react";

// Private-use sentinels flag an AI-edited span for flash-highlight. They never
// occur in legal text; injectHighlight() wraps the changed region with them
// (re-balanced per line so each block stays valid) and renderInline turns a pair
// into a <mark>. Stray/unpaired sentinels are stripped so they never render.
export const HL_OPEN = "";
export const HL_CLOSE = "";

export function injectHighlight(content: string, start: number, end: number): string {
  if (
    content == null || start == null || end == null ||
    start < 0 || end > content.length || start >= end
  ) {
    return content;
  }
  const before = content.slice(0, start);
  const mid = content.slice(start, end).replace(/\n/g, `${HL_CLOSE}\n${HL_OPEN}`);
  const after = content.slice(end);
  return `${before}${HL_OPEN}${mid}${HL_CLOSE}${after}`;
}

const _stripHl = (s: string) => s.replace(/[]/g, "");

function renderInline(text: string): ReactNode[] {
  // Order matters: **bold** must be tried BEFORE single-asterisk *italic* so
  // `**foo**` doesn't get eaten as an italic. The `(?<!\*)` / `(?!\*)`
  // guards on the italic alternative refuse matches that abut another `*`,
  // which also prevents catching the outer asterisks of `**bold**` again.
  const parts: ReactNode[] = [];
  let i = 0;
  const re =
    /([^\n]*|\*\*[^*\n]+\*\*|(?<!\*)\*(?!\*)[^*\n]+?(?<!\*)\*(?!\*)|_[^_\n]+?_|`[^`\n]+`|\{\{cite:[^}]+\}\}|\[\d+\]|https?:\/\/[^\s)]+|\b§\s?\d+[A-Z]*(?:\(\d+\))?)/g;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > i) parts.push(_stripHl(text.slice(i, match.index)));
    const token = match[0];
    if (token.charCodeAt(0) === 0xe000) {
      parts.push(
        <mark key={`hl${key++}`} className="ai-flash rounded px-0.5 bg-emerald-200/70 text-inherit">
          {renderInline(token.slice(1, -1))}
        </mark>,
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(
        <strong key={`b${key++}`} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (
      (token.startsWith("*") && token.endsWith("*")) ||
      (token.startsWith("_") && token.endsWith("_"))
    ) {
      // Single-asterisk or underscore italic. Strip the surrounding markers
      // and render inside <em>; the outer .prose-appeal em / .md-body em
      // styles handle the actual italicisation.
      parts.push(
        <em key={`i${key++}`}>
          {token.slice(1, -1)}
        </em>,
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <code
          key={`c${key++}`}
          className="px-1.5 py-0.5 rounded bg-slate-100 text-[0.85em] font-mono"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (/^\[\d+\]$/.test(token)) {
      parts.push(
        <span
          key={`r${key++}`}
          className="inline-flex items-center justify-center min-w-[1.4rem] h-5 px-1.5 rounded-full bg-primary/10 text-primary text-[0.72rem] font-semibold align-middle"
        >
          {token.slice(1, -1)}
        </span>,
      );
    } else if (token.startsWith("{{cite:")) {
      // Marker payload is "domain|url"; older/degenerate markers carry just the
      // domain (no "|"), so fall back to the bare domain link in that case.
      const inner = token.slice(7, -2);
      const sep = inner.indexOf("|");
      const domain = sep === -1 ? inner : inner.slice(0, sep);
      const url = sep === -1 ? "" : inner.slice(sep + 1);
      parts.push(
        <a
          key={`cite${key++}`}
          href={url || `https://${domain}`}
          target="_blank"
          rel="noreferrer"
          title={domain}
          className="inline-flex items-center justify-center align-middle mx-0.5 size-[18px] rounded-full ring-1 ring-slate-200 bg-white overflow-hidden no-underline hover:ring-primary/40"
        >
          <img
            src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`}
            alt=""
            className="size-3"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        </a>,
      );
    } else if (/^https?:\/\//.test(token)) {
      parts.push(
        <a
          key={`l${key++}`}
          href={token}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline underline-offset-2 break-all"
        >
          {token}
        </a>,
      );
    } else if (/^§/.test(token)) {
      parts.push(
        <span
          key={`s${key++}`}
          className="font-medium text-slate-700 whitespace-nowrap"
        >
          {token}
        </span>,
      );
    } else {
      parts.push(token);
    }
    i = match.index + token.length;
  }
  if (i < text.length) parts.push(text.slice(i));
  return parts;
}

interface Block {
  type: "p" | "h" | "ul" | "ol" | "quote" | "table" | "code";
  // For p / h / quote: lines is a single line. For ul/ol: list of items.
  // For code: raw code lines (kept verbatim, no inline markdown).
  lines: string[];
  level?: number; // for h
  firstNum?: number; // for ol: the number the model wrote on the first item
  start?: number; // for ol: resolved starting number (continuous across sub-lists)
  // For table: parsed headers + rows + column alignments (from the separator row).
  headers?: string[];
  rows?: string[][];
  aligns?: ("left" | "right" | "center")[];
  // For code: optional language tag from the fence (```python etc.).
  lang?: string;
}

// Rewrites the model's raw text into something the block parser handles well.
// Even with a strict system prompt the model sometimes glues bullets and
// labelled sub-totals onto one line — this rebuilds the structure so the user
// always sees a clean list.
export function normalizeMarkdown(src: string): string {
  let s = src.replace(/\r\n/g, "\n");

  // ---- 0. Strip internal "Automated review notes" blocks that older
  //    answers still carry baked into their persisted content. These
  //    were an internal QA/lint output that briefly leaked into user
  //    responses; the backend no longer emits them, but historical
  //    chat_messages rows still contain the text. Remove:
  //      (a) prepended CRITICAL block:
  //          "> ⚠️ **Read this first — automated review notes for this answer:**"
  //          … "### Automated review notes" … "\n\n---\n\n"
  //      (b) appended block:
  //          "\n\n---\n\n### Automated review notes\n\n…" through end of string.
  //    Case-insensitive; tolerant of minor punctuation drift.
  s = s.replace(
    /^>\s*⚠️?\s*\*\*Read this first[\s\S]*?### Automated review notes[\s\S]*?\n\n---\n\n/i,
    "",
  );
  s = s.replace(
    /(?:\n\n)?---\n+###\s*Automated review notes[\s\S]*$/i,
    "",
  );

  // ---- 1. Inline `•` bullets — promote them to proper markdown bullets.
  //    "foo • bar • baz" -> "foo\n- bar\n- baz"
  //    Also handles a leading "•" at the start of a line.
  s = s.replace(/(\S)\s*•\s+/g, "$1\n- ");
  s = s.replace(/^\s*•\s+/gm, "- ");
  // Same for the OpenAI-ish "·" middle-dot occasionally used as a bullet.
  s = s.replace(/(\S)\s*·\s+(?=\S)/g, "$1\n- ");

  // ---- 2. Common labelled sub-totals get their own line + bold.
  // The model sometimes writes them inline after a colon: "...rebate: Rs 25,000
  // Tax after rebate: Rs 0 Add 4% ...". Split them apart so each lands on its
  // own line. The label list is curated; unmatched text is left as-is.
  const LABELS = [
    "Tax as per slabs",
    "Less Section 87A rebate",
    "Tax after rebate",
    "Add 4% health & education cess",
    "Add health & education cess",
    "Surcharge",
    "Marginal relief",
    "Total income tax payable",
    "Total tax payable",
    "Total income tax",
    "Note",
    "Sources",
  ];
  for (const label of LABELS) {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Allow an optional parenthetical between the label and the colon, e.g.
    // "Less Section 87A rebate (income up to Rs 12,00,000 is fully rebated):"
    const tail = `\\s*(?:\\([^)\\n]{1,160}\\)\\s*)?:`;
    // Insert two newlines before the label if it's stuck after some text on
    // the same line (but not if it's already on its own line).
    const re = new RegExp(`([^\\n])\\s+(${esc}${tail})`, "gi");
    s = s.replace(re, "$1\n\n$2");
    // Bold the label (including any parenthetical + colon) if not already.
    const bre = new RegExp(`(^|\\n)(?!\\*\\*)(${esc}${tail})`, "gi");
    s = s.replace(bre, (_m, p1, p2) => `${p1}**${p2}**`);
  }

  // ---- 3. Collapse 3+ blank lines to a single blank one.
  s = s.replace(/\n{3,}/g, "\n\n");

  return s.trim();
}

function parseBlocks(src: string, skipNormalize = false): Block[] {
  const lines = (skipNormalize ? src : normalizeMarkdown(src)).split("\n");
  const blocks: Block[] = [];
  let buf: string[] = [];
  const flushPara = () => {
    if (buf.length) {
      // Preserve intra-paragraph line breaks (letter address blocks, "To,"
      // headers, signatures) instead of collapsing them into one line.
      blocks.push({ type: "p", lines: buf.map((l) => l.trim()) });
      buf = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    // Fenced code block: ```lang? ... ```. Collected verbatim so ASCII
    // trees / tabular data / anything alignment-sensitive stays intact
    // in a monospaced <pre>. Without this, the closing ``` was rendering
    // as literal text and the inner alignment collapsed in the prose font.
    const fenceOpen = /^\s*```(\S*)\s*$/.exec(ln);
    if (fenceOpen) {
      flushPara();
      const lang = fenceOpen[1] || "";
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // consume the closing fence
      blocks.push({ type: "code", lines: body, lang });
      continue;
    }
    if (!ln.trim()) {
      flushPara();
      i++;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(ln);
    if (h) {
      flushPara();
      blocks.push({ type: "h", lines: [h[2]], level: h[1].length });
      i++;
      continue;
    }
    // Allow leading whitespace so nested blockquotes (`    > ...`, common
    // when the LLM tucks a quote under a bullet) still get treated as a
    // proper <blockquote> instead of literal `> …` text.
    if (/^\s*>\s?/.test(ln)) {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", lines: [quote.join(" ")] });
      continue;
    }
    if (/^\s*[-*]\s+/.test(ln)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", lines: items });
      continue;
    }
    // GFM table: header row of `| a | b | c |` followed by a separator row
    // `| --- | :---: | ---: |` (with optional colons for alignment). Only fires
    // when BOTH rows are present so we don't misinterpret single-pipe prose.
    if (
      /^\s*\|.+\|\s*$/.test(ln) &&
      i + 1 < lines.length &&
      /^\s*\|?\s*:?-{3,}:?(\s*\|\s*:?-{3,}:?)+\s*\|?\s*$/.test(lines[i + 1])
    ) {
      flushPara();
      const splitRow = (row: string) =>
        row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const headers = splitRow(ln);
      const sepCells = splitRow(lines[i + 1]);
      const aligns: ("left" | "right" | "center")[] = sepCells.map((c) => {
        const l = c.startsWith(":"), r = c.endsWith(":");
        return l && r ? "center" : r ? "right" : "left";
      });
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.+\|\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", lines: [], headers, rows, aligns });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(ln)) {
      flushPara();
      const items: string[] = [];
      const m0 = /^\s*(\d+)[.)]\s+/.exec(lines[i]);
      const firstNum = m0 ? parseInt(m0[1], 10) : undefined;
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", lines: items, firstNum });
      continue;
    }
    buf.push(ln);
    i++;
  }
  flushPara();
  return blocks;
}

// -------- Clipboard exports ----------------------------------------------
// Produce (a) a rich-HTML representation of an assistant answer, and (b) a
// clean plain-text representation. Both are written to the clipboard via
// `navigator.clipboard.write` so a paste into Word / Notion / Gmail / Docs
// picks up styled text (headings, bullets, tables), while a paste into a
// plain-text field (terminal, Slack in code mode, notes) gets a stripped
// version with no raw `##` or `**` characters.

const _esc = (s: string): string =>
  s.replace(/&/g, "&amp;")
   .replace(/</g, "&lt;")
   .replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;");

// Inline markdown → HTML (bold, italic, inline code, [n] citation chips,
// autolinks). Deliberately narrow: matches what renderInline() supports so
// the pasted output looks like the in-app rendering.
function _inlineHtml(text: string): string {
  let s = _esc(_stripHl(text));
  // Order: bold BEFORE italic so `**foo**` doesn't get half-eaten.
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/_([^_\n]+)_/g, "<em>$1</em>");
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  // Bare URLs.
  s = s.replace(
    /(https?:\/\/[^\s)<]+)/g,
    '<a href="$1">$1</a>',
  );
  // Inline citations: [1] etc. — kept as-is, no chip styling (target editors
  // wouldn't preserve our Tailwind chip anyway).
  return s;
}

function _blockHtml(b: Block): string {
  if (b.type === "h") {
    const lvl = Math.min(Math.max(b.level || 2, 1), 4);
    return `<h${lvl} style="margin:16px 0 8px;font-weight:600;line-height:1.3">${_inlineHtml(b.lines[0])}</h${lvl}>`;
  }
  if (b.type === "ul") {
    return `<ul style="margin:8px 0;padding-left:24px">${b.lines.map((li) => `<li style="margin:4px 0">${_inlineHtml(li)}</li>`).join("")}</ul>`;
  }
  if (b.type === "ol") {
    const start = b.start ?? 1;
    return `<ol start="${start}" style="margin:8px 0;padding-left:24px">${b.lines.map((li) => `<li style="margin:4px 0">${_inlineHtml(li)}</li>`).join("")}</ol>`;
  }
  if (b.type === "quote") {
    return `<blockquote style="margin:10px 0;padding:8px 12px;border-left:3px solid #cbd5e1;color:#475569;background:#f8fafc">${_inlineHtml(b.lines[0])}</blockquote>`;
  }
  if (b.type === "code") {
    return `<pre style="margin:10px 0;padding:12px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.55;color:#1e293b;white-space:pre;overflow-x:auto"><code>${_esc(b.lines.join("\n"))}</code></pre>`;
  }
  if (b.type === "table") {
    const aligns = b.aligns || [];
    const cellStyle = (i: number) =>
      `padding:6px 10px;border:1px solid #e2e8f0;text-align:${aligns[i] || "left"};vertical-align:top`;
    const inlineCell = (c: string) =>
      c.split(/<br\s*\/?>/i).map(_inlineHtml).join("<br>");
    const thead = (b.headers || [])
      .map((h, k) =>
        `<th style="${cellStyle(k)};background:#f1f5f9;font-weight:600;color:#1e293b">${inlineCell(h)}</th>`,
      )
      .join("");
    const tbody = (b.rows || [])
      .map(
        (row, r) =>
          `<tr style="background:${r % 2 ? "#ffffff" : "#f8fafc"}">${row.map((c, k) => `<td style="${cellStyle(k)}">${inlineCell(c)}</td>`).join("")}</tr>`,
      )
      .join("");
    return `<table style="border-collapse:collapse;margin:12px 0;font-size:13px;width:100%"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
  }
  // paragraph
  const html = b.lines.map(_inlineHtml).join("<br>");
  return `<p style="margin:8px 0;line-height:1.55">${html}</p>`;
}

/** Convert a raw assistant markdown answer into inline-styled HTML that
 *  pastes cleanly into Word / Google Docs / Notion / Gmail. */
export function markdownToHtml(src: string): string {
  const blocks = parseBlocks(src);
  // Continuous-numbering pass, same rules as the on-screen renderer.
  let olRun = 0;
  for (const b of blocks) {
    if (b.type === "ol") {
      b.start = olRun === 0 && b.firstNum && b.firstNum > 0 ? b.firstNum : olRun + 1;
      olRun = b.start + b.lines.length - 1;
    } else if (b.type !== "ul") {
      olRun = 0;
    }
  }
  const body = blocks.map(_blockHtml).join("\n");
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:14px;color:#0f172a;line-height:1.55">${body}</div>`;
}

/** Strip markdown syntax to a clean plain-text version — headings become
 *  bare titles, bullets keep `- ` and `1. ` prefixes, tables become aligned
 *  columns, code fences become verbatim monospace blocks. */
export function markdownToPlain(src: string): string {
  const blocks = parseBlocks(src);
  let olRun = 0;
  for (const b of blocks) {
    if (b.type === "ol") {
      b.start = olRun === 0 && b.firstNum && b.firstNum > 0 ? b.firstNum : olRun + 1;
      olRun = b.start + b.lines.length - 1;
    } else if (b.type !== "ul") {
      olRun = 0;
    }
  }
  const stripInline = (s: string): string =>
    _stripHl(s)
      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2")
      .replace(/_([^_\n]+)_/g, "$1")
      .replace(/`([^`\n]+)`/g, "$1")
      .replace(/\{\{cite:([^|}]+)(\|[^}]+)?\}\}/g, "[$1]");
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === "h") {
      out.push(stripInline(b.lines[0]).toUpperCase());
      out.push("");
    } else if (b.type === "ul") {
      for (const li of b.lines) out.push(`- ${stripInline(li)}`);
      out.push("");
    } else if (b.type === "ol") {
      let n = b.start ?? 1;
      for (const li of b.lines) {
        out.push(`${n}. ${stripInline(li)}`);
        n++;
      }
      out.push("");
    } else if (b.type === "quote") {
      out.push(`> ${stripInline(b.lines[0])}`);
      out.push("");
    } else if (b.type === "code") {
      out.push(...b.lines);
      out.push("");
    } else if (b.type === "table") {
      // Compute column widths so the ASCII table reads cleanly.
      const cellText = (c: string) =>
        stripInline(c.replace(/<br\s*\/?>/gi, " ")).trim();
      const rows = [
        (b.headers || []).map(cellText),
        ...(b.rows || []).map((row) => row.map(cellText)),
      ];
      const cols = rows[0].length;
      const widths: number[] = [];
      for (let c = 0; c < cols; c++) {
        let w = 0;
        for (const row of rows) w = Math.max(w, (row[c] || "").length);
        widths.push(w);
      }
      const line = (row: string[]) =>
        row.map((c, i) => (c || "").padEnd(widths[i])).join("  ");
      out.push(line(rows[0]));
      out.push(widths.map((w) => "-".repeat(w)).join("  "));
      for (let r = 1; r < rows.length; r++) out.push(line(rows[r]));
      out.push("");
    } else {
      out.push(b.lines.map(stripInline).join("\n"));
      out.push("");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Copy an answer to the clipboard in BOTH styled HTML and clean plain text.
 *  Rich editors (Word/Docs/Notion/Gmail) paste the HTML with formatting
 *  intact; plain-text targets get the stripped version. Falls back to a
 *  plain-text writeText on browsers without ClipboardItem. */
export async function copyMarkdownRich(src: string): Promise<void> {
  const html = markdownToHtml(src);
  const plain = markdownToPlain(src);
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      return;
    }
  } catch {
    // fall through to plain-text writeText
  }
  await navigator.clipboard.writeText(plain);
}

export function Markdown({ text, preNormalized }: { text: string; preNormalized?: boolean }) {
  const blocks = parseBlocks(text, preNormalized);
  // Number ordered lists continuously even when bullet sub-points split them
  // into separate <ol> blocks (e.g. "Grounds of Appeal": 1., sub-bullets, 2.,
  // sub-bullets, 3.). A heading starts a fresh sequence; bullets/paragraphs
  // in between do not reset it. A list that deliberately starts higher (its
  // first item is e.g. "5.") is honoured when a new sequence begins.
  let olRun = 0;
  for (const b of blocks) {
    if (b.type === "ol") {
      b.start = olRun === 0 && b.firstNum && b.firstNum > 0 ? b.firstNum : olRun + 1;
      olRun = b.start + b.lines.length - 1;
    } else if (b.type !== "ul") {
      // A heading, paragraph or quote ends the current numbered sequence; only
      // bullet sub-points (ul) between items keep it going. This makes a fresh
      // section like "GROUNDS OF APPEAL" restart at 1 rather than continuing a
      // count carried over from an earlier list (e.g. the Statement of Facts).
      olRun = 0;
    }
  }
  return (
    <div className="md-body">
      {blocks.map((b, idx) => {
        if (b.type === "h") {
          // Emit the semantically correct heading tag so ancestor styles
          // (e.g. `.prose-appeal h1..h4`) can distinguish top-level banners
          // from mid-level sub-heads. We clamp `level` into 1..4.
          const level = Math.min(Math.max(b.level || 2, 1), 4);
          const inline = renderInline(b.lines[0]);
          if (level === 1) return <h1 key={idx}>{inline}</h1>;
          if (level === 2) return <h2 key={idx}>{inline}</h2>;
          if (level === 3) return <h3 key={idx}>{inline}</h3>;
          return <h4 key={idx}>{inline}</h4>;
        }
        if (b.type === "ul") {
          return (
            <ul key={idx}>
              {b.lines.map((li, k) => (
                <li key={k}>{renderInline(li)}</li>
              ))}
            </ul>
          );
        }
        if (b.type === "code") {
          // Monospaced block for anything alignment-sensitive: ASCII trees,
          // tabular text, pseudo-code, JSON. Scrolls horizontally on narrow
          // screens instead of wrapping (which would destroy alignment).
          return (
            <div
              key={idx}
              className="my-3 rounded-lg ring-1 ring-slate-200 bg-slate-50/70 overflow-x-auto"
            >
              {b.lang ? (
                <div className="px-3 py-1 text-[10.5px] uppercase tracking-wide text-slate-500 border-b border-slate-200 bg-white/60">
                  {b.lang}
                </div>
              ) : null}
              <pre className="px-3 py-2 text-[12.5px] leading-[1.55] font-mono text-slate-800 whitespace-pre">
                <code>{b.lines.join("\n")}</code>
              </pre>
            </div>
          );
        }
        if (b.type === "ol") {
          return (
            <ol key={idx} start={b.start ?? 1}>
              {b.lines.map((li, k) => (
                <li key={k}>{renderInline(li)}</li>
              ))}
            </ol>
          );
        }
        if (b.type === "quote") {
          return <blockquote key={idx}>{renderInline(b.lines[0])}</blockquote>;
        }
        if (b.type === "table") {
          const aligns = b.aligns || [];
          const alignCls = (i: number) =>
            aligns[i] === "right"
              ? "text-right"
              : aligns[i] === "center"
                ? "text-center"
                : "text-left";
          // The composer often emits literal `<br>` / `<br/>` / `<br />`
          // inside table cells to force multi-line stacking. Convert them
          // to real <br/> elements so the tag doesn't render as text.
          const renderCell = (cell: string): ReactNode[] => {
            const pieces = cell.split(/<br\s*\/?>/i);
            const out: ReactNode[] = [];
            pieces.forEach((piece, i) => {
              if (i > 0) out.push(<br key={`cbr${i}`} />);
              out.push(...renderInline(piece));
            });
            return out;
          };
          return (
            <div key={idx} className="my-3 overflow-x-auto rounded-lg ring-1 ring-slate-200">
              <table className="w-full text-[13.5px] border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-700">
                    {(b.headers || []).map((h, k) => (
                      <th
                        key={k}
                        className={`px-3 py-2 font-semibold border-b border-slate-200 ${alignCls(k)}`}
                      >
                        {renderCell(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(b.rows || []).map((row, r) => (
                    <tr
                      key={r}
                      className="odd:bg-white even:bg-slate-50/40 hover:bg-primary/5 transition-colors"
                    >
                      {row.map((cell, k) => (
                        <td
                          key={k}
                          className={`px-3 py-2 border-t border-slate-100 align-top ${alignCls(k)}`}
                        >
                          {renderCell(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <p key={idx}>
            {b.lines.flatMap((ln, k) =>
              k === 0
                ? renderInline(ln)
                : [<br key={`br${k}`} />, ...renderInline(ln)],
            )}
          </p>
        );
      })}
    </div>
  );
}
