import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { marked } from "marked";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import {
  Bold, Italic, List, ListOrdered, Heading2, Heading3, Quote,
  Table as TableIcon, Undo2, Redo2, RemoveFormatting, Link as LinkIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// A round-tripping WYSIWYG editor that STORES markdown but LETS THE USER
// EDIT the rendered document. Round-tripping uses `marked` (md→html on
// mount) and `turndown` (html→md on every change). This is what turns the
// assessment editor from a Notepad-style textarea into something that
// reads and edits like a Word document — tables become editable grids,
// bold text stays bold as you type, headings are actually big.
//
// IMPORTANT: turndown + marked are constructed INSIDE the component (lazy)
// rather than at module top-level. A construction failure at import time
// (e.g. transient chunk load fault, ESM/CJS interop hiccup) would blow up
// the entire route's chunk and trigger the app-level ErrorBoundary — the
// per-instance lazy init contains any failure to the editor itself.

function _makeTurndown(): TurndownService {
  const t = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    strongDelimiter: "**",
  });
  t.use(gfm);
  return t;
}

function _mdToHtml(md: string): string {
  try {
    const out = marked.parse(md || "", { gfm: true, breaks: false });
    // marked can return Promise<string> in async mode; we're sync, so this
    // is always a string. Coerce defensively to keep TipTap happy.
    return typeof out === "string" ? out : String(out || "");
  } catch {
    // Fall back to plain-text rendering so a bad markdown block still
    // opens (empty tables, unclosed fences etc. shouldn't crash the page).
    return "<p>" + (md || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!)) + "</p>";
  }
}

function ToolbarButton({
  active, onClick, title, disabled, children,
}: {
  active?: boolean; onClick: () => void; title: string;
  disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={cn(
        "h-7 px-2 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors",
        "inline-flex items-center gap-1 text-[12px] font-medium",
        "disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-600",
        active && "bg-primary/10 text-primary hover:bg-primary/15",
      )}
    >
      {children}
    </button>
  );
}

interface Props {
  markdown: string;
  onChange: (md: string) => void;
  placeholder?: string;
  className?: string;
  minRows?: number;
}

export default function RichEditor({
  markdown, onChange, placeholder, className, minRows = 12,
}: Props) {
  // One turndown per editor instance — kept in a ref so React re-renders
  // don't discard it. Constructed once, lazily, so a bad build never blows
  // up the whole assessment page.
  const turndownRef = useRef<TurndownService | null>(null);
  const turndown = useMemo(() => {
    if (!turndownRef.current) turndownRef.current = _makeTurndown();
    return turndownRef.current;
  }, []);

  const initialHtml = useMemo(() => _mdToHtml(markdown), []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        codeBlock: { HTMLAttributes: { class: "bt-md-code" } },
        blockquote: { HTMLAttributes: { class: "bt-md-quote" } },
      }),
      Placeholder.configure({ placeholder: placeholder || "Start typing…" }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "underline text-primary" } }),
      Table.configure({ resizable: true, HTMLAttributes: { class: "bt-md-table" } }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: initialHtml,
    editorProps: {
      attributes: {
        class: cn(
          "bt-md-body prose-legal max-w-none focus:outline-none",
          "px-3 py-2 min-h-[16rem]",
        ),
      },
    },
    onUpdate: ({ editor }) => {
      try {
        const html = editor.getHTML();
        const md = turndown.turndown(html);
        onChange(md);
      } catch {
        // Never let a turndown hiccup crash the editor — fall back to a
        // best-effort text extraction so the user's changes aren't lost.
        onChange(editor.getText());
      }
    },
  });

  // If the caller swaps the underlying markdown (e.g. the user regenerates
  // the section server-side while the editor is open), replace the editor's
  // content. Guard against reflecting our OWN updates back through
  // marked→html→turndown, which would nuke the caret position.
  useEffect(() => {
    if (!editor) return;
    let currentMd = "";
    try { currentMd = turndown.turndown(editor.getHTML()); } catch { /* ignore */ }
    if (currentMd.trim() === (markdown || "").trim()) return;
    editor.commands.setContent(_mdToHtml(markdown), false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, markdown]);

  if (!editor) {
    return (
      <div className={cn("rounded-lg border border-slate-200 bg-white p-3", className)}>
        <div className="text-[12px] text-slate-400">Loading editor…</div>
      </div>
    );
  }

  const insertTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };
  const setLink = () => {
    const url = window.prompt("URL");
    if (!url) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className={cn(
      "rounded-lg border border-slate-200 bg-white overflow-hidden",
      className,
    )}
    style={{ ["--bt-min-rows" as string]: `${minRows}` }}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-slate-100 bg-slate-50/60">
        <ToolbarButton
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          title="Heading (H2)"
        >
          <Heading2 className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          title="Sub-heading (H3)"
        >
          <Heading3 className="size-3.5" />
        </ToolbarButton>
        <span className="w-px h-4 bg-slate-200 mx-1" />
        <ToolbarButton
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold (Ctrl+B)"
        >
          <Bold className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic (Ctrl+I)"
        >
          <Italic className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("link")}
          onClick={setLink}
          title="Link"
        >
          <LinkIcon className="size-3.5" />
        </ToolbarButton>
        <span className="w-px h-4 bg-slate-200 mx-1" />
        <ToolbarButton
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Bulleted list"
        >
          <List className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Numbered list"
        >
          <ListOrdered className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          title="Blockquote"
        >
          <Quote className="size-3.5" />
        </ToolbarButton>
        <span className="w-px h-4 bg-slate-200 mx-1" />
        <ToolbarButton
          onClick={insertTable}
          title="Insert 3×3 table"
        >
          <TableIcon className="size-3.5" />
        </ToolbarButton>
        {editor.isActive("table") && (
          <>
            <ToolbarButton
              onClick={() => editor.chain().focus().addColumnAfter().run()}
              title="Add column"
            >+col</ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().addRowAfter().run()}
              title="Add row"
            >+row</ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().deleteColumn().run()}
              title="Delete column"
            >-col</ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().deleteRow().run()}
              title="Delete row"
            >-row</ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().deleteTable().run()}
              title="Delete table"
            >×</ToolbarButton>
          </>
        )}
        <span className="w-px h-4 bg-slate-200 mx-1" />
        <ToolbarButton
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
          title="Clear formatting"
        >
          <RemoveFormatting className="size-3.5" />
        </ToolbarButton>
        <span className="ml-auto flex items-center gap-0.5">
          <ToolbarButton
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 className="size-3.5" />
          </ToolbarButton>
        </span>
      </div>

      {/* Editor surface */}
      <EditorContent editor={editor} className="max-h-[70vh] overflow-y-auto" />
    </div>
  );
}
