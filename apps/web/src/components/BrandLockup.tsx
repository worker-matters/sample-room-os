import sampleRoomOsMark from "../assets/sample-room-os-mark.svg";

export const SAMPLE_ROOM_PRODUCT_NAME = "Sample Room OS";

export function BrandLockup({ className = "" }: { className?: string }) {
  return (
    <div className={`shared-brand-lockup${className ? ` ${className}` : ""}`} aria-label={SAMPLE_ROOM_PRODUCT_NAME}>
      <img className="shared-brand-lockup-mark" src={sampleRoomOsMark} alt="" aria-hidden="true" />
      <span className="shared-brand-lockup-copy" aria-hidden="true">
        <span className="shared-brand-lockup-name">{SAMPLE_ROOM_PRODUCT_NAME}</span>
      </span>
    </div>
  );
}
