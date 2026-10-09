/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" in the GitHub Pages build, which has no agent behind it and shows sample data. */
  readonly VITE_HOSTED?: string;
}
