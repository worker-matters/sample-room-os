import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const customerAccountSource = readFileSync(resolve(here, "CustomerAccountManagementPanel.tsx"), "utf8");
const appStylesSource = readFileSync(resolve(here, "../../app/styles.css"), "utf8");

describe("customer account expansion", () => {
  it("does not expand empty customer profiles and contains nested table scrolling", () => {
    expect(customerAccountSource).toContain(
      "rowExpandable: (customer) => customer.clientUsers.length > 0"
    );
    expect(customerAccountSource).toContain("customer-account-subtable-shell");
    expect(customerAccountSource).toContain("customer-account-table customer-account-subtable");
    expect(appStylesSource).toContain(".customer-account-subtable-shell");
    expect(appStylesSource).toContain(".customer-account-subtable .ant-table-content");
    expect(appStylesSource).toContain("overflow-x: auto !important");
  });
});
