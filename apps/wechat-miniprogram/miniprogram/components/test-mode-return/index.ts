import type { MiniappGlobalData } from "../../app";
import { logoutMiniapp } from "../../services/apiClient";
import { ensureSessionEndpoint } from "../../services/endpointSession";

const SESSION_STORAGE_KEY = "sample-room-miniapp-session";
const TEST_MODE_STORAGE_KEY = "sample-room-miniapp-test-mode";

Component({
  data: {
    visible: false,
    busy: false
  },

  lifetimes: {
    attached() {
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const testModeToken = app.globalData.developmentTestModeToken
        || wx.getStorageSync<string>(TEST_MODE_STORAGE_KEY);
      this.setData({ visible: Boolean(testModeToken) });
    }
  },

  methods: {
    async returnToTestMode() {
      if (this.data.busy) return;
      const app = getApp<{ globalData: MiniappGlobalData }>();
      const testModeToken = app.globalData.developmentTestModeToken
        || wx.getStorageSync<string>(TEST_MODE_STORAGE_KEY);
      if (!testModeToken) {
        this.setData({ visible: false });
        return;
      }

      this.setData({ busy: true });
      try {
        if (app.globalData.sessionToken) {
          const endpoint = await ensureSessionEndpoint(app.globalData);
          await logoutMiniapp(endpoint.baseUrl, app.globalData.sessionToken);
        }
      } catch {
        // Returning to test-mode selection still clears an expired or unreachable persona session locally.
      } finally {
        app.globalData.developmentTestModeToken = testModeToken;
        delete app.globalData.sessionToken;
        delete app.globalData.developmentPersonaKey;
        delete app.globalData.identityBeforePreview;
        app.globalData.identity = {
          status: "unbound",
          homeRoute: "/pages/identity/identity",
          canScanOrder: false
        };
        app.globalData.identityPreviewActive = false;
        wx.removeStorageSync(SESSION_STORAGE_KEY);
        wx.setStorageSync(TEST_MODE_STORAGE_KEY, testModeToken);
        this.setData({ busy: false });
        await wx.reLaunch({ url: "/pages/dev/test-mode" });
      }
    }
  }
});
