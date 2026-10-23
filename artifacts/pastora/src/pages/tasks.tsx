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
import { ArrowRight, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

import { useSession } from "@/auth";
import {
  Button,
  EmptyState,
  ErrorPanel,
  Field,
  MutationError,
  PageHeading,
  SkeletonRows,
} from "@/components/ui-kit";
import { apiErrorMessage } from "@/firebase-auth";

export function TasksPage() {
  const q = useListTasks({ query: { queryKey: getListTasksQueryKey(), retry: 1 } });
  const create = useCreateTask();
  const update = useUpdateTask();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const session = useSession();
  const canAssign = session.data?.user.role === "owner" || session.data?.user.role === "pastor";
  const team = useGetTeam({ query: { queryKey: getGetTeamQueryKey(), enabled: canAssign, retry: 1 } });
  const members = (team.data?.members ?? []).filter((m) => m.active);
  const nameFor = (uid: string) =>
    uid === session.data?.user.uid ? "you" : (members.find((m) => m.uid === uid)?.name ?? "a team member");
  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "normal",
    dueAt: "",
    assignedTo: "",
  });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        data: {
          ...form,
          description: form.description || null,
          assignedTo: form.assignedTo || null,
          priority: form.priority as "low" | "normal" | "high",
          dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setOpen(false);
          setForm({ title: "", description: "", priority: "normal", dueAt: "", assignedTo: "" });
        },
      },
    );
  };
  return (
    <>
      <PageHeading
        eyebrow="Keep the next step close"
        title="Tasks"
        subtitle="Personal and assigned responsibilities, without the noise."
        action={
          <Button onClick={() => setOpen(!open)}>
            <Plus size={16} /> New task
          </Button>
        }
      />
      {open && (
        <form className="inline-form grid-form" onSubmit={submit}>
          <Field label="Task">
            <input
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <Field label="Description">
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          {canAssign && (
            <Field label="Assign to">
              <select
                value={form.assignedTo}
                onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
              >
                <option value="">Not assigned</option>
                {members.map((m) => (
                  <option key={m.uid} value={m.uid}>
                    {m.isCurrentUser ? `${m.name} (you)` : m.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Priority">
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </Field>
          <Field label="Due">
            <input
              type="datetime-local"
              value={form.dueAt}
              onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
            />
          </Field>
          <Button type="submit" disabled={create.isPending}>
            Save task <ArrowRight size={15} />
          </Button>
        </form>
      )}
      <MutationError errors={[create.error, update.error]} />
      {q.isLoading ? (
        <SkeletonRows />
      ) : q.isError ? (
        <ErrorPanel
          text={apiErrorMessage(q.error, "Tasks are unavailable.")}
          retry={() => void q.refetch()}
        />
      ) : q.data?.length ? (
        <div className="task-board">
          {q.data.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              assigneeName={nameFor}
              onStatus={(status) =>
                update.mutate({ taskId: task.id, data: { status } }, { onSuccess: invalidate })
              }
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title="Room for what comes next"
          description="Create a task when a responsibility needs a name and a next step."
        />
      )}
    </>
  );
}

export function TaskCard({
  task,
  onStatus,
  assigneeName,
}: {
  task: Task;
  assigneeName: (uid: string) => string;
  onStatus: (s: "todo" | "in_progress" | "blocked" | "completed") => void;
}) {
  return (
    <article className="task-card">
      <div className={`priority-dot ${task.priority}`} />
      <div className="task-copy">
        <h3>{task.title}</h3>
        {task.description && <p>{task.description}</p>}
        <small>
          {task.dueAt ? `Due ${new Date(task.dueAt).toLocaleDateString()}` : "No due date"}
          {task.assignedTo ? ` · Assigned to ${assigneeName(task.assignedTo)}` : ""}
        </small>
      </div>
      <select
        aria-label={`Update ${task.title} status`}
        value={task.status}
        onChange={(e) => onStatus(e.target.value as "todo" | "in_progress" | "blocked" | "completed")}
      >
        <option value="todo">To do</option>
        <option value="in_progress">In progress</option>
        <option value="blocked">Blocked</option>
        <option value="completed">Completed</option>
      </select>
    </article>
  );
}
