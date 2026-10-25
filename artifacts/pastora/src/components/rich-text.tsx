import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import DOMPurify from "dompurify";
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Underline,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

/**
 * The same small set of formatting the server keeps (see api-server/src/lib/rich-text.ts).
 * The server cleans everything on save; this second pass protects pages that render it.
 */
const ALLOWED = {
  ALLOWED_TAGS: ["p", "br", "strong", "em", "u", "s", "h2", "h3", "ul", "ol", "li", "blockquote", "a", "hr"],
  ALLOWED_ATTR: ["href", "target", "rel"],
};

export function SafeHtml({ html, className }: { html: string; className?: string }) {
  return <div className={`rich-text ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html, ALLOWED) }} />;
}

type Tool = { label: string; icon: LucideIcon; active?: (e: Editor) => boolean; run: (e: Editor) => void };

const TOOLS: (Tool | "|")[] = [
  { label: "Bold", icon: Bold, active: (e) => e.isActive("bold"), run: (e) => e.chain().focus().toggleBold().run() },
  { label: "Italic", icon: Italic, active: (e) => e.isActive("italic"), run: (e) => e.chain().focus().toggleItalic().run() },
  {
    label: "Underline",
    icon: Underline,
    active: (e) => e.isActive("underline"),
    run: (e) => e.chain().focus().toggleUnderline().run(),
  },
  {
    label: "Strikethrough",
    icon: Strikethrough,
    active: (e) => e.isActive("strike"),
    run: (e) => e.chain().focus().toggleStrike().run(),
  },
  "|",
  {
    label: "Heading",
    icon: Heading2,
    active: (e) => e.isActive("heading", { level: 2 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    label: "Subheading",
    icon: Heading3,
    active: (e) => e.isActive("heading", { level: 3 }),
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    label: "Bulleted list",
    icon: List,
    active: (e) => e.isActive("bulletList"),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: "Numbered list",
    icon: ListOrdered,
    active: (e) => e.isActive("orderedList"),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    label: "Quote",
    icon: Quote,
    active: (e) => e.isActive("blockquote"),
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
];

/** A friendly editor: bold, italic, underline, headings, lists, quotes and links. */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["http", "https", "mailto"] },
      }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: value,
    editorProps: { attributes: { "aria-label": label, class: "rich-text rich-text-input" } },
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? "" : e.getHTML()),
  });

  // Keep the editor in step if the value is replaced from outside (e.g. another section).
  useEffect(() => {
    if (editor && !editor.isFocused && value !== editor.getHTML() && !(value === "" && editor.isEmpty)) {
      editor.commands.setContent(value, { emitUpdate: false });
    }
  }, [editor, value]);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            active: TOOLS.map((t) => (t !== "|" && t.active ? t.active(e) : false)),
            link: e.isActive("link"),
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
          }
        : null,
  });

  const openLink = () => {
    if (!editor) return;
    setHref(editor.getAttributes("link").href ?? "");
    setLinkOpen(true);
  };
  const applyLink = (e: FormEvent) => {
    e.preventDefault();
    if (!editor) return;
    const url = href.trim();
    if (!url) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: /^(https?:|mailto:)/i.test(url) ? url : `https://${url}` }).run();
    setLinkOpen(false);
  };

  return (
    <div className={`rich-editor ${className ?? ""}`}>
      <div className="rich-toolbar" role="toolbar" aria-label={`${label} formatting`}>
        {TOOLS.map((tool, i) =>
          tool === "|" ? (
            <span key={`sep-${i}`} className="rich-sep" aria-hidden="true" />
          ) : (
            <button
              key={tool.label}
              type="button"
              title={tool.label}
              aria-label={tool.label}
              aria-pressed={Boolean(state?.active[i])}
              className={state?.active[i] ? "on" : ""}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => editor && tool.run(editor)}
            >
              <tool.icon size={15} />
            </button>
          ),
        )}
        <button
          type="button"
          title="Link"
          aria-label="Link"
          aria-pressed={Boolean(state?.link)}
          className={state?.link ? "on" : ""}
          onMouseDown={(e) => e.preventDefault()}
          onClick={openLink}
        >
          <Link2 size={15} />
        </button>
        <span className="rich-sep" aria-hidden="true" />
        <button
          type="button"
          title="Undo"
          aria-label="Undo"
          disabled={!state?.canUndo}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor?.chain().focus().undo().run()}
        >
          <Undo2 size={15} />
        </button>
        <button
          type="button"
          title="Redo"
          aria-label="Redo"
          disabled={!state?.canRedo}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor?.chain().focus().redo().run()}
        >
          <Redo2 size={15} />
        </button>
      </div>
      {linkOpen && (
        <form className="rich-link" onSubmit={applyLink}>
          <input
            autoFocus
            aria-label="Link address"
            placeholder="Paste a link, e.g. bible.com/bible/111/JHN.15"
            value={href}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setLinkOpen(false)}
          />
          <button type="submit" className="button primary small">
            {href.trim() ? "Apply" : "Remove link"}
          </button>
          <button type="button" className="plain-link" onClick={() => setLinkOpen(false)}>
            Cancel
          </button>
        </form>
      )}
      <EditorContent editor={editor} className="rich-content" />
    </div>
  );
}
