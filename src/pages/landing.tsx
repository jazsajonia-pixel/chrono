import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { ArrowRight, ArrowUpRight, GitBranch, GitPullRequestArrow, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GitHubIcon, Wordmark } from "@/components/brand";
import { useSession } from "@/stores/session";

const STEPS = [
  { title: "Connect", body: "Sign in with GitHub and open any repository you can access." },
  { title: "Ask", body: "Describe the change. The agent reads the code and writes a plan." },
  { title: "Review", body: "Every edit arrives as a diff you accept or reject, file by file." },
  { title: "Preview", body: "Run the app in the browser or on a live server, unsaved edits included." },
  { title: "Ship", body: "Commit to a working branch, push, and open a pull request." },
] as const;

const FEATURES = [
  { title: "The repo you already trust", body: "Branches, files and commit history load straight from GitHub, at the branch you pick." },
  { title: "An agent that shows its work", body: "Requests become a visible plan, then reviewable diffs. Nothing is written until you accept it." },
  { title: "A preview of the real app", body: "Static sites and Vite apps run in the browser; Node projects such as Next.js run on a temporary live server." },
  { title: "Made for one hand", body: "Bottom sheets, 44 px touch targets and a keyboard-aware editor, tested on phone-sized screens." },
  { title: "Your choice of model", body: "OpenAI, Anthropic, Gemini, OpenRouter or any OpenAI-compatible endpoint, with keys kept on the server." },
  { title: "Branch first, always", body: "Changes go to an ai/ branch so main stays untouched until you merge the pull request." },
] as const;

/** Sections fade in once as they scroll into view. Content stays visible without JS or with reduced motion. */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof IntersectionObserver === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    root.classList.add("reveal-ready");
    const io = new IntersectionObserver(
      (entries) => entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      }),
      { rootMargin: "0px 0px -8% 0px" },
    );
    root.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return ref;
}

/** A static picture of the workspace: a file, a proposed change and the branch it lands on. */
function WorkspacePicture() {
  return (
    <figure className="ws-frame" aria-label="Chrono workspace: the agent proposes a one-line change to App.jsx on the ai/task-count branch">
      <div className="ws-bar">
        <span className="ws-repo"><span>octo/</span>pocket-tasks</span>
        <span className="ws-branch"><GitBranch aria-hidden /> ai/task-count</span>
      </div>
      <div className="ws-tabs"><span className="is-active">App.jsx</span><span>TaskList.jsx</span></div>
      <pre className="ws-code" aria-hidden="true">
        <span><b>1</b><em>import</em> TaskList <em>from</em> <u>"./TaskList"</u></span>
        <span><b>2</b></span>
        <span><b>3</b><em>export default function</em> <strong>App</strong>({"{ tasks }"}) {"{"}</span>
        <span className="ws-add"><b>4</b>+ <em>const</em> remaining = tasks.filter((t) =&gt; !t.done)</span>
        <span><b>5</b>  <em>return</em> &lt;TaskList tasks={"{remaining}"} /&gt;</span>
        <span><b>6</b>{"}"}</span>
      </pre>
      <figcaption className="ws-plan">
        <span className="ws-plan-title">Show only open tasks</span>
        <span className="ws-plan-meta">1 file · 1 line added · waiting for your review</span>
        <span className="ws-plan-actions"><span className="ws-btn">Reject</span><span className="ws-btn is-primary">Accept</span></span>
      </figcaption>
      <div className="ws-tabbar" aria-hidden="true"><span>Files</span><span className="is-active">AI</span><span>Preview</span><span>Git</span></div>
    </figure>
  );
}

