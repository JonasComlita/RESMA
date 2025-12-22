import React from 'react';
import { useQuery } from '@tanstack/react-query';

// Types for Instagram feed
export type InstagramFeedItem = {
  id: string;
  postId: string;
  creatorHandle: string | null;
  positionInFeed: number;
  caption: string | null;
  engagementMetrics: any;
};

export type InstagramFeedSnapshot = {
  id: string;
  capturedAt: string;
  itemCount: number;
  feedItems: InstagramFeedItem[];
};

const fetchInstagramSnapshots = async (): Promise<InstagramFeedSnapshot[]> => {
  const res = await fetch('/api/feeds?platform=instagram');
  if (!res.ok) throw new Error('Failed to fetch Instagram feeds');
  const data = await res.json();
  return data.snapshots || [];
};

const InstagramDashboard: React.FC = () => {
  const { data: snapshots, isLoading, error } = useQuery({
    queryKey: ['instagramFeeds'],
    queryFn: fetchInstagramSnapshots,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  return (
    <div>
      <h1>Instagram Dashboard</h1>
      {isLoading && <p>Loading Instagram feed data...</p>}
      {error && (
        <div style={{ color: 'red', margin: '1rem 0' }}>
          <strong>Error loading feeds:</strong> {error instanceof Error ? error.message : 'Unknown error'}
          <br />
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}
      {snapshots && snapshots.length === 0 && <p>No Instagram feed data found.</p>}
      {snapshots && snapshots.map((snap) => (
        <div key={snap.id} style={{ border: '1px solid #ccc', margin: '1rem 0', padding: '1rem' }}>
          <h3>Snapshot: {new Date(snap.capturedAt).toLocaleString()}</h3>
          <p>Posts: {snap.itemCount}</p>
          <ul>
            {snap.feedItems.map((item) => (
              <li key={item.id}>
                <strong>{item.creatorHandle}</strong>: {item.caption}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

export default InstagramDashboard;
