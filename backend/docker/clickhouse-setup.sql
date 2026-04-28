-- ClickHouse Setup for RESMA Analytics
-- This schema flattens the compressed Postgres MessagePack blobs into columnar analytical tables.

CREATE DATABASE IF NOT EXISTS resma;

-- Core Feed Events Table
CREATE TABLE IF NOT EXISTS resma.feed_events (
    snapshot_id UUID,
    video_id String,
    creator_id String,
    platform String,
    captured_at DateTime,
    
    -- Extracted engagement metrics (decompressed from Postgres MessagePack)
    likes_count UInt32,
    comments_count UInt32,
    shares_count UInt32,
    view_count UInt32,
    watch_duration Float32,
    
    -- Content tagging
    categories Array(String),
    tags Array(String),
    
    -- Interaction tracking
    interacted UInt8,
    interaction_type String

) ENGINE = MergeTree()
ORDER BY (platform, captured_at, video_id)
PARTITION BY toYYYYMM(captured_at);

-- Materialized View for Fast Creator Reach Analytics
CREATE MATERIALIZED VIEW IF NOT EXISTS resma.creator_reach_mv
TO resma.creator_reach_hourly
AS SELECT
    creator_id,
    platform,
    toStartOfHour(captured_at) as hour,
    uniqExact(snapshot_id) as unique_viewers,
    count() as total_impressions,
    avg(watch_duration) as avg_watch_time
FROM resma.feed_events
GROUP BY creator_id, platform, hour;

-- Target table for the materialized view
CREATE TABLE IF NOT EXISTS resma.creator_reach_hourly (
    creator_id String,
    platform String,
    hour DateTime,
    unique_viewers UInt32,
    total_impressions UInt32,
    avg_watch_time Float32
) ENGINE = SummingMergeTree()
ORDER BY (platform, creator_id, hour);
