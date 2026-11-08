import type { Config } from "@netlify/functions";
import { handle, json } from "../lib/http.js";
import { githubForRequest } from "../lib/gh-request.js";
import { repoParams } from "../lib/validate.js";

interface GhAsset { name: string; size: number; browser_download_url: string; content_type?: string; download_count?: number }
interface GhRelease { tag_name: string; name: string | null; html_url: string; draft: boolean; prerelease: boolean; published_at: string | null; assets: GhAsset[] }

/**
 * GET /api/github/repos/:owner/:repo/releases — recent releases that ship an installable Android
 * build (.apk / .aab), for projects that can't run on a web server. Read-only; downloads happen on
 * github.com in the user's own browser session (private repositories need them signed in there).
 */
export default handle(["GET"], async (req, ctx) => {
  const { owner, repo } = repoParams(ctx.params);
  const { gh } = await githubForRequest(req);
  const { data } = await gh.get<GhRelease[]>("/repos/" + owner + "/" + repo + "/releases", { per_page: 10 });
  const releases = data
    .filter((r) => !r.draft)
    .map((r) => ({
      tag: r.tag_name,
      name: r.name || r.tag_name,
      url: r.html_url,
      prerelease: r.prerelease,
      publishedAt: r.published_at,
      apks: r.assets
        .filter((a) => /\.(apk|aab)$/i.test(a.name))
        .map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url, kind: /\.aab$/i.test(a.name) ? "aab" : "apk" })),
    }))
    .filter((r) => r.apks.length > 0)
    .slice(0, 5);
  return json({ releases });
});

export const config: Config = { path: "/api/github/repos/:owner/:repo/releases" };
