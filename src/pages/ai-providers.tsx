import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, KeyRound, Plus } from "lucide-react";
import { AppShell, PageIntro } from "@/components/layout/app-shell";
import { ConfirmSheet } from "@/components/dialogs";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { deleteProvider } from "@/features/ai/api";
import { ProviderCard } from "@/features/ai/provider-card";
import { ProviderForm } from "@/features/ai/provider-form";
import { StorageNotice } from "@/features/ai/storage-notice";
import { useProviders } from "@/features/ai/use-providers";
import type { PublicProvider } from "@/types/ai";

export default function AIProvidersPage() {
  const { state, reload, apply } = useProviders();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PublicProvider | null>(null);
  const [removing, setRemoving] = useState<PublicProvider | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const data = state.status === "ready" ? state.data : null;
  const userCount = data?.providers.filter((p) => p.source === "user").length ?? 0;
  const visibleProviders = data?.providers ?? [];
  const canAdd = !!data && data.storage !== "unavailable" && userCount < data.maxProviders;

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <AppShell
      title="AI providers"
      width="narrow"
      actions={
        canAdd ? (
          <Button size="sm" onClick={openAdd} data-testid="button-add-provider">
            <Plus /> Add
          </Button>
        ) : null
      }
    >
      <Link href="/app/settings" className="-ml-1 -mt-2 mb-2 inline-flex h-11 items-center gap-1.5 px-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Settings
      </Link>
      <PageIntro>Add your own API key, choose a model and make it the default for the agent.</PageIntro>

      {state.status === "loading" ? (
        <div className="space-y-3" aria-label="Loading providers">
          <Skeleton className="h-24" />
          <Skeleton className="h-36" />
        </div>
      ) : state.status === "error" ? (
        <ErrorState error={state.error} onRetry={reload} />
      ) : (
        <div className="space-y-4">
          <StorageNotice data={state.data} />
          {actionError ? <ErrorState error={actionError} onRetry={() => setActionError(null)} /> : null}

          {visibleProviders.length === 0 ? (
            <EmptyState
              icon={<KeyRound className="size-6" />}
              title="No AI providers yet"
              action={
                canAdd ? (
                  <Button onClick={openAdd} data-testid="button-add-first-provider">
                    <Plus /> Add provider
                  </Button>
                ) : null
              }
            >
              Chrono uses the server-managed Google Gemini provider by default. Other account providers may be added, but they cannot replace Gemini as the platform default.
            </EmptyState>
          ) : (
            <div className="space-y-3" data-testid="list-providers">
              {visibleProviders.map((p) => (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  onChanged={(d) => {
                    setActionError(null);
                    apply(d);
                  }}
                  onError={setActionError}
                  geminiModels={data?.geminiModels}
                  onEdit={() => {
                    setEditing(p);
                    setFormOpen(true);
                  }}
                  onRemove={() => setRemoving(p)}
                />
              ))}
            </div>
          )}

          {data && userCount >= data.maxProviders && data.storage !== "unavailable" ? (
            <p className="text-center text-xs text-muted-foreground">Limit of {data.maxProviders} providers reached for {data.storage === "session" ? "session-only" : "saved"} storage.</p>
          ) : null}

          <ProviderForm open={formOpen} onOpenChange={setFormOpen} editing={editing} storageNote={state.data.storageNote} onSaved={apply} />
        </div>
      )}

      <ConfirmSheet
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.label ?? "provider"}?`}
        description="The encrypted key is deleted from this app. Revoke it in the provider's dashboard too if you no longer need it."
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!removing) return;
          try {
            apply(await deleteProvider(removing.id));
            setActionError(null);
          } catch (err) {
            setActionError(err);
          }
        }}
      />
    </AppShell>
  );
}
