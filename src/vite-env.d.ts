/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public base URL of the GitHub web host (only set for GitHub Enterprise or the local mock). */
  readonly VITE_GITHUB_WEB_URL?: string;
}

/** Injected by vite.config.ts from package.json. */
declare const __APP_VERSION__: string;
declare const __BUILD_COMMIT__: string;
