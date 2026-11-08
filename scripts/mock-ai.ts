/**
 * Fake OpenAI-compatible provider for local end-to-end testing (no real keys or spend).
 *   npm run dev:mock-ai   → http://127.0.0.1:8791/v1
 * Add it in Settings → AI providers as "OpenAI-compatible" with base URL http://127.0.0.1:8791/v1
 * (requires AI_ALLOW_PRIVATE_BASE_URLS=true on the dev API). Any key starting with "sk-mock-" works.
 *
 * When the request carries `tools` (the coding agent), it follows a fixed script so the whole
 * loop can be QA'd: list_files → read_file README.md → propose_plan → apply_patch → summary.
 * In Ask mode (no write tools offered) it answers after reading.
 */
import { createServer } from "node:http";

const port = Number(process.env.MOCK_AI_PORT ?? 8791);
const MODELS = ["mock-coder-1", "mock-coder-mini"];

createServer(async (req, res) => {
  const send = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  const auth = req.headers.authorization ?? "";
  if (!auth.startsWith("Bearer sk-mock-")) return send(401, { error: { message: "Invalid API key." } });
  const url = new URL(req.url ?? "/", "http://x");
  if (req.method === "GET" && url.pathname === "/v1/models") return send(200, { data: MODELS.map((id) => ({ id, object: "model" })) });
  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || "{}") as { model?: string; tools?: { function: { name: string } }[]; messages?: { role: string; content?: string | null }[] };
    if (!body.model || !MODELS.includes(body.model)) return send(404, { error: { message: `The model ${body.model} does not exist.` } });
    if (body.tools?.length) return send(200, agentReply(body.model, body.tools.map((t) => t.function.name), body.messages ?? []));
    return send(200, { model: body.model, choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 1 } });
  }
  send(404, { error: { message: "Not found" } });
}).listen(port, "127.0.0.1", () => console.log(`mock AI provider on http://127.0.0.1:${port}/v1`));

let n = 0;
function agentReply(model: string, tools: string[], messages: { role: string; content?: string | null }[]) {
  const lastUser = messages.map((m) => m.role).lastIndexOf("user");
  const turn = messages.slice(lastUser + 1);
  const step = turn.filter((m) => m.role === "assistant").length;
  const lastTool = [...turn].reverse().find((m) => m.role === "tool")?.content ?? "";
  const call = (name: string, args: unknown) => ({ id: `call_${++n}`, type: "function", function: { name, arguments: JSON.stringify(args) } });
  const usage = { prompt_tokens: 120, completion_tokens: 30 };
  const msg = (content: string | null, calls?: unknown[]) => ({
    model,
    choices: [{ message: { role: "assistant", content, ...(calls ? { tool_calls: calls } : {}) }, finish_reason: calls ? "tool_calls" : "stop" }],
    usage,
  });
  const canWrite = tools.includes("apply_patch");
  // "Remember …" exercises the knowledge base: one save_knowledge call, then a short answer.
  if (/\bremember\b/i.test(messages[lastUser]?.content ?? "") && tools.includes("save_knowledge")) {
    return step === 0 ? msg(null, [call("save_knowledge", { title: "Package manager", body: "Use pnpm, not npm.", scope: "project" })]) : msg("Saved that to your knowledge base. (mock answer)");
  }
  if (lastTool.includes("did NOT approve")) return msg("Understood — tell me what to change and I'll make a new plan.");
  switch (step) {
    case 0:
      return msg("Let me look around.", [call("list_files", {})]);
    case 1:
      return msg(null, [call("read_file", { path: "README.md" })]);
    case 2:
      if (!canWrite) return msg("**hello-mobile** is a mock repo with a short `README.md`. (mock answer)");
      return msg(null, [call("propose_plan", { summary: "Add a Getting started section to README.md.", steps: ["Append a Getting started heading", "List install and dev commands"] })]);
    case 3:
      return msg(null, [
        call("apply_patch", {
          path: "README.md",
          edits: [{ find: "A mock repository served by scripts/mock-github.ts.\n", replace: "A mock repository served by scripts/mock-github.ts.\n\n## Getting started\n\n```sh\nnpm install\nnpm run dev\n```\n" }],
        }),
      ]);
    default:
      return msg("Added a **Getting started** section to `README.md`. Review the diff and accept it. (mock answer)");
  }
}
