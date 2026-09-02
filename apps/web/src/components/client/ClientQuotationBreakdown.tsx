import { Empty, Space, Typography } from "antd";
import type { ClientQuotation } from "../../api/sampleRoomApi";

export function ClientQuotationBreakdown({ quotation }: { quotation: ClientQuotation }) {
  const otherCharges = quotation.otherCharges ?? [];
  return (
    <Space direction="vertical" size={14} className="full-width client-quotation-breakdown">
      <div className="client-quotation-grid">
        <div><Typography.Text type="secondary">样衣金额</Typography.Text><Typography.Text strong>¥{quotation.sampleAmount.toFixed(2)}</Typography.Text></div>
        <div><Typography.Text type="secondary">版费</Typography.Text><Typography.Text strong>¥{quotation.customerPatternFee.toFixed(2)}</Typography.Text></div>
        <div><Typography.Text type="secondary">其他费用</Typography.Text><Typography.Text strong>¥{quotation.effectiveCustomerOtherCharges.toFixed(2)}</Typography.Text></div>
        <div><Typography.Text type="secondary">应收合计</Typography.Text><Typography.Text strong>¥{quotation.receivableTotal.toFixed(2)}</Typography.Text></div>
      </div>
      <div className="client-quotation-charge-list">
        <Typography.Text strong>其他费用明细</Typography.Text>
        {otherCharges.length ? otherCharges.map((charge, index) => (
          <div className="client-quotation-charge-row" key={`${charge.name}-${charge.amount}-${index}`}>
            <div>
              <Typography.Text>{charge.name}</Typography.Text>
              <Typography.Text type="secondary">{charge.note || "无备注"}</Typography.Text>
            </div>
            <Typography.Text strong>¥{charge.amount.toFixed(2)}</Typography.Text>
          </div>
        )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无其他费用" />}
      </div>
    </Space>
  );
}
