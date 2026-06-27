// Tiny markdown renderer for assistant replies. Handles only what
// bharattax-rag actually emits: bold, inline code, bullet/numbered lists,
// section headings, blockquotes, autolinks, and inline citations [1].
// Avoid adding a heavy markdown dep just for these.

import { ReactNode } from "react";

function renderInline(text: string): ReactNode[] {
  // Order matters: escape-safe regexes for **bold**, `code`, [n] citations, urls.
  const parts: ReactNode[] = [];
  let i = 0;
  const re =
    /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[\d+\]|https?:\/\/[^\s)]+|\b§\s?\d+[A-Z]*(?:\(\d+\))?)/g;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > i) parts.push(text.slice(i, match.index));
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(
        <strong key={`b${key++}`} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
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
    const h = /^(#{1,3})\s+(.*)$/.exec(ln);
    if (h) {
      flushPara();
      blocks.push({ type: "h", lines: [h[2]], level: h[1].length });
      i++;
      continue;
    }
    if (/^>\s?/.test(ln)) {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ""));
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
    <div className="space-y-3 leading-relaxed text-[15px] text-slate-800">
      {blocks.map((b, idx) => {
        if (b.type === "h") {
          const sizes = ["text-xl", "text-lg", "text-base"];
          const cls = `font-semibold text-foreground ${sizes[(b.level || 2) - 1]}`;
          return (
            <h3 key={idx} className={cls}>
              {renderInline(b.lines[0])}
            </h3>
          );
        }
        if (b.type === "ul") {
          return (
            <ul key={idx} className="list-disc pl-5 space-y-1.5">
              {b.lines.map((li, k) => (
                <li key={k}>{renderInline(li)}</li>
              ))}
            </ul>
          );
        }
        if (b.type === "ol") {
          return (
            <ol key={idx} className="list-decimal pl-5 space-y-1.5">
              {b.lines.map((li, k) => (
                <li key={k}>{renderInline(li)}</li>
              ))}
            </ol>
          );
        }
        if (b.type === "quote") {
          return (
            <blockquote
              key={idx}
              className="border-l-2 border-primary/40 pl-3 italic text-slate-600"
            >
              {renderInline(b.lines[0])}
            </blockquote>
          );
        }
        return (
          <p key={idx} className="whitespace-pre-wrap">
            {renderInline(b.lines[0])}
          </p>
        );
      })}
    </div>
  );
}
