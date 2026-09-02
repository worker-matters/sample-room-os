import { CameraOutlined, PictureOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useRef, type ChangeEvent } from "react";
import { setNextNativeUploadSource } from "../../pages/qc/tabletNativeBridge";

type Props = {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  cameraLabel?: string;
  galleryLabel?: string;
  className?: string;
};

export function NativeTabletImagePicker({
  onFiles,
  disabled = false,
  cameraLabel = "拍照",
  galleryLabel = "相册",
  className = ""
}: Props) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const appendFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) onFiles(files);
    event.target.value = "";
  };

  return (
    <div className={`native-tablet-image-picker${className ? ` ${className}` : ""}`}>
      <Button
        type="primary"
        icon={<CameraOutlined />}
        disabled={disabled}
        onClick={() => cameraInputRef.current?.click()}
      >
        {cameraLabel}
      </Button>
      <Button
        type="primary"
        icon={<PictureOutlined />}
        disabled={disabled}
        onClick={() => {
          setNextNativeUploadSource("gallery");
          galleryInputRef.current?.click();
        }}
      >
        {galleryLabel}
      </Button>
      <input
        ref={cameraInputRef}
        hidden
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={appendFiles}
      />
      <input
        ref={galleryInputRef}
        hidden
        type="file"
        accept="image/*"
        multiple
        onChange={appendFiles}
      />
    </div>
  );
}
