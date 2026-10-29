import { useQueryClient } from "@tanstack/react-query";
import {
  getGetMessageQueryKey,
  getListMessagesQueryKey,
  useCreateMessage,
  useDeleteMessage,
  useGetMessage,
  useListMessages,
  useUpdateMessage,
  type Message,
  type MessageStatus,
  type MessageSummary,
  type MessageUpdate,
} from "@workspace/api-client-react";
import { ArrowLeft, BookOpen, Lightbulb, LockKeyhole, Minus, Plus, Presentation, Printer, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useParams } from "wouter";

import { FullPageMessage, RequireWorkspace } from "@/auth";
import { RichTextEditor, SafeHtml } from "@/components/rich-text";
import { Badge, Button, EmptyState, ErrorPanel, MutationError, PageHeading, SkeletonRows } from "@/components/ui-kit";
import { apiErrorMessage } from "@/firebase-auth";

const STATUSES: { value: MessageStatus; label: string }[] = [
  { value: "idea", label: "Idea" },
  { value: "drafting", label: "Drafting" },
  { value: "ready", label: "Ready to preach" },
  { value: "preached", label: "Preached" },
];
const statusLabel = (s: MessageStatus) => STATUSES.find((x) => x.value === s)?.label ?? s;

/** Preach dates are calendar days (YYYY-MM-DD), shown in the reader's own locale. */
function dayLabel(day: string | null, style: "short" | "long" = "short") {
  if (!day) return null;
  const date = new Date(`${day}T00:00:00`);
  return date.toLocaleDateString(undefined, style === "long"
    ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
    : { weekday: "short", day: "numeric", month: "short" });
}

