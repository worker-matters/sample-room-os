import "@ant-design/v5-patch-for-react-19";
import "antd/dist/reset.css";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/App";
import "./app/styles.css";
import "./app/brandRefresh.css";
import "./app/pricingWorkflowFixes.css";

export function FullApplicationRoot() {
  return (
    <BrowserRouter>
      <App />
    </BrowserRouter>
  );
}
