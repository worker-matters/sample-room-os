import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getDefaultDeliveryDate } from "../../utils/defaultDeliveryDate";
import {
  createDefaultOrderValues,
  createDefaultReceiverSelfEntryValues
} from "../../utils/orderFormDefaults";

const clientPageDir = dirname(fileURLToPath(import.meta.url));

describe("client page wiring", () => {
  it("uses local entry date plus seven days as the unified new-order delivery-date default", () => {
    const referenceDate = new Date(2026, 5, 10, 23, 30);

    expect(getDefaultDeliveryDate(referenceDate)).toBe("2026-06-17");
    expect(getDefaultDeliveryDate(new Date(2026, 5, 30, 8, 0))).toBe("2026-07-07");
    expect(createDefaultOrderValues(referenceDate).deliveryDate).toBe("2026-06-17");
    expect(createDefaultReceiverSelfEntryValues(referenceDate).deliveryDate).toBe("2026-06-17");
  });

  it("defines separate normal and customer admin client identities for manual testing", () => {
    const source = readFileSync(resolve(clientPageDir, "../../app/DevSessionContext.tsx"), "utf8");

    expect(source).toContain("mock-client-user-active");
    expect(source).toContain("mock-client-user-admin");
    expect(source).toContain("mock-client-user-other");
    expect(source).toContain("clientAccessScope: CLIENT_ACCESS_SCOPES.own");
    expect(source).toContain("clientAccessScope: CLIENT_ACCESS_SCOPES.customerAll");
  });

  it("keeps /client focused on quick photo and fixed Excel intake", () => {
    const source = readFileSync(resolve(clientPageDir, "ClientWorkbenchPage.tsx"), "utf8");

    expect(source).toContain("ClientQuickPhotoIntake");
    expect(source).toContain("ClientExcelImportPanel");
    expect(source).toContain("RecentOrderSummary");
    expect(source).toContain("截图/照片录入");
    expect(source).toContain("Excel 批量导入");
    expect(source).not.toContain("createDefaultOrderValues");
    expect(source).not.toContain("createClientOrder(session");
    expect(source).not.toContain("ClientBusinessUserRequestCard");
    expect(source).not.toContain("ClientOrderFilterBar");
  });

  it("mounts customer quick-photo and fixed Excel intake controls", () => {
    const source = readFileSync(resolve(clientPageDir, "ClientQuickIntakePanel.tsx"), "utf8");

    expect(source).toContain("截图后直接 Ctrl+V 粘贴，或点击选择图片");
    expect(source).toContain("生成订单");
    expect(source).toContain("下载固定模板");
    expect(source).toContain("确认导入有效行");
    expect(source).toContain("createClientQuickPhotoOrder");
    expect(source).toContain("previewClientExcelImport");
    expect(source).toContain("confirmClientExcelImport");
    expect(source).not.toContain("customerId:");
    expect(source).not.toContain("clientUserId:");
  });

  it("keeps /client/orders as the dedicated full order list with filters and no internal data", () => {
    const source = readFileSync(resolve(clientPageDir, "ClientOrdersPage.tsx"), "utf8");

    expect(source).toContain("ClientOrderFilterBar");
    expect(source).toContain("filterOrders(orders, filters)");
    expect(source).toContain("OrderExportDialog");
    expect(source).toContain("ClientAdminStatistics");
    expect(source).toContain("ClientOrderOverview");
    expect(source).toContain("ClientQuotationBreakdown");
    expect(source).toContain("clientQuotation=");
    expect(source).toContain("setDetailOrder(order)");
    expect(source).toContain("setQuotationOrder(order)");
    expect(source).toContain("client-order-detail-modal");
    expect(source).toContain("打样报价");
    expect(source).not.toContain("expandedRowRender=");
    expect(source).not.toContain("expandedOrderRowKeys");
    expect(source).toContain("addClientOrderAttachments");
    expect(source).toContain("canAddAttachments={clientAccessScope === CLIENT_ACCESS_SCOPES.own}");
    expect(source).toContain("businessUserOptions");
    expect(source).not.toContain("createClientOrder");
    expect(source).not.toContain("scanToken");
    expect(source).not.toContain("scanRecords");
    expect(source).not.toContain("internal worklog");
    expect(source).not.toContain("price");
    expect(source).not.toContain("cost");
  });

  it("mounts compact mobile client filters and photo intake without the full create form", () => {
    const source = readFileSync(resolve(clientPageDir, "ClientMobilePage.tsx"), "utf8");

    expect(source).toContain("ClientQuickPhotoIntake");
    expect(source).toContain("ClientOrderMobileFilterBar");
    expect(source).toContain("ClientAdminStatistics");
    expect(source).toContain("MobileOrderTitleBlock");
    expect(source).toContain("MobileOrderStatusBlock");
    expect(source).toContain("MobileOrderKeyGrid");
    expect(source).toContain("MobileOrderActionRow");
    expect(source).toContain("filterOrders(orders, filters)");
    expect(source).toContain("businessUserOptions");
    expect(source).toContain("isCustomerAll");
    expect(source).toContain("setFilters({ ...defaultOrderFilters })");
    expect(source).toContain("deliveryDate: order.deliveryDate");
    expect(source).not.toContain("createDefaultOrderValues");
    expect(source).not.toContain("createClientOrder(session");
  });

  it("keeps the exact client-safe order type through client page consumers", () => {
    const files = [
      "ClientWorkbenchPage.tsx",
      "ClientOrdersPage.tsx",
      "ClientMobilePage.tsx",
      "../../components/client/ClientOrderOverview.tsx"
    ];

    for (const file of files) {
      const source = readFileSync(resolve(clientPageDir, file), "utf8");
      expect(source).toContain("ClientOrder");
      expect(source).not.toContain("type OrderRecord");
    }
  });

  it("shows the business-user registration entry only in client user management", () => {
    const workbenchSource = readFileSync(resolve(clientPageDir, "ClientWorkbenchPage.tsx"), "utf8");
    const userManagementSource = readFileSync(resolve(clientPageDir, "ClientUserManagementPage.tsx"), "utf8");
    const ordersSource = readFileSync(resolve(clientPageDir, "ClientOrdersPage.tsx"), "utf8");
    const registrationCardSource = readFileSync(
      resolve(clientPageDir, "../../components/ClientBusinessUserRegistrationCard.tsx"),
      "utf8"
    );

    expect(workbenchSource).not.toContain("ClientBusinessUserRequestCard");
    expect(userManagementSource).toContain("ClientBusinessUserRegistrationCard");
    expect(userManagementSource).toContain("listClientManagedBusinessUsers");
    expect(userManagementSource).toContain("updateClientManagedBusinessUserStatus");
    expect(userManagementSource).toContain("停用业务员回收区");
    expect(userManagementSource).toContain("停用业务员");
    expect(userManagementSource).toContain("恢复业务员");
    expect(userManagementSource).toContain("archivedAt");
    expect(userManagementSource).toContain("archivedBy");
    expect(userManagementSource).not.toContain("defaultActiveKey");
    expect(ordersSource).not.toContain("ClientBusinessUserRequestCard");
    expect(registrationCardSource).toContain("openClientBusinessUserRegistrationCode");
    expect(registrationCardSource).toContain("closeClientBusinessUserRegistrationCode");
    expect(registrationCardSource).toContain("listClientBusinessUserRequests");
  });

  it("keeps business-user requests inside customer account management for boss and System Owner", () => {
    const adminSource = readFileSync(resolve(clientPageDir, "../admin/AdminDashboardPage.tsx"), "utf8");
    const systemOwnerSource = readFileSync(resolve(clientPageDir, "../system-owner/SystemOwnerPage.tsx"), "utf8");
    const requestCardSource = readFileSync(
      resolve(clientPageDir, "../../components/BusinessUserRequestCards.tsx"),
      "utf8"
    );
    const customerAccountPanelSource = readFileSync(
      resolve(clientPageDir, "../../components/accounts/CustomerAccountManagementPanel.tsx"),
      "utf8"
    );

    expect(adminSource).toContain("CustomerAccountManagementPanel");
    expect(adminSource).not.toContain("InternalBusinessUserRequestReviewCard");
    expect(customerAccountPanelSource).toContain("listAllBusinessUserRequests");
    expect(customerAccountPanelSource).toContain("reviewBusinessUserRequest");
    expect(systemOwnerSource).toContain("CustomerAccountManagementPanel");
    expect(systemOwnerSource).not.toContain("InternalBusinessUserRequestReviewCard");
    expect(adminSource).toContain("WorkerRegistrationPanel");
    expect(systemOwnerSource).toContain("WorkerRegistrationPanel");
    expect(requestCardSource).toContain("loginCredential");
    expect(requestCardSource).toContain("temporaryPassword");
    expect(requestCardSource).toContain("Modal.info");
    expect(requestCardSource).toContain("reviewBusinessUserRequest");
  });

  it("uses backend self-entry options for receiver web and mobile pages", () => {
    const receiverWebSource = readFileSync(resolve(clientPageDir, "../receiver/ReceiverWorkbenchPage.tsx"), "utf8");
    const receiverAttachmentSource = readFileSync(
      resolve(clientPageDir, "../../components/receiver/ReceiverIntakeAttachmentWorkspace.tsx"),
      "utf8",
    );
    const receiverMobileSource = readFileSync(resolve(clientPageDir, "../receiver/ReceiverMobilePage.tsx"), "utf8");

    expect(receiverWebSource).toContain("createReceiverQuickPhotoOrder");
    expect(receiverWebSource).toContain("ReceiverIntakeAttachmentWorkspace");
    expect(receiverAttachmentSource).toContain("receiver_quick_photo");
    expect(receiverWebSource).toContain("listReceiverSelfEntryOptions");
    expect(receiverWebSource).toContain("ReceiverSelfEntryCustomer");
    expect(receiverWebSource).not.toContain("mockCustomers");
    expect(receiverMobileSource).toContain("createDefaultReceiverSelfEntryValues");
    expect(receiverMobileSource).toContain("listReceiverSelfEntryOptions");
    expect(receiverMobileSource).toContain("ReceiverSelfEntryCustomer");
    expect(receiverMobileSource).not.toContain("mobileCustomers");
  });
});
