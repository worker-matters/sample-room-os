import type { ClientOrderSummary } from "../types/contracts";

export type ClientOrderFilters = {
  keyword: string;
  salespersonId: string;
  taskState: "all" | "incomplete" | "complete";
};

export const emptyClientOrderFilters = (): ClientOrderFilters => ({
  keyword: "",
  salespersonId: "",
  taskState: "all"
});

export function filterClientOrders(
  orders: readonly ClientOrderSummary[],
  filters: ClientOrderFilters
) {
  const keyword = filters.keyword.trim().toLocaleLowerCase();
  return orders.filter((order) => {
    if (
      keyword &&
      ![order.orderNo, order.styleNo, order.styleName]
        .some((value) => value.toLocaleLowerCase().includes(keyword))
    ) return false;
    if (filters.salespersonId && order.salespersonId !== filters.salespersonId) return false;
    const complete = order.orderTasks.length > 0 && order.orderTasks.every((task) => task.completed);
    if (filters.taskState === "complete" && !complete) return false;
    if (filters.taskState === "incomplete" && complete) return false;
    return true;
  });
}

export function clientOrderTaskSummary(order: ClientOrderSummary) {
  const completed = order.orderTasks.filter((task) => task.completed).length;
  return { completed, total: order.orderTasks.length, complete: order.orderTasks.length > 0 && completed === order.orderTasks.length };
}
