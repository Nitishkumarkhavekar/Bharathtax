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
      const domain = token.slice(7, -2);
      parts.push(
        <a
          key={`cite${key++}`}
          href={`https://${domain}`}
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
  type: "p" | "h" | "ul" | "ol" | "quote";
  // For p / h / quote: lines is a single line. For ul/ol: list of items.
  lines: string[];
  level?: number; // for h
}

// Rewrites the model's raw text into something the block parser handles well.
// Even with a strict system prompt the model sometimes glues bullets and
// labelled sub-totals onto one line — this rebuilds the structure so the user
// always sees a clean list.
export function normalizeMarkdown(src: string): string {
  let s = src.replace(/\r\n/g, "\n");

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
      blocks.push({ type: "p", lines: [buf.join(" ").trim()] });
      buf = [];
    }
  };
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
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
    if (/^\s*\d+[.)]\s+/.test(ln)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", lines: items });
      continue;
    }
    buf.push(ln);
    i++;
  }
  flushPara();
  return blocks;
}

export function Markdown({ text, preNormalized }: { text: string; preNormalized?: boolean }) {
  const blocks = parseBlocks(text, preNormalized);
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
        if (b.type === "ol") {
          return (
            <ol key={idx}>
              {b.lines.map((li, k) => (
                <li key={k}>{renderInline(li)}</li>
              ))}
            </ol>
          );
        }
        if (b.type === "quote") {
          return <blockquote key={idx}>{renderInline(b.lines[0])}</blockquote>;
        }
        return <p key={idx}>{renderInline(b.lines[0])}</p>;
      })}
    </div>
  );
}
