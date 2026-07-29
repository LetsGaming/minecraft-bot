/**
 * host-info v1/v2 compatibility, and the player-count fallback.
 *
 * Both exist because of field reports: /status showed the Java process's
 * lifetime-average CPU under a heading that said "Host", and two directories
 * on one filesystem printed identical df figures; presence reported
 * "0 online" for servers people were playing on.
 */
import { describe, it, expect } from "vitest";
import { normaliseDisk } from "../../src/core/utils/server/hostResources.js";

describe("normaliseDisk — reading both wrapper generations", () => {
  it("reads the v2 shape, keeping the directory size and mount point", () => {
    expect(
      normaliseDisk({
        path: "/srv/mc/world",
        sizeBytes: 5_000_000_000,
        filesystem: {
          mountPoint: "/",
          usedPercent: 20,
          availableBytes: 90_600_000_000,
          totalBytes: 113_000_000_000,
        },
      }),
    ).toEqual({
      path: "/srv/mc/world",
      sizeBytes: 5_000_000_000,
      filesystem: {
        mountPoint: "/",
        usedPercent: 20,
        availableBytes: 90_600_000_000,
        totalBytes: 113_000_000_000,
      },
    });
  });

  it("lifts the v1 flat shape into the same structure", () => {
    // An un-upgraded wrapper still reports; it simply never measured the
    // directory itself, so sizeBytes is null rather than invented.
    expect(
      normaliseDisk({
        path: "/srv/mc/world",
        usedPercent: 20,
        availableBytes: 90_600_000_000,
        totalBytes: 113_000_000_000,
      }),
    ).toEqual({
      path: "/srv/mc/world",
      sizeBytes: null,
      filesystem: {
        mountPoint: "",
        usedPercent: 20,
        availableBytes: 90_600_000_000,
        totalBytes: 113_000_000_000,
      },
    });
  });

  it("keeps the filesystem when du could not measure the directory", () => {
    const disk = normaliseDisk({
      path: "/srv/mc/backups",
      sizeBytes: null,
      filesystem: {
        mountPoint: "/",
        usedPercent: 20,
        availableBytes: 1,
        totalBytes: 2,
      },
    });
    expect(disk?.sizeBytes).toBeNull();
    expect(disk?.filesystem.usedPercent).toBe(20);
  });

  it("rejects entries too incomplete to render honestly", () => {
    expect(normaliseDisk(null)).toBeNull();
    expect(normaliseDisk({ path: "/x" })).toBeNull();
    expect(normaliseDisk({ usedPercent: 20 })).toBeNull();
    expect(
      normaliseDisk({ path: "/x", filesystem: { mountPoint: "/" } }),
    ).toBeNull();
  });

  it("does not treat a v2 entry as v1 when the filesystem block is malformed", () => {
    expect(
      normaliseDisk({
        path: "/x",
        filesystem: { mountPoint: "/", usedPercent: "twenty" },
        usedPercent: 20,
        availableBytes: 1,
        totalBytes: 2,
      }),
    ).toBeNull();
  });
});
