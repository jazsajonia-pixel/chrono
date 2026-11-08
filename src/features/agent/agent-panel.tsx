import { ShippedNote } from "@/features/git/shipped-note";
import { useOnline } from "@/hooks/use-online";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, ChevronDown, Circle, Clock3, History, Image as ImageIcon, KeyRound, Loader2, Paperclip, Plus, RotateCw, Sparkles, Trash2, XCircle } from "lucide-react";
import { BottomSheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/states";
import { useProviders } from "@/features/ai/use-providers";
import { useWorkspace } from "@/features/workspace/context";
import { AppError, isErrorCode } from "@/lib/errors";
import { safeStorage } from "@/lib/storage";
import { projectPath } from "@/lib/nav";
import { MAX_AGENT_STEPS } from "@/lib/agent-tools";
import type { AgentMode } from "@/types/agent";
import { Composer, type QuickAction } from "./composer";
import { Markdown } from "./markdown";
import { PlanCard } from "./plan-card";
import { ProposalSummary, ReviewSheet } from "./proposal-review";
import { resultsById, splitUserMessage, type AgentActivityRun, type AgentTask } from "./task";
import { ToolRow } from "./tool-row";
import { useAgent, type AgentProject } from "./use-agent";
import type { AgentActivity } from "./activity";

function ActivityCard({ task, onRetry, changedFilesOverride, messageStartIndex }: { task: AgentTask; onRetry?: () => void; changedFilesOverride?: number; messageStartIndex?: number }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const activities = task.activities ?? [];
  const visible = activities.slice(-8);
  const active = visible.find((item) => item.status === "running") ?? null;
  const completedCount = activities.filter((item) => item.status === "completed").length;
  const failedCount = activities.filter((item) => item.status === "failed").length;
  const reviewedFiles = new Set(activities.filter((item) => item.tool === "read_file" && item.status === "completed" && item.target).map((item) => item.target)).size;
  const changedFiles = changedFilesOverride ?? Object.values(task.proposal).filter((file) => file.decision !== "rejected").length;
  const lastUserMessageIndex = task.messages.map((message, index) => (message.role === "user" ? index : -1)).reduce((last, index) => Math.max(last, index), 0);
  const technicalMessages = task.messages.slice(messageStartIndex ?? task.activityStartMessageIndex ?? lastUserMessageIndex);
  const knowledgeSaves = technicalMessages.flatMap((message) => (message.role === "assistant" ? (message.toolCalls ?? []) : [])).filter((call) => call.name === "save_knowledge");
  const validation = [...activities].reverse().find((item) => item.tool === "request_preview" && (item.status === "completed" || item.status === "failed"));
  const currentTitle = active?.title ?? (task.status === "running" ? "Thinking through your request" : task.status === "awaiting_plan" ? "Waiting for your approval" : task.status === "error" ? "Request ended with an error" : task.status === "stopped" ? "Request stopped" : task.status === "step_limit" ? "Request paused" : "Work complete");
  const statusIcon = (item: AgentActivity) => {
    if (item.status === "running") return <Loader2 className="size-4 animate-spin text-primary" aria-label="In progress" />;
    if (item.status === "completed") return <CheckCircle2 className="size-4 text-primary" aria-label="Completed" />;
    if (item.status === "failed") return <XCircle className="size-4 text-danger" aria-label="Failed" />;
    return <Circle className="size-3.5 text-muted-foreground" aria-label="Queued" />;
  };
  return (
    <section className="rounded-xl border border-primary/20 bg-primary/[0.04] p-3.5" aria-live="polite" data-testid="agent-activity-card">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary/12 text-primary">
          {task.status === "running" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{task.status === "running" ? "Working on your request" : currentTitle}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{active?.detail ?? (completedCount ? `${completedCount} step${completedCount === 1 ? "" : "s"} completed` : "Keeping you updated as I work")}</p>
        </div>
      </div>
      {visible.length ? (
        <ol className="mt-3 space-y-2 border-l border-primary/15 pl-4">
          {visible.map((item) => (
            <li key={item.id} className="relative flex min-w-0 items-start gap-2 text-xs">
              <span className="absolute -left-[1.32rem] top-0.5 grid size-4 place-items-center bg-background">{statusIcon(item)}</span>
              <span className={item.status === "queued" ? "text-muted-foreground" : "text-foreground"}>
                <span className="block truncate">{item.title}</span>
                {item.detail ? <span className="block truncate text-[11px] text-muted-foreground">{item.detail}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {/* Knowledge saves stay visible (with Undo) so nothing is remembered silently. */}
      {!detailsOpen && knowledgeSaves.length ? (
        <ul className="mt-3 space-y-1.5" aria-label="Saved to knowledge" data-testid="list-knowledge-saves">
          {knowledgeSaves.map((call) => <ToolRow key={call.id} call={call} result={resultsById(task.messages).get(call.id)} running={task.status === "running"} />)}
        </ul>
      ) : null}
      {activities.length > 0 ? (
        <button type="button" onClick={() => setDetailsOpen((open) => !open)} className="mt-3 inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground" aria-expanded={detailsOpen}>
          <ChevronDown className={`size-3.5 transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
          {detailsOpen ? "Hide technical details" : "Show technical details"}
        </button>
      ) : null}
      {detailsOpen ? (
        <ul className="mt-2 space-y-1.5" aria-label="Technical tool details">
          {technicalMessages.flatMap((message) => message.role === "assistant" ? (message.toolCalls ?? []) : []).map((call) => {
            const result = resultsById(task.messages).get(call.id);
            return <ToolRow key={call.id} call={call} result={result} running={task.status === "running"} />;
          })}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-primary/10 pt-2 text-[11px] text-muted-foreground">
        {reviewedFiles ? <span>{reviewedFiles} file{reviewedFiles === 1 ? "" : "s"} inspected</span> : null}
        {changedFiles ? <span>{changedFiles} change{changedFiles === 1 ? "" : "s"} prepared</span> : null}
        {validation ? <span className={validation.status === "failed" || validation.detail === "Validation found an issue" ? "text-warning" : "text-primary"}>{validation.detail}</span> : null}
        {failedCount && onRetry ? <button type="button" onClick={onRetry} className="font-medium text-danger hover:underline">Retry failed step{failedCount === 1 ? "" : "s"}</button> : failedCount ? <span className="text-danger">A step needs attention</span> : null}
        <span className="ml-auto inline-flex items-center gap-1"><Clock3 className="size-3" /> Updated {new Date(task.updatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
      </div>
    </section>
  );
}

function Timeline({ task, onApprove, onRevise }: { task: AgentTask; onApprove: () => void; onRevise: (f: string) => void }) {
  const results = useMemo(() => resultsById(task.messages), [task.messages]);
  const planId = task.status === "awaiting_plan" ? task.pending[0]?.id : null;
  return (
    <ol className="min-w-0 space-y-4">
      {task.messages.map((m, i) => {
        if (m.role === "tool") return null;
        const historicalRuns: AgentActivityRun[] = (task.activityHistory ?? []).filter((run) => run.afterMessageIndex === i);
        const activityCards = historicalRuns.map((run) => {
          const historicalTask: AgentTask = { ...task, status: run.status, activities: run.activities, updatedAt: run.updatedAt, messages: task.messages.slice(run.startMessageIndex, i + 1), proposal: {} };
          return <li key={`activity-${run.id}`} className="list-none"><ActivityCard task={historicalTask} changedFilesOverride={run.changedFiles} messageStartIndex={0} /></li>;
        });
        if (m.role === "user") {
          const { text, files } = splitUserMessage(m.content);
          return (
            <Fragment key={i}><li className="animate-enter flex min-w-0 justify-end" data-testid="msg-user">
              <div className="min-w-0 max-w-[85%] rounded-xl rounded-br-sm bg-primary/15 px-3.5 py-2.5">
                <p className="whitespace-pre-wrap break-words text-sm">{text}</p>
                {files.length ? <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground"><Paperclip className="mr-1 inline size-3" aria-hidden />{files.join(", ")}</p> : null}{m.attachments?.length ? <div className="mt-2 flex flex-wrap gap-1.5">{m.attachments.map((a) => <span key={a.name} className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/5 px-2 py-1 text-[11px] text-primary">{a.mimeType.startsWith("image/") ? <ImageIcon className="size-3" aria-hidden /> : <Paperclip className="size-3" aria-hidden />}{a.name}</span>)}</div> : null}
              </div>
            </li>{activityCards}</Fragment>
          );
        }
        const calls = m.toolCalls ?? [];
        return (
          <Fragment key={i}><li className="animate-enter min-w-0 space-y-2" data-testid="msg-assistant">
            {m.content ? <Markdown text={m.content} /> : null}
            {calls.length ? (
              <ul className="space-y-1.5" aria-label="Plan calls">
                {calls.map((c) =>
                  c.name === "propose_plan" && c.args ? (
                    <li key={c.id} className="list-none">
                      <PlanCard call={c} result={results.get(c.id)} awaiting={c.id === planId} onApprove={onApprove} onRevise={onRevise} />
                    </li>
                  ) : null,
                )}
              </ul>
            ) : null}
          </li>{activityCards}</Fragment>
        );
      })}
    </ol>
  );
}

function StatusLine({ task, onResume }: { task: AgentTask; onResume: () => void }) {
  if (task.status === "running") {
    const active = task.pending[0];
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="status-running">
        <Loader2 className="size-4 animate-spin" /> {active ? "Running tools…" : "Thinking…"}
      </p>
    );
  }
  if (task.status === "error" && task.error) {
    const code = isErrorCode(task.error.code) ? task.error.code : "INTERNAL";
    return <ErrorState error={new AppError(code, task.error.message)} onRetry={onResume} />;
  }
  if (task.status === "stopped" || task.status === "step_limit") {
    return (
      <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground" data-testid="status-stopped">
        <span className="flex-1">{task.status === "stopped" ? "Stopped." : `Paused after ${MAX_AGENT_STEPS} steps.`}</span>
        <Button size="sm" variant="secondary" onClick={onResume} data-testid="button-resume-agent">
          <RotateCw /> Continue
        </Button>
      </div>
    );
  }
  return null;
}

export function AgentPanel({ project }: { project: AgentProject }) {
  const ws = useWorkspace();
  const providers = useProviders();
  const agent = useAgent(project);
  // One-shot hand-off from other tabs (e.g. Preview → "Fix with AI").
  const [prefill] = useState(() => {
    const key = `agent-prefill:${ws.source.storageKey}`;
    const raw = safeStorage.get(key, "session");
    if (!raw) return null;
    try {
      const v = JSON.parse(raw) as { text?: unknown; mode?: unknown };
      return typeof v.text === "string" ? { text: v.text, mode: v.mode === "ask" ? ("ask" as const) : ("agent" as const) } : null;
    } catch {
      return null;
    }
  });
  const [mode, setMode] = useState<AgentMode>(prefill?.mode ?? agent.task?.mode ?? "agent");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const task = agent.task;

  // A hand-off starts a fresh task.
  useEffect(() => {
    if (!prefill) return;
    safeStorage.remove(`agent-prefill:${ws.source.storageKey}`, "session"); // consume once (after mount; StrictMode-safe)
    agent.startNew();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (task && !prefill) setMode(task.mode);
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the conversation as it grows.
  const size = task ? task.messages.length + Object.keys(task.proposal).length + (task.activities ?? []).length + task.status.length : 0;
  useEffect(() => {
    const el = scroller.current;
    if (el && el.dataset.following === "true") el.scrollTop = el.scrollHeight;
  }, [size]);

  function handleScroll() {
    const el = scroller.current;
    if (!el) return;
    el.dataset.following = String(el.scrollHeight - el.scrollTop - el.clientHeight < 96);
  }

  const ready = providers.state.status === "ready" ? providers.state.data : null;
  const def = ready?.providers.find((p) => p.id === ready.defaultId) ?? null;
  const online = useOnline();
  const needsProvider = providers.state.status === "ready" && !def;
  const providerLabel = def ? `${def.label} · ${def.model}` : providers.state.status === "loading" ? "Loading provider…" : "No provider";

  const active = ws.data.active;
  const quick: QuickAction[] = [
    ...(active
      ? [
          { label: "Explain this", mode: "ask" as const, text: `Explain how @${active} works.` },
          { label: "Fix this", mode: "agent" as const, text: `Fix the bug in @${active}: ` },
          { label: "Find bugs", mode: "ask" as const, text: `Find bugs or risky code in @${active}.` },
        ]
      : []),
    { label: "Explain the project", mode: "ask", text: "Explain how this project is structured and how it works." },
    { label: "Implement…", mode: "agent", text: "Implement: " },
    { label: "Review changes", mode: "ask", text: "Review my uncommitted changes (use get_git_status with include_diff) and point out bugs or improvements." },
  ];

  const composer = (
    <Composer
      mode={mode}
      onModeChange={setMode}
      running={agent.running}
      disabled={needsProvider || !online}
      placeholder={!online ? "You're offline — the agent needs a connection" : task?.status === "awaiting_plan" ? "Suggest plan changes…" : mode === "ask" ? "Ask about the code…" : "Describe a change…"}
      paths={ws.paths}
      activeFile={active}
      quickActions={task ? [] : quick}
      onSend={(text, attach, uploads) => void agent.send(text, { mode, attach, uploads })}
      onStop={agent.stop}
      initialText={prefill?.text}
    />
  );
  const welcome = !task && !needsProvider && providers.state.status !== "error";

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
        <Link href="/app/settings/ai" className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1.5 hover:bg-surface-2" data-testid="link-agent-provider">
          <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="truncate font-mono text-xs">{providerLabel}</span>
        </Link>
        <Button variant="ghost" size="icon" aria-label="Task history" onClick={() => setHistoryOpen(true)} data-testid="button-agent-history">
          <History />
        </Button>
        <Button variant="ghost" size="icon" aria-label="New task" onClick={agent.startNew} disabled={!task} data-testid="button-new-task">
          <Plus />
        </Button>
      </div>

      {welcome ? (
        // No conversation yet: the greeting and the composer sit together in the middle.
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col justify-center px-3 py-6 sm:px-6" data-testid="agent-scroll">
          <div className="mx-auto w-full min-w-0 max-w-2xl">
            <div className="animate-enter mb-6 text-center">
              <span className="mx-auto grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
                <Sparkles className="size-5" aria-hidden />
              </span>
              <h2 className="mt-3 text-lg font-semibold tracking-tight">Ask about {project.repo}</h2>
              <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
                Ask answers questions. Agent inspects the repo, shows a plan, and proposes edits you review as diffs — nothing reaches GitHub until you commit.
              </p>
            </div>
            <div className="animate-enter [animation-delay:80ms]">{composer}</div>
            {!agent.storageOk ? <p className="mt-3 text-center text-xs text-warning">This browser's storage is full — task history won't survive a reload.</p> : null}
          </div>
        </div>
      ) : (
        <>
          <div ref={scroller} onScroll={handleScroll} data-following="true" className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 sm:px-6" data-testid="agent-scroll">
            <div className="mx-auto w-full min-w-0 max-w-3xl">
              {needsProvider ? (
                <EmptyState
                  icon={<KeyRound className="size-6" />}
                  title="Add an AI provider"
                  action={
                    <Button asChild>
                      <Link href="/app/settings/ai">Open AI providers</Link>
                    </Button>
                  }
                >
                  The agent uses your default provider (OpenAI, Anthropic, Gemini, OpenRouter or compatible). Keys stay on the server.
                </EmptyState>
              ) : providers.state.status === "error" ? (
                <ErrorState error={providers.state.error} onRetry={providers.reload} />
              ) : task ? (
                <div className="min-w-0 space-y-4">
                  <Timeline task={task} onApprove={() => agent.approvePlan()} onRevise={agent.revisePlan} />
                  {task.status === "running" || (task.activities ?? []).length > 0 ? <ActivityCard task={task} onRetry={agent.resume} /> : null}
                  <StatusLine task={task} onResume={agent.resume} />
                  {task.shipped ? <ShippedNote info={task.shipped} /> : null}
                  {task.provider && task.status === "done" ? (
                    <p className="text-center font-mono text-[10px] text-muted-foreground">
                      {task.provider.label} · {task.provider.model}
                      {task.usage.inputTokens ? ` · ${task.usage.inputTokens + task.usage.outputTokens} tokens` : ""}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {!agent.storageOk ? <p className="mt-3 text-center text-xs text-warning">This browser's storage is full — task history won't survive a reload.</p> : null}
            </div>
          </div>

          <div className="shrink-0 px-3 pb-3 pt-1 sm:px-6 sm:pb-4">
            <div className="mx-auto w-full min-w-0 max-w-3xl">
              {task ? <ProposalSummary proposal={task.proposal} onReview={() => setReviewOpen(true)} previewHref={projectPath(project.owner, project.repo, "preview")} /> : null}
              {composer}
            </div>
          </div>
        </>
      )}

      {task ? (
        <ReviewSheet
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          proposal={task.proposal}
          onAccept={agent.accept}
          onReject={agent.reject}
          conflictsFor={agent.conflictsFor}
        />
      ) : null}

      <BottomSheet open={historyOpen} onOpenChange={setHistoryOpen} title="Tasks" description={`Saved on this device for ${project.repo} @ ${project.branch}.`}>
        {agent.tasks.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No tasks yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {agent.tasks.map((t) => (
              <li key={t.id} className="flex items-center">
                <button
                  type="button"
                  onClick={() => {
                    agent.selectTask(t.id);
                    setHistoryOpen(false);
                  }}
                  className="min-w-0 flex-1 px-3 py-2.5 text-left"
                  data-testid={`task-${t.id}`}
                >
                  <span className="block truncate text-sm font-medium">{t.title}</span>
                  <span className="block font-mono text-[11px] text-muted-foreground">
                    {t.mode} · {t.status.replace("_", " ")} · {new Date(t.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </span>
                </button>
                <Button variant="ghost" size="icon" aria-label={`Delete task ${t.title}`} onClick={() => agent.removeTask(t.id)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button
          className="mt-3 w-full"
          variant="secondary"
          onClick={() => {
            agent.startNew();
            setHistoryOpen(false);
          }}
        >
          <Plus /> New task
        </Button>
      </BottomSheet>
    </div>
  );
}
