import { HostError } from "./host-error";
import { readFile, writeFile } from "./fs";
import { sha256Text, utf8Bytes } from "./hash";

export async function writeFileGuarded(input: {
  path: string;
  content: string;
  expectedSha256?: string;
}): Promise<{ path: string; bytes: number; sha256: string; previousSha256?: string }> {
  let previousSha256: string | undefined;
  if (input.expectedSha256) {
    if (!/^[a-f0-9]{64}$/i.test(input.expectedSha256))
      throw new HostError("expected_sha256 must be a 64-character SHA-256 hex digest from fs_read");
    const current = await readFile(input.path).catch(() => {
      throw new HostError("expected_sha256 requires an existing readable file");
    });
    previousSha256 = sha256Text(current);
    if (previousSha256.toLowerCase() !== input.expectedSha256.toLowerCase())
      throw new HostError("File changed since fs_read; inspect it again before overwriting");
  }
  await writeFile(input.path, input.content);
  return {
    path: input.path,
    bytes: utf8Bytes(input.content),
    sha256: sha256Text(input.content),
    ...(previousSha256 ? { previousSha256 } : {}),
  };
}
