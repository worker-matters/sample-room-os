import type { ApiMode, IdentityState } from "./types/contracts";
import { invalidateSessionEndpoint } from "./services/endpointSession";

export interface MiniappGlobalData {
  apiMode: ApiMode;
  identity: IdentityState;
  version: string;
  apiBase?: string;
  sessionToken?: string;
  identityPreviewActive?: boolean;
  identityBeforePreview?: IdentityState;
  developmentPersonaKey?: string;
  developmentTestModeToken?: string;
  developmentTestMode?: "development" | "release_preview";
}

App<{ globalData: MiniappGlobalData }>({
  onLaunch() {
    wx.onNetworkStatusChange(() => invalidateSessionEndpoint(this.globalData));
  },
  globalData: {
    apiMode: "undetected",
    identity: { status: "unbound", homeRoute: "/pages/identity/identity", canScanOrder: false },
    version: "0.1.0"
  }
});
