import { useQueryClient } from "@tanstack/react-query";
import type { Task } from "@workspace/api-client-react";
import {
  getGetDashboardQueryKey,
  getGetTeamQueryKey,
  getListTasksQueryKey,
  useGetTeam,
  useCreateTask,
  useListTasks,
  useUpdateTask,
} from "@workspace/api-client-react";
import { Check, ClipboardList, Plus, RotateCcw } from "lucide-react";
import { useState, type FormEvent } from "react";

import { useSession } from "@/auth";
import { Button, ErrorPanel, Field, MutationError, PageHeading, SkeletonRows } from "@/components/ui-kit";
import { apiErrorMessage } from "@/firebase-auth";

const WHEN: [string, number | null][] = [
  ["No date", null],
  ["Today", 0],
  ["Tomorrow", 1],
  ["This week", 5],
  ["Next week", 7],
];

const dueOn = (days: number | null) => {
  if (days === null) return null;
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(17, 0, 0, 0);
  return d.toISOString();
};

function dueLabel(iso: string | null): { text: string; late: boolean } | null {
  if (!iso) return null;
  const d = new Date(iso);
  const start = new Date().setHours(0, 0, 0, 0);
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - start) / 86_400_000);
  if (days < 0) return { text: "Overdue", late: true };
  if (days === 0) return { text: "Today", late: false };
  if (days === 1) return { text: "Tomorrow", late: false };
  return { text: d.toLocaleDateString(undefined, days < 7 ? { weekday: "long" } : { day: "numeric", month: "short" }), late: false };
}

/** Visits, calls and errands: give each one a person and a day, tick it off when done. */
export function TasksPage() {
  const q = useListTasks({ query: { queryKey: getListTasksQueryKey(), retry: 1 } });
  const create = useCreateTask();
  const update = useUpdateTask();
  const qc = useQueryClient();
  const session = useSession();
  const me = session.data?.user.uid;
  const canAssign = session.data?.user.role === "pastor";
  const team = useGetTeam({ query: { queryKey: getGetTeamQueryKey(), enabled: canAssign, retry: 1 } });
  const members = (team.data?.members ?? []).filter((m) => m.active);
  const nameFor = (uid: string) => (uid === me ? "You" : (members.find((m) => m.uid === uid)?.name ?? "Someone on your team"));

  const [show, setShow] = useState<"open" | "done">("open");
  const [adding, setAdding] = useState(false);
  const [details, setDetails] = useState(false);
  const empty = { title: "", description: "", assignedTo: "", when: 1 as number | null, high: false };
  const [form, setForm] = useState(empty);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        data: {
          title: form.title.trim(),
          description: form.description.trim() || null,
          assignedTo: form.assignedTo || null,
          priority: form.high ? "high" : "normal",
          dueAt: dueOn(form.when),
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setForm(empty);
          setDetails(false);
          setAdding(false);
          setShow("open");
        },
      },
    );
  };

  const all = q.data ?? [];
  const open = all
    .filter((t) => t.status !== "completed")
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
  const done = all.filter((t) => t.status === "completed");
  const list = show === "open" ? open : done;

  return (
    <>
      <PageHeading
        eyebrow="Nothing slips through"
        title="Tasks"
        subtitle={canAssign ? "Visits, calls and errands, for you or anyone on your team." : "What you've been asked to do."}
        action={
          !adding && (
            <Button onClick={() => setAdding(true)}>
              <Plus size={16} /> New task
            </Button>
          )
        }
      />
      {adding && (
        <form className="task-quick" onSubmit={submit}>
          <input
            required
            autoFocus
            maxLength={200}
            aria-label="What needs doing"
            placeholder="What needs doing? e.g. Visit Mrs Ola in hospital"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <div className="task-quick-row">
            {canAssign && (
              <Field label="Who">
                <select value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}>
                  <option value="">Me</option>
                  {members
                    .filter((m) => !m.isCurrentUser)
                    .map((m) => (
                      <option key={m.uid} value={m.uid}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            <div className="field">
              <span>When</span>
              <div className="follow-days" role="radiogroup" aria-label="When">
                {WHEN.map(([label, days]) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={form.when === days}
                    key={label}
                    className={form.when === days ? "on" : ""}
                    onClick={() => setForm({ ...form, when: days })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {details ? (
            <>
              <Field label="Notes (optional)">
                <textarea
                  maxLength={2000}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </Field>
              <label className="task-urgent">
                <input type="checkbox" checked={form.high} onChange={(e) => setForm({ ...form, high: e.target.checked })} />
                Urgent
              </label>
            </>
          ) : (
            <button type="button" className="under-link" onClick={() => setDetails(true)}>
              Add notes
            </button>
          )}
          <div className="form-actions">
            <Button type="submit" disabled={create.isPending || !form.title.trim()}>
              {create.isPending ? "Saving…" : "Save task"}
            </Button>
            <Button variant="quiet" onClick={() => (setAdding(false), setForm(empty), setDetails(false))}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      <MutationError errors={[create.error, update.error]} />
      <div className="inbox-tabs task-tabs" role="tablist">
        <button role="tab" aria-selected={show === "open"} onClick={() => setShow("open")}>
          To do {open.length ? <small>{open.length}</small> : null}
        </button>
        <button role="tab" aria-selected={show === "done"} onClick={() => setShow("done")}>
          Done
        </button>
      </div>
      {q.isLoading ? (
        <SkeletonRows />
      ) : q.isError ? (
        <ErrorPanel text={apiErrorMessage(q.error, "Tasks are unavailable.")} retry={() => void q.refetch()} />
      ) : list.length ? (
        <ul className="task-list">
          {list.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              who={task.assignedTo ? nameFor(task.assignedTo) : null}
              busy={update.isPending}
              onToggle={() =>
                update.mutate(
                  { taskId: task.id, data: { status: task.status === "completed" ? "todo" : "completed" } },
                  { onSuccess: invalidate },
                )
              }
            />
          ))}
        </ul>
      ) : (
        <div className="inbox-empty task-empty">
          <ClipboardList size={22} />
          <b>{show === "open" ? "Nothing to do" : "Nothing finished yet"}</b>
          <small>
            {show === "open"
              ? "Add a visit, a call or an errand, and give it to someone on your team."
              : "Tasks you tick off move here."}
          </small>
        </div>
      )}
    </>
  );
}

function TaskRow({ task, who, busy, onToggle }: { task: Task; who: string | null; busy: boolean; onToggle: () => void }) {
  const finished = task.status === "completed";
  const due = finished ? null : dueLabel(task.dueAt);
  return (
    <li className={`task-row ${finished ? "finished" : ""}`}>
      <button
        className={`today-check ${finished ? "checked" : ""}`}
        aria-label={finished ? `Move "${task.title}" back to To do` : `Mark "${task.title}" done`}
        disabled={busy}
        onClick={onToggle}
      >
        {finished ? <RotateCcw size={12} /> : <Check size={13} />}
      </button>
      <div className="today-main">
        <b>
          {task.title}
          {task.priority === "high" && !finished && <em className="task-urgent-tag">Urgent</em>}
        </b>
        {task.description && <small>{task.description}</small>}
      </div>
      {who && <span className="task-who">{who}</span>}
      {due && <time className={due.late ? "late" : ""}>{due.text}</time>}
    </li>
  );
}
