import { describe, expect, it } from "vitest";
import { canonicalJson, hashObject, sha256 } from "../../src/core/hashing";

describe("canonical hashing", () => {
  it("does not depend on object key insertion order", () => {
    expect(hashObject({ beta: 2, alpha: { z: 3, a: 1 } })).toBe(
      hashObject({ alpha: { a: 1, z: 3 }, beta: 2 }),
    );
  });

  it("removes undefined object values but preserves array order", () => {
    expect(canonicalJson({ b: undefined, a: [2, 1] })).toBe('{"a":[2,1]}');
  });

  it("produces a SHA-256 digest", () => {
    expect(sha256("codezilla")).toMatch(/^[a-f0-9]{64}$/);
  });
});
