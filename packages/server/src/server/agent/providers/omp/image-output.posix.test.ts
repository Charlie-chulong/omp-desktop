import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";

import { persistOmpImageOutputs } from "./image-output.js";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aShoAAAAASUVORK5CYII=";

describe.skipIf(process.platform === "win32")("OMP replay image permissions", () => {
  test("keeps stored previews owner-only on POSIX filesystems", () => {
    const root = mkdtempSync(join(tmpdir(), "omp-replay-permissions-"));
    try {
      const [output] = persistOmpImageOutputs([{ data: png, mimeType: "image/png" }], [], root);
      expect(statSync(output!.filePath).mode & 0o777).toBe(0o600);
      expect(statSync(dirname(output!.filePath)).mode & 0o777).toBe(0o700);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
