import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#A28CFF', '#FF6699', '#FF4444', '#44FF44', '#4444FF', '#AAAAAA'];

const InstagramFeedCharts: React.FC = () => {
  const { data: snapshots, isLoading, error } = useQuery({
    queryKey: ['instagramFeeds'],
    queryFn: async () => {
      const res = await fetch('/api/feeds?platform=instagram');
      if (!res.ok) throw new Error('Failed to fetch Instagram feeds');
      const data = await res.json();
      return data.snapshots || [];
    },
  });

  // Aggregate username and tag counts
  const userCounts: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  (snapshots || []).forEach((snap: any) => {
    snap.feedItems.forEach((item: any) => {
      if (item.creatorHandle) userCounts[item.creatorHandle] = (userCounts[item.creatorHandle] || 0) + 1;
      if (item.contentTags) item.contentTags.forEach((tag: string) => tagCounts[tag] = (tagCounts[tag] || 0) + 1);
    });
  });
  const topUsers = Object.entries(userCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([user, count]) => ({ user, count }));
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, count]) => ({ tag, count }));

  return (
    <div style={{ marginTop: 32 }}>
      <h2>Instagram Feed Charts</h2>
      {isLoading && <p>Loading charts...</p>}
      {error && <p style={{ color: 'red' }}>Error loading charts</p>}
      {snapshots && (
        <>
          <h3>Top Users</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={topUsers} layout="vertical">
              <XAxis type="number" allowDecimals={false} />
              <YAxis dataKey="user" type="category" width={120} />
              <Tooltip />
              <Bar dataKey="count" fill="#FF6699" />
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

export default InstagramFeedCharts;
