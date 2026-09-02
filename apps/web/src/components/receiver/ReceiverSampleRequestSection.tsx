import { Checkbox } from "antd";
import { sampleRequestItemOptions, type SampleRequestItem } from "@sample-room/shared";
import { ParallelProgress } from "../operations/ParallelProgress";

type ReceiverSampleRequestSectionProps = {
  value?: SampleRequestItem[];
  onChange?: (value: SampleRequestItem[]) => void;
};

export function ReceiverSampleRequestSection({
  value = [],
  onChange
}: ReceiverSampleRequestSectionProps) {
  return (
    <div className="receiver-sample-request-section">
      <Checkbox.Group
        className="receiver-correction-sample-request-grid"
        options={sampleRequestItemOptions}
        value={value}
        onChange={(items) => onChange?.(items as SampleRequestItem[])}
      />
      <ParallelProgress compact sampleRequestItems={value} stage={null} />
    </div>
  );
}
