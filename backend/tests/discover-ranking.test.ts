import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.ANALYSIS_RATE_LIMIT_MAX = "100";
process.env.ANALYSIS_RATE_LIMIT_WINDOW_MS = "60000";

const {
  buildDiscoverFeed,
  scoreDiscoverRowsByPlatformPercentile,
} = await import("../src/services/discoverRanking.js");

describe("Discover platform-normalized ranking", () => {
  it("returns no behavioral scores when only appearances are observed", () => {
    const feed = buildDiscoverFeed([{
      id: "single", title: null, creator: null, platform: "reddit",
      timestamp: "2026-04-30T09:00:00.000Z", appearances: 1,
    }], { allPlatforms: true });
    expect(feed[0]).not.toHaveProperty("signalSummary");
    expect(feed[0].reachMetrics).not.toContain("Top 1%");
    expect(buildDiscoverFeed([], { allPlatforms: true })).toEqual([]);
  });

  it("gives tied appearance counts equal percentiles and uses recency as a tie-breaker", () => {
    const rows = [
      { id: "old", timestamp: "2026-04-30T09:00:00.000Z", appearances: 5 },
      { id: "new", timestamp: "2026-04-30T10:00:00.000Z", appearances: 5 },
      { id: "low", timestamp: "2026-04-30T11:00:00.000Z", appearances: 1 },
    ].map((row) => ({ ...row, platform: "youtube", title: null, creator: null }));
    const scores = scoreDiscoverRowsByPlatformPercentile(rows);
    expect(scores.get("youtube:old")).toBe(scores.get("youtube:new"));
    expect(scores.get("youtube:low")).toBeCloseTo(1 / 3, 4);
    expect(buildDiscoverFeed(rows, { allPlatforms: true }).map((item) => item.id))
      .toEqual(["new", "old", "low"]);
    expect(scoreDiscoverRowsByPlatformPercentile([...rows].reverse())).toEqual(scores);
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sorts all-platform rows by platform-relative percentile before raw appearances", () => {
    const feed = buildDiscoverFeed(
      [
        {
          id: "yt-mainstream",
          title: "Large platform winner",
          creator: "Creator Y",
          platform: "youtube",
          timestamp: new Date("2026-04-30T10:00:00.000Z"),
          appearances: 100,
        },
        {
          id: "yt-runner-up",
          title: "Large platform runner up",
          creator: "Creator Y2",
          platform: "youtube",
          timestamp: new Date("2026-04-30T11:00:00.000Z"),
          appearances: 90,
        },
        {
          id: "reddit-top",
          title: "Small platform winner",
          creator: "r/example",
          platform: "reddit",
          timestamp: new Date("2026-04-30T09:00:00.000Z"),
          appearances: 3,
        },
        {
          id: "reddit-bottom",
          title: "Small platform baseline",
          creator: "r/example",
          platform: "reddit",
          timestamp: new Date("2026-04-30T08:00:00.000Z"),
          appearances: 1,
        },
      ],
      { allPlatforms: true },
    );

    expect(feed.map((item) => item.id)).toEqual([
      "yt-mainstream",
      "reddit-top",
      "yt-runner-up",
      "reddit-bottom",
    ]);
    expect(feed.find((item) => item.id === "reddit-top")).toMatchObject({
      normalizedScore: 1,
      rankingBasis: "platform_percentile",
      contentFamily: "community_post",
    });
  });

  it("keeps platform-filtered sorting appearance-based", () => {
    const feed = buildDiscoverFeed(
      [
        {
          id: "newer",
          title: "Newer",
          creator: "Creator",
          platform: "tiktok",
          timestamp: new Date("2026-04-30T11:00:00.000Z"),
          appearances: 2,
        },
        {
          id: "more-seen",
          title: "More seen",
          creator: "Creator",
          platform: "tiktok",
          timestamp: new Date("2026-04-30T09:00:00.000Z"),
          appearances: 5,
        },
      ],
      { allPlatforms: false },
    );

    expect(feed.map((item) => item.id)).toEqual(["more-seen", "newer"]);
    expect(feed[0]).toMatchObject({
      rankingBasis: "appearances",
      appearances: 5,
      contentFamily: "short_video",
    });
  });

  it("scores the same video id on different platforms as separate rows", () => {
    const scores = scoreDiscoverRowsByPlatformPercentile([
      {
        id: "same-id",
        title: null,
        creator: null,
        platform: "youtube",
        timestamp: new Date("2026-04-30T09:00:00.000Z"),
        appearances: 10,
      },
      {
        id: "same-id",
        title: null,
        creator: null,
        platform: "reddit",
        timestamp: new Date("2026-04-30T09:00:00.000Z"),
        appearances: 1,
      },
    ]);

    expect(scores.get("youtube:same-id")).toBe(1);
    expect(scores.get("reddit:same-id")).toBe(1);
  });

  it("returns normalized all-platform results with new response fields", () => {
    const feed = buildDiscoverFeed(
      [
      {
        id: "yt-second",
        title: "YouTube second",
        creator: "Video Creator",
        platform: "youtube",
        timestamp: new Date("2026-04-30T10:00:00.000Z"),
        appearances: 10n,
      },
      {
        id: "rd-first",
        title: "Reddit first",
        creator: "r/news",
        platform: "reddit",
        timestamp: new Date("2026-04-30T09:00:00.000Z"),
        appearances: 2n,
      },
      {
        id: "yt-first",
        title: "YouTube first",
        creator: "Video Creator",
        platform: "youtube",
        timestamp: new Date("2026-04-30T11:00:00.000Z"),
        appearances: 20n,
      },
      ],
      { allPlatforms: true },
    );
    expect(
      feed.map((item: { id: string }) => item.id),
    ).toEqual(["yt-first", "rd-first", "yt-second"]);
    expect(feed[1]).toMatchObject({
      appearances: 2,
      normalizedScore: 1,
      rankingBasis: "platform_percentile",
      contentFamily: "community_post",
    });
  });

  it("uses appearance ranking for platform-filtered results", () => {
    const feed = buildDiscoverFeed(
      [
      {
        id: "older-more-seen",
        title: "Older",
        creator: "Creator",
        platform: "youtube",
        timestamp: new Date("2026-04-30T09:00:00.000Z"),
        appearances: 6n,
      },
      {
        id: "newer-less-seen",
        title: "Newer",
        creator: "Creator",
        platform: "youtube",
        timestamp: new Date("2026-04-30T11:00:00.000Z"),
        appearances: 2n,
      },
      ],
      { allPlatforms: false },
    );
    expect(
      feed.map((item: { id: string }) => item.id),
    ).toEqual(["older-more-seen", "newer-less-seen"]);
    expect(feed[0]).toMatchObject({
      rankingBasis: "appearances",
      appearances: 6,
    });
  });
});
