import type { IncomingMessage, ServerResponse } from "node:http";
import { handleVercelRequest } from "./_lib/adapter.js";

export default function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse & { setHeader(name: string, value: string | string[]): void }): Promise<void> {
  return handleVercelRequest(req, res);
}
