import { useEffect, useRef, type MouseEvent, type MutableRefObject } from "react";
import { Link } from "wouter";
import { ArrowRight, ArrowUpRight, Check, GitBranch, GitPullRequestArrow, KeyRound, ScanSearch, ShieldCheck, Sparkles } from "lucide-react";
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
  { title: "At home on any screen", body: "A sidebar workspace with keyboard shortcuts on desktop; bottom sheets and a keyboard-aware editor on phones." },
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

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Drives the hero's parallax layers from scroll position (one rAF per frame, off with reduced motion). */
function useDepthMotion() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || reducedMotion()) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = Math.min(window.scrollY, 1600);
      root.style.setProperty("--scroll-depth", `${y}px`);
      root.style.setProperty("--hero-tilt", `${Math.min(y * 0.006, 7)}deg`);
      root.style.setProperty("--hero-scale", `${1 - Math.min(y * 0.000025, 0.035)}`);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  return ref;
}

/**
 * The app uses hash routing (#/signin), so plain #section links would change the route.
 * Scroll to the section instead and move focus there for keyboard and screen-reader users.
 */
function scrollToSection(e: MouseEvent, id: string) {
  e.preventDefault();
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  el.focus({ preventScroll: true });
}

/** The floating workspace card: a file, the agent's proposed line, and the branch it lands on. */
function WorkspacePreview() {
  return (
    <div className="workspace-stage" aria-hidden="true">
      <div className="workspace-orbit workspace-orbit-one" />
      <div className="workspace-orbit workspace-orbit-two" />
      <div className="workspace-card workspace-card-main">
        <div className="workspace-topbar">
          <div className="workspace-dots"><i /><i /><i /></div>
          <span className="workspace-pill">AI WORKSPACE</span>
          <span className="workspace-status"><span /> Ready</span>
        </div>
        <div className="workspace-body">
          <aside className="workspace-sidebar">
            <span className="workspace-side-title">PROJECT</span>
            <strong><span className="folder-glyph">⌁</span> pocket-tasks</strong>
            <div className="workspace-tree"><span>src</span><span className="active-file">App.jsx</span><span>TaskList.jsx</span><span>package.json</span></div>
            <div className="workspace-sidebar-foot"><span /> ai/task-count</div>
          </aside>
          <div className="workspace-editor">
            <div className="editor-tabs"><span className="tab-active">App.jsx</span><span>TaskList.jsx</span><span className="editor-actions">•••</span></div>
            <div className="code-lines">
              <span><b>01</b> <em>import</em> <strong>TaskList</strong> <em>from</em> <u>"./TaskList"</u></span>
              <span><b>02</b> </span>
              <span><b>03</b> <em>export default function</em> <strong>App</strong>({"{ tasks }"}) {"{"}</span>
              <span className="code-add"><b>04</b> + <em>const</em> remaining = tasks.filter((t) =&gt; !t.done)</span>
              <span><b>05</b> &nbsp; <em>return</em> <u>&lt;TaskList tasks={"{remaining}"} /&gt;</u></span>
              <span><b>06</b> {"}"}</span>
            </div>
            <div className="editor-footer"><span><GitBranch /> ai/task-count</span><span><ScanSearch /> 1 change</span></div>
          </div>
        </div>
        <div className="workspace-bottom"><span>Files</span><span className="bottom-active"><Sparkles /> AI</span><span>Preview</span><span>Git</span></div>
      </div>
      <div className="workspace-float workspace-float-plan">
        <span className="float-icon"><Sparkles /></span>
        <div><small>AGENT PLAN</small><strong>Show only open tasks</strong><span>1 file · ready to review</span></div>
        <Check />
      </div>
      <div className="workspace-float workspace-float-branch"><GitBranch /><span>ai/task-count</span><i>●</i></div>
    </div>
  );
}

export default function LandingPage() {
  const { isAuthed } = useSession();
  const revealRef = useReveal();
  const depthRef = useDepthMotion();
  const setRoot = (node: HTMLDivElement | null) => {
    (revealRef as MutableRefObject<HTMLDivElement | null>).current = node;
    (depthRef as MutableRefObject<HTMLDivElement | null>).current = node;
  };
  const appHref = isAuthed ? "/app" : "/signin";
  return (
    <div ref={setRoot} className="landing-page min-h-dvh overflow-x-hidden">
      <header className="landing-nav mx-auto flex h-16 max-w-6xl items-center justify-between px-5 pt-safe lg:h-20 lg:px-8">
        <Link href="/" className="rounded-md" aria-label="Chrono home"><Wordmark appearance="dark" /></Link>
        <nav className="hidden items-center gap-7 text-sm md:flex" aria-label="Landing navigation">
          <a href="#workflow" onClick={(e) => scrollToSection(e, "workflow")}>How it works</a>
          <a href="#features" onClick={(e) => scrollToSection(e, "features")}>Features</a>
          <a href="#security" onClick={(e) => scrollToSection(e, "security")}>Security</a>
        </nav>
        <Button asChild variant="ghost" size="sm" className="landing-signin">
          <Link href={appHref} data-testid="link-signin">{isAuthed ? "Open app" : "Sign in"}<ArrowUpRight className="ml-1 size-3.5" /></Link>
        </Button>
      </header>

      <main id="main">
        <section className="hero-section">
          <div className="hero-grid" aria-hidden="true" />
          <div className="hero-glow hero-glow-a" aria-hidden="true" />
          <div className="hero-glow hero-glow-b" aria-hidden="true" />
          <div className="hero-depth-back" aria-hidden="true">
            <span className="depth-orb depth-orb-a" /><span className="depth-orb depth-orb-b" />
            <span className="depth-line depth-line-a" /><span className="depth-line depth-line-b" />
          </div>
          <div className="hero-inner mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-8 lg:grid-cols-[.92fr_1.08fr] lg:gap-12 lg:px-8 lg:pb-24 lg:pt-14">
            <div className="hero-copy">
              <h1>Build, preview and ship your GitHub projects <span className="hero-highlight">from anywhere.</span></h1>
              <p className="hero-lede">
                Open a repository, ask the AI agent for a change, review the diff, run the app and open a pull request — in one workspace that works the same on your desktop, tablet or phone.
              </p>
              <div className="hero-actions">
                <Button asChild size="lg" className="hero-cta" data-testid="button-start-building">
                  <Link href={appHref}>{isAuthed ? "Open your projects" : <><GitHubIcon /> Continue with GitHub</>}</Link>
                </Button>
                <a href="#workflow" className="hero-secondary" onClick={(e) => scrollToSection(e, "workflow")} data-testid="link-how-it-works">How it works <ArrowRight aria-hidden /></a>
              </div>
            </div>
            <div className="hero-visual"><WorkspacePreview /></div>
          </div>
        </section>

        <section id="workflow" tabIndex={-1} aria-labelledby="workflow-heading" className="reveal section-shell mx-auto max-w-6xl px-5 py-20 lg:px-8 lg:py-28">
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

        <section id="features" tabIndex={-1} aria-labelledby="features-heading" className="reveal section-shell mx-auto max-w-6xl px-5 pb-20 lg:px-8 lg:pb-28">
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

        <section id="security" tabIndex={-1} aria-labelledby="security-heading" className="reveal section-shell mx-auto max-w-6xl px-5 pb-20 lg:px-8 lg:pb-28">
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
          <span>Chrono · Early access</span>
        </div>
      </footer>
    </div>
  );
}