/** Words in formatted text (tags removed). */
function wordCount(html: string) {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  return text.trim().match(/\S+/g)?.length ?? 0;
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ List ---- */

export function MessagesPage() {
  const list = useListMessages({ query: { queryKey: getListMessagesQueryKey(), retry: 1 } });
  const create = useCreateMessage();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [idea, setIdea] = useState("");
  const [filter, setFilter] = useState<MessageStatus | "all">("all");
  const [query, setQuery] = useState("");

  const refresh = () => void qc.invalidateQueries({ queryKey: getListMessagesQueryKey() });
  const startMessage = () =>
    create.mutate(
      { data: { title: "Untitled message", status: "drafting" } },
      { onSuccess: (m) => setLocation(`/app/messages/${m.id}`) },
    );
  const saveIdea = (e: FormEvent) => {
    e.preventDefault();
    if (!idea.trim()) return;
    create.mutate(
      { data: { title: idea.trim(), status: "idea" } },
      {
        onSuccess: () => {
          setIdea("");
          refresh();
        },
      },
    );
  };

  const messages = list.data ?? [];
  const next = useMemo(
    () =>
      messages
        .filter((m) => m.preachDate && m.preachDate >= today() && m.status !== "preached")
        .sort((a, b) => a.preachDate!.localeCompare(b.preachDate!))[0],
    [messages],
  );
  const shown = messages.filter((m) => {
    if (filter !== "all" && m.status !== filter) return false;
    const text = `${m.title} ${m.scriptures ?? ""} ${m.series ?? ""} ${m.theme ?? ""}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });
  const count = (s: MessageStatus) => messages.filter((m) => m.status === s).length;

  return (
    <>
      <PageHeading
        eyebrow="Private to you"
        title="Sermons"
        subtitle="Prepare Sunday messages and Bible studies, from the first idea to the pulpit."
        action={
          <Button onClick={startMessage} disabled={create.isPending}>
            <Plus size={16} /> New message
          </Button>
        }
      />
      <div className="care-private-banner">
        <LockKeyhole size={17} />
        <span>Only you can see your messages and notes, not other pastors, your team or Pastora.</span>
      </div>

      <form className="idea-capture" onSubmit={saveIdea}>
        <Lightbulb size={18} />
        <input
          aria-label="Capture an idea"
          placeholder="Capture an idea before it slips away, e.g. “Peace in the storm, Mark 4:35-41”"
          maxLength={200}
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={create.isPending || !idea.trim()}>
          Save idea
        </Button>
      </form>
      <MutationError errors={[create.error]} />

      {next && (
        <Link href={`/app/messages/${next.id}`} className="next-message">
          <span className="eyebrow">Next to preach · {dayLabel(next.preachDate, "long")}</span>
          <b className="serif">{next.title}</b>
          <small>
            {[next.scriptures, next.series, statusLabel(next.status)].filter(Boolean).join(" · ")}
          </small>
        </Link>
      )}

      {list.isLoading ? (
        <SkeletonRows />
      ) : list.isError ? (
        <ErrorPanel text={apiErrorMessage(list.error, "Your messages are unavailable.")} retry={() => void list.refetch()} />
      ) : messages.length === 0 ? (
        <EmptyState
          title="Your study, kept in one place"
          description="Save ideas as they come during the week, then start a message to build the outline, study notes and application."
        />
      ) : (
        <>
          <div className="message-toolbar">
            <div className="message-filters" role="tablist" aria-label="Filter by status">
              <button role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>
                All <span>{messages.length}</span>
              </button>
              {STATUSES.map((s) => (
                <button key={s.value} role="tab" aria-selected={filter === s.value} onClick={() => setFilter(s.value)}>
                  {s.value === "ready" ? "Ready" : s.label} <span>{count(s.value)}</span>
                </button>
              ))}
            </div>
            <label className="message-search">
              <Search size={15} />
              <input
                aria-label="Search messages"
                placeholder="Search titles, scriptures, series"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          {shown.length ? (
            <div className="message-list">
              {shown.map((m) => (
                <MessageRow key={m.id} message={m} />
              ))}
            </div>
          ) : (
            <EmptyState title="Nothing here" description="No messages match this filter." />
          )}
        </>
      )}
    </>
  );
}

function MessageRow({ message: m }: { message: MessageSummary }) {
  return (
    <Link href={`/app/messages/${m.id}`} className="message-row">
      <span className="message-row-icon">{m.status === "idea" ? <Lightbulb size={16} /> : <BookOpen size={16} />}</span>
      <div>
        <b>{m.title}</b>
        <small>
          {[m.scriptures, m.series, m.preachDate ? `Preach ${dayLabel(m.preachDate)}` : null]
            .filter(Boolean)
            .join(" · ") || "No scripture or date yet"}
        </small>
      </div>
      <span className="message-row-meta">
        <Badge label={statusLabel(m.status)} />
        <small>
          {m.wordCount ? `${m.wordCount} words · ` : ""}edited {new Date(m.updatedAt).toLocaleDateString()}
        </small>
      </span>
    </Link>
  );
}

/* ---------------------------------------------------------------- Editor ---- */

type Draft = Pick<
  Message,
  "title" | "status" | "series" | "scriptures" | "theme" | "preachDate" | "outline" | "study" | "illustrations" | "application"
>;

const SECTIONS: { key: "outline" | "study" | "illustrations" | "application"; label: string; hint: string }[] = [
  {
    key: "outline",
    label: "Outline",
    hint: "Your main points and how the message flows. Use headings and lists to shape it.",
  },
  {
    key: "study",
    label: "Study notes",
    hint: "Context, word studies, cross-references and what commentaries say.",
  },
  {
    key: "illustrations",
    label: "Illustrations",
    hint: "Stories, examples and images that will help people see it.",
  },
  {
    key: "application",
    label: "Application",
    hint: "What you'll ask people to believe or do this week, and how you'll close.",
  },
];

function draftOf(m: Message): Draft {
  return {
    title: m.title,
    status: m.status,
    series: m.series,
    scriptures: m.scriptures,
    theme: m.theme,
    preachDate: m.preachDate,
    outline: m.outline,
    study: m.study,
    illustrations: m.illustrations,
    application: m.application,
  };
}

export function MessageEditorPage() {
  const { id = "" } = useParams<{ id: string }>();
  const message = useGetMessage(id, { query: { queryKey: getGetMessageQueryKey(id), retry: 1 } });
  if (message.isLoading) return <SkeletonRows />;
  if (message.isError || !message.data) {
    return (
      <ErrorPanel text={apiErrorMessage(message.error, "This message couldn't be opened.")} retry={() => void message.refetch()} />
    );
  }
  return <Editor key={id} initial={message.data} />;
}

function Editor({ initial }: { initial: Message }) {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const save = useUpdateMessage();
  const remove = useDeleteMessage();
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [section, setSection] = useState<(typeof SECTIONS)[number]["key"]>("outline");
  const [state, setState] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pending = useRef<MessageUpdate>({});
  const timer = useRef<number | undefined>(undefined);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const changes = pending.current;
    if (!Object.keys(changes).length) return;
    pending.current = {};
    setState("saving");
    save.mutate(
      { messageId: initial.id, data: changes },
      {
        onSuccess: (saved) => {
          qc.setQueryData(getGetMessageQueryKey(initial.id), saved);
          void qc.invalidateQueries({ queryKey: getListMessagesQueryKey() });
          setSavedAt(new Date());
          setState(Object.keys(pending.current).length ? "pending" : "saved");
        },
        onError: () => {
          // Keep the unsaved changes so the next edit (or Retry) sends them again.
          pending.current = { ...changes, ...pending.current };
          setState("error");
        },
      },
    );
  }, [initial.id, qc, save]);

  const edit = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    pending.current = { ...pending.current, [key]: value };
    setState("pending");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flushRef.current(), 900);
  };

  // Save straight away when leaving the page, and warn if the browser is closing mid-save.
  // The latest flush lives in a ref so this effect runs once, not on every keystroke.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      flushRef.current();
    };
  }, []);

  const words = SECTIONS.reduce((n, s) => n + wordCount(draft[s.key]), 0);
  const saveLabel =
    state === "saving" || state === "pending"
      ? "Saving…"
      : state === "error"
        ? "Not saved"
        : savedAt
          ? `Saved ${savedAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
          : "All changes saved";

  return (
    <div className="message-editor">
      <div className="editor-bar">
        <Link href="/app/messages" className="under-link">
          <ArrowLeft size={15} /> All messages
        </Link>
        <span className={`save-state ${state}`} role="status">
          {saveLabel}
          {state === "error" && (
            <button className="plain-link" onClick={flush}>
              Retry
            </button>
          )}
        </span>
        <div className="editor-actions">
          <select
            aria-label="Status"
            value={draft.status}
            onChange={(e) => edit("status", e.target.value as MessageStatus)}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            onClick={() => {
              flush();
              setLocation(`/app/messages/${initial.id}/pulpit`);
            }}
          >
            <Presentation size={15} /> Pulpit view
          </Button>
        </div>
      </div>

      <input
        className="editor-title serif"
        aria-label="Title"
        maxLength={200}
        value={draft.title}
        placeholder="Message title"
        onChange={(e) => edit("title", e.target.value)}
        onBlur={() => !draft.title.trim() && edit("title", "Untitled message")}
      />

      <div className="editor-meta">
        <label>
          <span>Scripture</span>
          <input
            maxLength={300}
            placeholder="e.g. John 15:1-11"
            value={draft.scriptures ?? ""}
            onChange={(e) => edit("scriptures", e.target.value)}
          />
        </label>
        <label>
          <span>Series</span>
          <input
            maxLength={120}
            placeholder="Optional"
            value={draft.series ?? ""}
            onChange={(e) => edit("series", e.target.value)}
          />
        </label>
        <label>
          <span>Preach on</span>
          <input
            type="date"
            value={draft.preachDate ?? ""}
            onChange={(e) => edit("preachDate", e.target.value || null)}
          />
        </label>
        <label className="editor-theme">
          <span>Big idea, in one sentence</span>
          <input
            maxLength={500}
            placeholder="What one thing should people remember?"
            value={draft.theme ?? ""}
            onChange={(e) => edit("theme", e.target.value)}
          />
        </label>
      </div>

      <div className="editor-tabs" role="tablist" aria-label="Sections">
        {SECTIONS.map((s) => (
          <button key={s.key} role="tab" aria-selected={section === s.key} onClick={() => setSection(s.key)}>
            {s.label}
            {draft[s.key].trim() ? <i aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
      {SECTIONS.filter((s) => s.key === section).map((s) => (
        <RichTextEditor
          key={s.key}
          className="editor-body"
          label={s.label}
          placeholder={s.hint}
          value={draft[s.key]}
          onChange={(html) => edit(s.key, html)}
        />
      ))}

      <div className="editor-foot">
        <small>{words} words</small>
        {confirmDelete ? (
          <span className="editor-delete">
            Delete this message for good?
            <Button
              variant="outline"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(
                  { messageId: initial.id },
                  {
                    onSuccess: () => {
                      pending.current = {};
                      void qc.invalidateQueries({ queryKey: getListMessagesQueryKey() });
                      setLocation("/app/messages");
                    },
                  },
                )
              }
            >
              Delete
            </Button>
            <Button variant="quiet" onClick={() => setConfirmDelete(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <button className="plain-link" onClick={() => setConfirmDelete(true)}>
            Delete message
          </button>
        )}
      </div>
      <MutationError errors={[remove.error]} />
    </div>
  );
}

/* ---------------------------------------------------------------- Pulpit ---- */

/** A clean, large-print view for preaching from a tablet or printing. */
export function PulpitPage() {
  return (
    <RequireWorkspace>
      <Pulpit />
    </RequireWorkspace>
  );
}

function Pulpit() {
  const { id = "" } = useParams<{ id: string }>();
  const message = useGetMessage(id, { query: { queryKey: getGetMessageQueryKey(id), retry: 1 } });
  const [size, setSize] = useState(() => {
    try {
      return Number(localStorage.getItem("pastora-pulpit-size")) || 1;
    } catch {
      return 1;
    }
  });
  const resize = (next: number) => {
    const clamped = Math.min(1.8, Math.max(0.8, Math.round(next * 10) / 10));
    setSize(clamped);
    try {
      localStorage.setItem("pastora-pulpit-size", String(clamped));
    } catch {
      // Size still applies for this visit.
    }
  };
  if (message.isLoading) return <FullPageMessage title="Opening your message…" />;
  if (message.isError || !message.data) {
    return (
      <FullPageMessage title="This message couldn't be opened.">
        <Link className="button primary" href="/app/messages">
          Back to messages
        </Link>
      </FullPageMessage>
    );
  }
  const m = message.data;
  return (
    <div className="pulpit" style={{ ["--pulpit-scale" as string]: size }}>
      <div className="pulpit-controls">
        <Link href={`/app/messages/${m.id}`} className="under-link">
          <ArrowLeft size={15} /> Back to editing
        </Link>
        <div>
          <button className="icon-button" aria-label="Smaller text" onClick={() => resize(size - 0.1)}>
            <Minus size={16} />
          </button>
          <button className="icon-button" aria-label="Larger text" onClick={() => resize(size + 0.1)}>
            <Plus size={16} />
          </button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer size={15} /> Print
          </Button>
        </div>
      </div>
      <article className="pulpit-page">
        <header>
          {m.series && <p className="eyebrow">{m.series}</p>}
          <h1 className="serif">{m.title}</h1>
          {(m.scriptures || m.preachDate) && (
            <p className="pulpit-meta">{[m.scriptures, dayLabel(m.preachDate, "long")].filter(Boolean).join(" · ")}</p>
          )}
          {m.theme && <p className="pulpit-theme">{m.theme}</p>}
        </header>
        {m.outline.trim() && <SafeHtml className="pulpit-text" html={m.outline} />}
        {m.application.trim() && (
          <section>
            <h2 className="serif">Application</h2>
            <SafeHtml className="pulpit-text" html={m.application} />
          </section>
        )}
        {m.illustrations.trim() && (
          <section className="pulpit-secondary">
            <h2 className="serif">Illustrations</h2>
            <SafeHtml className="pulpit-text" html={m.illustrations} />
          </section>
        )}
        {!m.outline.trim() && !m.application.trim() && (
          <p className="pulpit-empty">Add an outline to see it here.</p>
        )}
      </article>
    </div>
  );
}
