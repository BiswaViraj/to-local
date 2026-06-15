export const STORAGE_KEY = "toLocal:enabledOrigins";
export const CONTENT_SCRIPT_ID = "tolocal-runtime";
export const CONTENT_SCRIPT_FILE = "content-scripts/runtime.js";

export interface OriginState {
  enabled: boolean;
  permissionGranted: boolean;
  registeredPatterns: string[];
}

export type RuntimeRequest =
  | {
      type: "origin:get";
      origin: string;
    }
  | {
      type: "origin:set";
      origin: string;
      enabled: boolean;
    }
  | {
      type: "runtime:reconcile";
    };

export type RuntimeResponse =
  | {
      ok: true;
      message: string;
      state?: OriginState;
    }
  | {
      ok: false;
      message: string;
    };
