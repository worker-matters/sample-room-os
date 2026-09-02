export type SaveFileInput = {
  orderId: string;
  folderCode?: string | undefined;
  orderFolderRelativePath?: string | undefined;
  category?: string | undefined;
  uploaderRole?: string | undefined;
  businessLabel?: string | undefined;
  originalName: string;
  contentType: string;
  buffer?: Buffer | undefined;
  temporaryPath?: string | undefined;
  sizeBytes?: number | undefined;
  checksum?: string | undefined;
};

export type MoveFileInput = {
  storageKey: string;
  orderFolderRelativePath: string;
  category: string;
  uploaderRole?: string | undefined;
  businessLabel?: string | undefined;
};

export type StoredFile = {
  storageKey: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  createdAt: string;
};

export type StoredFileStat = {
  storageKey: string;
  sizeBytes: number;
  checksum?: string | undefined;
};

export interface FileStorageAdapter {
  saveFile(input: SaveFileInput): Promise<StoredFile>;
  moveFile?(input: MoveFileInput): Promise<string>;
  readFile(storageKey: string): Promise<Buffer>;
  statFile(storageKey: string): Promise<StoredFileStat>;
  deleteFile(storageKey: string): Promise<void>;
  fileExists(storageKey: string): Promise<boolean>;
}

export class FileStorageNotFoundError extends Error {
  constructor(storageKey: string) {
    super(`File not found for storage key: ${storageKey}`);
    this.name = "FileStorageNotFoundError";
  }
}
