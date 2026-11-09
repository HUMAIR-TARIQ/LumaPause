/// <reference types="vite/client" />

import type { LumaPauseApi } from '../shared/contracts';

declare global {
  interface Window {
    /** The only bridge exposed by the sandboxed preload. No Node or ipcRenderer access. */
    readonly lumapause: LumaPauseApi;
  }
}

export {};
