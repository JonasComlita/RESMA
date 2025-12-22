import React from 'react';
import { useQuery } from '@tanstack/react-query';

type FeedItem = {
  id: string;
  videoId: string;
  creatorHandle: string | null;
  positionInFeed: number;
  caption: string | null;
  engagementMetrics: any;
};

type FeedSnapshot = {
  id: string;
  capturedAt: string;
  itemCount: number;
  feedItems: FeedItem[];
};

const fetchYouTubeSnapshots = async (): Promise<FeedSnapshot[]> => {
  const res = await fetch('/api/feeds?platform=youtube');
  if (!res.ok) throw new Error('Failed to fetch YouTube feeds');
  const data = await res.json();
  // Adapt to your backend response structure
  return data.snapshots || [];
};

const YouTubeDashboard: React.FC = () => {
  const { data: snapshots, isLoading, error } = useQuery({
    queryKey: ['youtubeFeeds'],
    queryFn: fetchYouTubeSnapshots,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  return (
    <div>
      <h1>YouTube Dashboard</h1>
      {isLoading && <p>Loading YouTube feed data...</p>}
      {error && (
        <div style={{ color: 'red', margin: '1rem 0' }}>
          <strong>Error loading feeds:</strong> {error instanceof Error ? error.message : 'Unknown error'}
          <br />
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}
      {snapshots && snapshots.length === 0 && <p>No YouTube feed data found.</p>}
      {snapshots && snapshots.map((snap) => (
        <div key={snap.id} style={{ border: '1px solid #ccc', margin: '1rem 0', padding: '1rem' }}>
          <h3>Snapshot: {new Date(snap.capturedAt).toLocaleString()}</h3>
          <p>Items: {snap.itemCount}</p>
          <ul>
            {snap.feedItems.map((item) => (
              <li key={item.id} style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center' }}>
                {item.engagementMetrics?.thumbnail && (
                  <img src={item.engagementMetrics.thumbnail} alt="thumbnail" style={{ width: 80, height: 45, marginRight: 12, objectFit: 'cover', borderRadius: 4 }} />
                )}
                <div>
                  <strong>{item.caption}</strong> <br />
                  Channel: {item.creatorHandle} <br />
                  Video ID: {item.videoId} <br />
                  Position: {item.positionInFeed} <br />
                  Views: {item.engagementMetrics?.views || 'N/A'} <br />
                  {item.contentTags && item.contentTags.length > 0 && (
                    <span>Tags: {item.contentTags.join(', ')}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

import YouTubeFeedCharts from '../components/YouTubeFeedCharts';

const YouTubeDashboardWithCharts: React.FC = () => (
  <>
    <YouTubeDashboard />
    <YouTubeFeedCharts />
  </>
);

export default YouTubeDashboardWithCharts;
