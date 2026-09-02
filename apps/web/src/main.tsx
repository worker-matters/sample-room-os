import React from "react";
import ReactDOM from "react-dom/client";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Application root element is missing.");
}

const root = ReactDOM.createRoot(rootElement);
const workerRegistrationPath = /^\/workers\/register\/[^/]+\/?$/.test(window.location.pathname);
const workerMobilePath = /^\/worker\/mobile\/?$/.test(window.location.pathname);
const lightweightWorkerMobilePath = workerMobilePath && import.meta.env.VITE_AUTH_MODE !== "dev";

root.render(
  <div
    style={{
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      color: "#6b7a90",
      fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Microsoft YaHei, sans-serif"
    }}
  >
    正在加载…
  </div>
);

if (workerRegistrationPath) {
  void import("./pages/workers/WorkerRegistrationStandaloneApp")
    .then(({ WorkerRegistrationStandaloneApp }) => {
      // Keep the public registration route outside StrictMode so development does not
      // duplicate its one required registration-info request.
      root.render(<WorkerRegistrationStandaloneApp />);
    })
    .catch(() => {
      root.render(<div style={{ padding: 24 }}>注册页面加载失败，请刷新后重试。</div>);
    });
} else if (lightweightWorkerMobilePath) {
  void import("./pages/workers/WorkerMobileStandaloneApp")
    .then(({ WorkerMobileStandaloneApp }) => {
      // Formal cutting/sewing H5 deliberately skips the full desktop shell, router and
      // auth providers. The standalone app restores only the current cookie session and
      // lazy-loads camera, scan actions and performance when the worker asks for them.
      root.render(<WorkerMobileStandaloneApp />);
    })
    .catch(() => {
      root.render(<div style={{ padding: 24 }}>工序工作台加载失败，请刷新后重试。</div>);
    });
} else {
  void import("./FullApplicationRoot")
    .then(({ FullApplicationRoot }) => {
      root.render(
        <React.StrictMode>
          <FullApplicationRoot />
        </React.StrictMode>
      );
    })
    .catch(() => {
      root.render(<div style={{ padding: 24 }}>系统页面加载失败，请刷新后重试。</div>);
    });
}
