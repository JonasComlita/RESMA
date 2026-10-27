export const DISCOVER_POPULAR_LIMIT = 15;
export const DISCOVER_RANKING_BASIS_PLATFORM_PERCENTILE =
  "platform_percentile";
export const DISCOVER_RANKING_BASIS_APPEARANCES = "appearances";

type DiscoverRankingBasis =
  | typeof DISCOVER_RANKING_BASIS_PLATFORM_PERCENTILE
  | typeof DISCOVER_RANKING_BASIS_APPEARANCES;

export interface DiscoverTrendRow {
  id: string;
  title: string | null;
  creator: string | null;
  platform: string;
  timestamp: Date | string;
  appearances: number | bigint;
}

export interface DiscoverFeedItem {
  id: string;
  title: string | null;
  creator: string;
  platform: string;
  timestamp: Date | string;
  url: string;
  reachMetrics: string;
  appearances: number;
  normalizedScore: number;
  rankingBasis: DiscoverRankingBasis;
  contentFamily: string;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function toFiniteNumber(
  value: number | bigint | string | null | undefined,
): number {
  const parsed = typeof value === "bigint" ? Number(value) : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestampMs(value: Date | string | null | undefined): number {
  const parsed =
    value instanceof Date ? value.getTime() : new Date(value ?? 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundDiscoverScore(value: number): number {
  return Math.round(clampNumber(value, 0, 1) * 10000) / 10000;
}

export function discoverContentFamilyForPlatform(platform: string): string {
  switch (platform) {
    case "tiktok":
      return "short_video";
    case "youtube":
      return "long_video";
    case "reddit":
      return "community_post";
    case "twitter":
    case "instagram":
      return "social_post";
    default:
      return "unknown";
  }
}

export function scoreDiscoverRowsByPlatformPercentile(
  rows: DiscoverTrendRow[],
): Map<string, number> {
  const rowsByPlatform = new Map<string, DiscoverTrendRow[]>();

  for (const row of rows) {
    const platformRows = rowsByPlatform.get(row.platform) ?? [];
    platformRows.push(row);
    rowsByPlatform.set(row.platform, platformRows);
  }

  const scores = new Map<string, number>();
  for (const [platform, platformRows] of rowsByPlatform.entries()) {
    const ranked = [...platformRows].sort((left, right) => {
      const appearanceDelta =
        toFiniteNumber(right.appearances) - toFiniteNumber(left.appearances);
      if (appearanceDelta !== 0) return appearanceDelta;
      const recencyDelta =
        timestampMs(right.timestamp) - timestampMs(left.timestamp);
      if (recencyDelta !== 0) return recencyDelta;
      return String(left.id).localeCompare(String(right.id));
    });
    const denominator = Math.max(ranked.length, 1);
    // Equal appearance counts share a percentile; recency only breaks ranking ties.
    let index = 0;
    while (index < ranked.length) {
      let end = index + 1;
      while (
        end < ranked.length &&
        toFiniteNumber(ranked[end].appearances) ===
          toFiniteNumber(ranked[index].appearances)
      ) {
        end += 1;
      }
      const score = roundDiscoverScore((denominator - index) / denominator);
      for (let tiedIndex = index; tiedIndex < end; tiedIndex += 1) {
        scores.set(`${platform}:${ranked[tiedIndex].id}`, score);
      }
      index = end;
    }
  }

  return scores;
}

export function buildDiscoverFeed(
  rows: DiscoverTrendRow[],
  options: { allPlatforms: boolean; limit?: number },
): DiscoverFeedItem[] {
  const scores = scoreDiscoverRowsByPlatformPercentile(rows);
  const rankingBasis: DiscoverRankingBasis = options.allPlatforms
    ? DISCOVER_RANKING_BASIS_PLATFORM_PERCENTILE
    : DISCOVER_RANKING_BASIS_APPEARANCES;
  const feed = rows.map((row) => {
    const appearances = Math.max(
      0,
      Math.round(toFiniteNumber(row.appearances)),
    );
    const platform = String(row.platform);
    let cleanCreator = row.creator || "Unknown Creator";
    if (platform === "tiktok" && cleanCreator.includes("/@")) {
      const parts = cleanCreator.split("/@");
      cleanCreator = parts[1]?.split("/")[0] || cleanCreator;
    }
    cleanCreator = cleanCreator.replace(/^@/, "");

    let url = "";
    if (platform === "youtube") url = `https://youtube.com/watch?v=${row.id}`;
    if (platform === "tiktok") {
      const handle =
        cleanCreator === "Unknown Creator" || !cleanCreator
          ? ""
          : cleanCreator.replace(/\s+/g, "");
      url = `https://www.tiktok.com/@${handle}/video/${row.id}`;
    }
    if (platform === "reddit") {
      const sub =
        cleanCreator === "Unknown Creator" || !cleanCreator
          ? "reddit"
          : `r/${cleanCreator.replace(/\s+/g, "")}`;
      url = `https://www.reddit.com/${sub}/comments/${row.id}`;
    }

    const normalizedScore = scores.get(`${platform}:${row.id}`) ?? 0;

    return {
      id: row.id,
      title: row.title,
      creator: cleanCreator,
      platform,
      timestamp: row.timestamp,
      url,
      reachMetrics: options.allPlatforms
        ? `Appearance percentile ${Math.round(normalizedScore * 100)} within observed ${platform} items; observed ${appearances} times`
        : `Observed ${appearances} times`,
      appearances,
      normalizedScore,
      rankingBasis,
      contentFamily: discoverContentFamilyForPlatform(platform),
    };
  });

  feed.sort((left, right) => {
    if (options.allPlatforms) {
      const scoreDelta = right.normalizedScore - left.normalizedScore;
      if (scoreDelta !== 0) return scoreDelta;
    }
    const appearanceDelta = right.appearances - left.appearances;
    if (appearanceDelta !== 0) return appearanceDelta;
    return timestampMs(right.timestamp) - timestampMs(left.timestamp);
  });

  return feed.slice(0, options.limit ?? DISCOVER_POPULAR_LIMIT);
}
