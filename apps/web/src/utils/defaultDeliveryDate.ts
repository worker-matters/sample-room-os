function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

export function formatLocalDateInputValue(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

export function getDefaultDeliveryDate(now = new Date()) {
  const deliveryDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  return formatLocalDateInputValue(deliveryDate);
}
