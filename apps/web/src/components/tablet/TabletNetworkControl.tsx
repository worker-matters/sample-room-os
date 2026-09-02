import { Button, message, Space, Typography } from "antd";
import { useEffect, useState } from "react";
import {
  nativeTabletNetworkState,
  subscribeToNativeTabletWriteState,
  switchNativeTabletNetwork
} from "../../pages/qc/tabletNativeBridge";

export function TabletNetworkControl() {
  const state = nativeTabletNetworkState();
  const [writeInProgress, setWriteInProgress] = useState(state?.writeInProgress ?? false);

  useEffect(() => subscribeToNativeTabletWriteState(setWriteInProgress), []);

  if (!state) return null;

  const disabledTitle = writeInProgress ? "业务正在保存或上传，暂不能切换线路" : undefined;
  const switchLine = (target: "LAN" | "PUBLIC") => {
    const editingOverlayOpen = Array.from(
      document.querySelectorAll<HTMLElement>(".ant-modal-wrap, .ant-drawer-open")
    ).some((element) => {
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    });
    if (editingOverlayOpen) {
      void message.warning("请先保存或关闭当前输入弹窗，再切换网络线路。");
      return;
    }
    switchNativeTabletNetwork(target);
  };

  return (
    <Space size={8} className="tablet-network-control">
      <Button
        size="small"
        type={state.current === "LAN" ? "primary" : "default"}
        disabled={!state.lanConfigured || writeInProgress}
        title={disabledTitle}
        onClick={() => switchLine("LAN")}
      >
        LAN
      </Button>
      <Button
        size="small"
        type={state.current === "PUBLIC" ? "primary" : "default"}
        disabled={!state.publicConfigured || writeInProgress}
        title={disabledTitle}
        onClick={() => switchLine("PUBLIC")}
      >
        PUBLIC
      </Button>
      <Typography.Text type="secondary" className="tablet-ui-version">
        UI v{state.uiVersion || "-"}
      </Typography.Text>
    </Space>
  );
}
