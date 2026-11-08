import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptField, encryptField } from "../lib/crypto.js";
import { loadPreviewEnv, previewEnvAvailability, previewEnvNameError, previewEnvRepoKey } from "../lib/preview-env.js";
import type { SessionData } from "../lib/session.js";
import { configureEnv } from "./helpers.js";

const session = { v: 1, exp: 0, user: { id: 7, login: "jaz", name: null, avatarUrl: "" } } as unknown as SessionData;

describe("preview variables", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts ordinary env names and rejects names the sandbox owns", () => {
    for (const ok of ["DATABASE_URL", "AUTH_SECRET", "NEXT_PUBLIC_API", "_x", "vite_KEY"]) expect(previewEnvNameError(ok)).toBeNull();
    for (const bad of ["", "1ABC", "A-B", "A B", "PORT", "path", "HOST", "VERCEL_TOKEN", "CHRONO_PROXY_ANY", "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS", "JAVA_HOME", "X".repeat(65)]) {
      expect(previewEnvNameError(bad)).not.toBeNull();
    }
  });

  it("keys variables by case-insensitive owner/repo", () => {
    expect(previewEnvRepoKey("Jaz", "MarketHub")).toBe("jaz/markethub");
  });

  it("reports itself unavailable without a database and starts previews without variables", async () => {
    configureEnv();
    vi.stubEnv("ENCRYPTION_KEY", "e".repeat(44));
    expect(previewEnvAvailability()).toMatchObject({ available: false });
    await expect(loadPreviewEnv(session, "jaz", "app")).resolves.toEqual({ env: {}, unreadable: [] });
  });

  it("binds ciphertext to user, repository and name", async () => {
    const secret = "s".repeat(44);
    const aad = (user: number, repo: string, name: string) => "user:" + user + "|preview-env:" + repo + "|" + name;
    const cipher = await encryptField("postgres://dev", secret, aad(7, "jaz/app", "DATABASE_URL"));
    expect(cipher).not.toContain("postgres");
    expect(await decryptField(cipher, secret, aad(7, "jaz/app", "DATABASE_URL"))).toBe("postgres://dev");
    expect(await decryptField(cipher, secret, aad(8, "jaz/app", "DATABASE_URL"))).toBeNull();
    expect(await decryptField(cipher, secret, aad(7, "jaz/other", "DATABASE_URL"))).toBeNull();
    expect(await decryptField(cipher, secret, aad(7, "jaz/app", "AUTH_SECRET"))).toBeNull();
  });
});
