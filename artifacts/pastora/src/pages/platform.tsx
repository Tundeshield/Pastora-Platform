import { getListPlatformWorkspacesQueryKey, useListPlatformWorkspaces } from "@workspace/api-client-react";
import { LockKeyhole } from "lucide-react";

import { Badge, EmptyState, ErrorPanel, Header, PageHeading, SkeletonRows } from "@/components/ui-kit";

export function PlatformPage() {
  const q = useListPlatformWorkspaces({ query: { queryKey: getListPlatformWorkspacesQueryKey(), retry: 1 } });
  return (
    <div className="platform-page">
      <Header app />
      <main className="inner-page">
        <PageHeading
          eyebrow="Platform owner"
          title="Workspaces"
          subtitle="Restricted platform operations view."
        />
        <div className="care-private-banner">
          <LockKeyhole size={17} /> Access is role restricted. No workspace records are visible unless your
          account is authorised.
        </div>
        {q.isLoading ? (
          <SkeletonRows />
        ) : q.isError ? (
          <ErrorPanel text="Workspace list is restricted or unavailable." retry={() => void q.refetch()} />
        ) : q.data?.length ? (
          <div className="table-card">
            <div className="table-head">
              <span>Workspace</span>
              <span>Status</span>
              <span>Plan</span>
              <span>Created</span>
            </div>
            {q.data.map((w) => (
              <div className="table-row" key={w.id}>
                <b>{w.name}</b>
                <Badge label={w.status} />
                <span>{w.plan}</span>
                <span>{new Date(w.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No visible workspaces"
            description="Authorised platform workspaces will appear here."
          />
        )}
      </main>
    </div>
  );
}
