/**
 * Wire types for /api/github/* and /api/auth/* — shared by Netlify Functions and the client.
 * Never include access tokens in any of these shapes.
 */

export interface SessionUser {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
}

export type AuthSessionResponse =
  /** canonicalOrigin: this host isn't the one OAuth is bound to; the client should move there. */
  | { authenticated: false; canonicalOrigin?: string }
  | { authenticated: true; user: SessionUser; scopes: string[]; includePrivate: boolean; expiresAt: string };

export interface RepoPermissions {
  admin: boolean;
  push: boolean;
  pull: boolean;
}

export interface RepoSummary {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  defaultBranch: string;
  language: string | null;
  pushedAt: string | null;
  permissions: RepoPermissions;
}

export interface RepoListResponse {
  repos: RepoSummary[];
  page: number;
  hasNext: boolean;
}

export interface BranchSummary {
  name: string;
  sha: string;
  protected: boolean;
}

export interface BranchListResponse {
  branches: BranchSummary[];
  /** True when the repo has more branches than we fetched. */
  truncated: boolean;
}

export interface TreeEntry {
  path: string;
  type: "blob" | "tree";
  size?: number;
}

export interface TreeResponse {
  ref: string;
  commitSha: string;
  entries: TreeEntry[];
  /** GitHub truncated the tree, or we capped it — the file list is incomplete. */
  truncated: boolean;
}

export interface FileResponse {
  path: string;
  ref: string;
  sha: string;
  size: number;
  content: string;
}

/* ── Git shipping (Phase 6) ───────────────────────────────────────── */

export interface CommitFileInput {
  path: string;
  /** Full UTF-8 content; null deletes the file. */
  content: string | null;
}

export interface CommitRequest {
  /** Branch to commit to. */
  branch: string;
  /** Create `branch` from this commit first (working-branch flow). Omit to commit to an existing branch. */
  createFrom?: string;
  /** Commit the workspace changes were made on — used to detect conflicting upstream changes. */
  baseSha: string;
  message: string;
  files: CommitFileInput[];
  /** Required to commit straight to the repository's default branch. */
  allowDefaultBranch?: boolean;
}

export interface CommitResponse {
  branch: string;
  created: boolean;
  /** Head of the branch before this commit. */
  parentSha: string;
  commit: { sha: string; url: string; message: string };
  files: number;
}

export interface PullRequestRequest {
  head: string;
  base: string;
  title: string;
  body: string;
  draft?: boolean;
}

export interface PullRequestSummary {
  number: number;
  url: string;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  merged: boolean;
  head: string;
  base: string;
}

export interface PullRequestResponse {
  pull: PullRequestSummary;
  /** An open PR for this head/base already existed and was returned instead. */
  existing: boolean;
}

export interface PullListResponse {
  pulls: PullRequestSummary[];
}

export interface CommitSummary {
  sha: string;
  message: string;
  author: string;
  date: string | null;
  url: string;
}

export interface CommitListResponse {
  commits: CommitSummary[];
}

export interface CreateBranchRequest {
  name: string;
  from: string;
}