export default function LandingPage() {
  const { isAuthed } = useSession();
  const revealRef = useReveal();
  const appHref = isAuthed ? "/app" : "/signin";
  return (
    <div ref={revealRef} className="landing-page min-h-dvh overflow-x-hidden">
      <header className="landing-nav mx-auto flex h-16 max-w-6xl items-center justify-between px-5 pt-safe lg:h-20 lg:px-8">
        <Link href="/" className="rounded-md" aria-label="Chrono home"><Wordmark appearance="dark" /></Link>
        <nav className="hidden items-center gap-7 text-sm md:flex" aria-label="Landing navigation">
          <a href="#workflow">How it works</a>
          <a href="#features">Features</a>
          <a href="#security">Security</a>
        </nav>
        <Button asChild variant="ghost" size="sm" className="landing-signin">
          <Link href={appHref} data-testid="link-signin">{isAuthed ? "Open app" : "Sign in"}<ArrowUpRight className="ml-1 size-3.5" /></Link>
        </Button>
      </header>

      <main id="main">
        <section className="hero-section">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-8 lg:grid-cols-[1fr_1fr] lg:gap-16 lg:px-8 lg:pb-24 lg:pt-14">
            <div className="hero-copy">
              <h1>Edit, preview and ship your GitHub repos from your phone.</h1>
              <p className="hero-lede">
                Open a repository, ask the AI agent for a change, review the diff, run the app, and commit to a branch — without a laptop.
              </p>
              <div className="hero-actions">
                <Button asChild size="lg" className="hero-cta" data-testid="button-start-building">
                  <Link href={appHref}>{isAuthed ? "Open your projects" : <><GitHubIcon /> Continue with GitHub</>}</Link>
                </Button>
                <a href="#workflow" className="hero-secondary">How it works <ArrowRight aria-hidden /></a>
              </div>
            </div>
            <div className="hero-visual"><WorkspacePicture /></div>
          </div>
        </section>

        <section id="workflow" aria-labelledby="workflow-heading" className="reveal section-shell mx-auto max-w-6xl px-5 py-20 lg:px-8 lg:py-28">
          <h2 id="workflow-heading">From request to pull request</h2>
          <ol className="steps">
            {STEPS.map((s) => (
              <li key={s.title}>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="features" aria-labelledby="features-heading" className="reveal section-shell mx-auto max-w-6xl px-5 pb-20 lg:px-8 lg:pb-28">
          <h2 id="features-heading">Everything between a repo and a merge</h2>
          <dl className="feature-list">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <dt>{f.title}</dt>
                <dd>{f.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="security" aria-labelledby="security-heading" className="reveal section-shell mx-auto max-w-6xl px-5 pb-20 lg:px-8 lg:pb-28">
          <div className="security-panel">
            <div>
              <h2 id="security-heading">Your code and keys stay where they belong</h2>
              <p>GitHub tokens and AI provider keys live in encrypted, HTTP-only cookies or server storage. Browser JavaScript never sees them.</p>
            </div>
            <ul>
              <li><KeyRound aria-hidden /><span>AI provider keys are only used by server functions.</span></li>
              <li><GitHubIcon /><span>GitHub sign-in with the smallest scope that works. Public repositories only, unless you opt in.</span></li>
              <li><GitPullRequestArrow aria-hidden /><span>Every change lands on a working branch first.</span></li>
              <li><ShieldCheck aria-hidden /><span>Live previews run in an isolated sandbox that shuts down after 10 minutes.</span></li>
            </ul>
          </div>
        </section>

        <section className="reveal final-cta-section">
          <div className="mx-auto max-w-3xl px-5 py-20 text-center lg:py-28">
            <h2>Open a repository and try it.</h2>
            <p>Chrono is in early access. All you need is a GitHub account.</p>
            <Button asChild size="lg" className="hero-cta mt-8">
              <Link href={appHref}>{isAuthed ? "Open your projects" : <><GitHubIcon /> Continue with GitHub</>}</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-7 text-xs sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <Wordmark appearance="dark" className="opacity-80" />
          <span>Built for developers who code from their phone.</span>
        </div>
      </footer>
    </div>
  );
}
