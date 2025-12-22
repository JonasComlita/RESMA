import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#A28CFF', '#FF6699', '#FF4444', '#44FF44', '#4444FF', '#AAAAAA'];

const YouTubeFeedCharts: React.FC = () => {
  const { data: snapshots, isLoading, error } = useQuery({
    queryKey: ['youtubeFeeds'],
    queryFn: async () => {
      const res = await fetch('/api/feeds?platform=youtube');
      if (!res.ok) throw new Error('Failed to fetch YouTube feeds');
      const data = await res.json();
      return data.snapshots || [];
    },
  });

  // Aggregate channel and tag counts
  const channelCounts: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  (snapshots || []).forEach((snap: any) => {
    snap.feedItems.forEach((item: any) => {
      if (item.creatorHandle) channelCounts[item.creatorHandle] = (channelCounts[item.creatorHandle] || 0) + 1;
      if (item.contentTags) item.contentTags.forEach((tag: string) => tagCounts[tag] = (tagCounts[tag] || 0) + 1);
    });
  });
  const topChannels = Object.entries(channelCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([channel, count]) => ({ channel, count }));
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, count]) => ({ tag, count }));

  return (
    <div style={{ marginTop: 32 }}>
      <h2>YouTube Feed Charts</h2>
      {isLoading && <p>Loading charts...</p>}
      {error && <p style={{ color: 'red' }}>Error loading charts</p>}
      {snapshots && (
        <>
          <h3>Top Channels</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={topChannels} layout="vertical">
              <XAxis type="number" allowDecimals={false} />
              <YAxis dataKey="channel" type="category" width={120} />
              <Tooltip />
              <Bar dataKey="count" fill="#0088FE" />
            </BarChart>
          </ResponsiveContainer>
          <h3>Top Tags</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={topTags} dataKey="count" nameKey="tag" cx="50%" cy="50%" outerRadius={80} label>
                {topTags.map((entry, idx) => (
                  <Cell key={`cell-${idx}`} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
};

export default YouTubeFeedCharts;
