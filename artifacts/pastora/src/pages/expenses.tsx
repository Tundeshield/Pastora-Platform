import { useQueryClient } from "@tanstack/react-query";
import {
  getGetDashboardQueryKey,
  getListExpensesQueryKey,
  useCreateExpense,
  useListExpenses,
  useUpdateExpense,
} from "@workspace/api-client-react";
import { Check, CircleHelp, Plus, Receipt, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Badge, Button, EmptyState, ErrorPanel, Field, PageHeading, SkeletonRows } from "@/components/ui-kit";

export function ExpensesPage() {
  const q = useListExpenses({ query: { queryKey: getListExpensesQueryKey(), retry: 1 } });
  const create = useCreateExpense();
  const update = useUpdateExpense();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ description: "", purpose: "", amount: "", department: "" });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: getListExpensesQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(
      {
        data: {
          ...form,
          amount: Number(form.amount),
          department: form.department || null,
          receiptPath: null,
        },
      },
      {
        onSuccess: () => {
          invalidate();
          setOpen(false);
        },
      },
    );
  };
  return (
    <>
      <PageHeading
        eyebrow="Church operations"
        title="Expenses"
        subtitle="Requests for spending, with a clear review path."
        action={
          <Button onClick={() => setOpen(!open)}>
            <Plus size={16} /> Submit expense
          </Button>
        }
      />
      {open && (
        <form className="inline-form grid-form" onSubmit={submit}>
          <Field label="Expense">
            <input
              required
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
          <Field label="Purpose">
            <textarea
              required
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
            />
          </Field>
          <Field label="Amount (NGN)">
            <input
              required
              min="0.01"
              type="number"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </Field>
          <Field label="Department">
            <input
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value })}
            />
          </Field>
          <div className="receipt-warning">
            <Receipt size={16} /> Receipt upload is unavailable until secure storage is configured. No file
            has been uploaded.
          </div>
          <Button type="submit" disabled={create.isPending}>
            Submit request
          </Button>
        </form>
      )}
      {q.isLoading ? (
        <SkeletonRows />
      ) : q.isError ? (
        <ErrorPanel text="Expense requests are unavailable." retry={() => void q.refetch()} />
      ) : q.data?.length ? (
        <div className="table-card">
          <div className="table-head expense-head">
            <span>Expense</span>
            <span>Department</span>
            <span>Amount</span>
            <span>Status</span>
            <span>Review</span>
          </div>
          {q.data.map((x) => (
            <div className="table-row expense-head" key={x.id}>
              <div>
                <b>{x.description}</b>
                <small>{x.purpose}</small>
              </div>
              <span>{x.department || "—"}</span>
              <b>
                {x.currency} {x.amount.toLocaleString()}
              </b>
              <Badge label={x.status} />
              <div className="expense-actions">
                {x.status === "submitted" ? (
                  <>
                    <button
                      onClick={() =>
                        update.mutate(
                          { expenseId: x.id, data: { status: "approved" } },
                          { onSuccess: invalidate },
                        )
                      }
                      aria-label="Approve expense"
                    >
                      <Check size={17} />
                    </button>
                    <button
                      onClick={() =>
                        update.mutate(
                          { expenseId: x.id, data: { status: "rejected" } },
                          { onSuccess: invalidate },
                        )
                      }
                      aria-label="Reject expense"
                    >
                      <X size={17} />
                    </button>
                    <button
                      onClick={() => {
                        const text = window.prompt("What needs clarification?");
                        if (text)
                          update.mutate(
                            { expenseId: x.id, data: { status: "clarification", clarification: text } },
                            { onSuccess: invalidate },
                          );
                      }}
                      aria-label="Request clarification"
                    >
                      <CircleHelp size={17} />
                    </button>
                  </>
                ) : x.status === "approved" ? (
                  <button
                    onClick={() => {
                      const ref = window.prompt("Payment reference (optional)");
                      if (ref !== null)
                        update.mutate(
                          { expenseId: x.id, data: { status: "paid", paymentReference: ref || null } },
                          { onSuccess: invalidate },
                        );
                    }}
                  >
                    Mark paid
                  </button>
                ) : (
                  <span>—</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No expenses to review"
          description="Expense requests will appear here when submitted."
        />
      )}
    </>
  );
}
