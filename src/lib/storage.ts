// Keeps each uploaded availability file in Cloud Storage, so an import can
// be traced back to the exact bytes the operator sent. Server-only: it is
// imported by the admin import action and nothing the browser loads.

/** The object name for an upload: a timestamp plus a cleaned-up file name. */
export function importObjectName(filename: string, now = new Date()): string {
  const base =
    filename
      .replace(/\.csv$/i, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 80) || "upload";
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `imports/${stamp}-${base}.csv`;
}

type StorageClient = InstanceType<typeof import("@google-cloud/storage").Storage>;
let client: Promise<StorageClient> | undefined;

/** One client per process, created on first use: it holds auth and connections. */
function storageClient(): Promise<StorageClient> {
  client ??= import("@google-cloud/storage")
    .then(({ Storage }) => new Storage())
    .catch((error: unknown) => {
      // Don't keep a failed client: the next upload tries again.
      client = undefined;
      throw error;
    });
  return client;
}

/**
 * Stores the raw file in gs://$IMPORT_BUCKET and returns its path, or null
 * when IMPORT_BUCKET isn't set (local dev). On Cloud Run the client uses the
 * service's own account (application default credentials).
 */
export async function storeImportFile(filename: string, text: string): Promise<string | null> {
  const bucket = process.env.IMPORT_BUCKET;
  if (!bucket) return null;
  const name = importObjectName(filename);
  await (await storageClient()).bucket(bucket).file(name).save(text, {
    contentType: "text/csv; charset=utf-8",
    resumable: false,
    // Never overwrite an earlier upload.
    preconditionOpts: { ifGenerationMatch: 0 },
  });
  return `gs://${bucket}/${name}`;
}
