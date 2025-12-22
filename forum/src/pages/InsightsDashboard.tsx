import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts';

const platforms = [
  { label: 'All', value: '' },
  { label: 'YouTube', value: 'youtube' },
  { label: 'TikTok', value: 'tiktok' },
  { label: 'Instagram', value: 'instagram' },
  { label: 'Twitter', value: 'twitter' },
  { label: 'Amazon', value: 'amazon' },
];

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#A28CFF', '#FF6699', '#FF4444', '#44FF44', '#4444FF', '#AAAAAA'];

const InsightsDashboard: React.FC = () => {
  const [platform, setPlatform] = React.useState('');
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['insights', platform],
    queryFn: async () => {
      const url = platform ? `/insights?platform=${platform}` : '/insights';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch insights');
      return res.json();
    },
  });

  // Diversity metric: how many unique channels/tags per snapshot
  const diversity = React.useMemo(() => {
    if (!data) return null;
    const channelDiversity = data.topChannels.length / (data.snapshotCount || 1);
    const tagDiversity = data.topTags.length / (data.snapshotCount || 1);
    return { channelDiversity, tagDiversity };
  }, [data]);

  return (
    <div>
      <h1>Cross-Platform Feed Insights</h1>
      <label>
        Platform:{' '}
        <select value={platform} onChange={e => setPlatform(e.target.value)}>
          {platforms.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </label>
      <button onClick={() => refetch()} style={{ marginLeft: 8 }}>Refresh</button>
      {isLoading && <p>Loading insights...</p>}
      {error && <p style={{ color: 'red' }}>Error loading insights</p>}
      {data && (
        <div style={{ marginTop: 16 }}>
          <p><strong>Snapshots analyzed:</strong> {data.snapshotCount}</p>
          <p><strong>Average items per snapshot:</strong> {data.avgItems.toFixed(2)}</p>
          <h3>Feed Diversity</h3>
          <ul>
            <li>Channel diversity: {diversity ? diversity.channelDiversity.toFixed(2) : 'N/A'} (unique channels per snapshot)</li>
            <li>Tag diversity: {diversity ? diversity.tagDiversity.toFixed(2) : 'N/A'} (unique tags per snapshot)</li>
          </ul>
          <h3>Top Channels</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.topChannels} layout="vertical">
              <XAxis type="number" allowDecimals={false} />
              <YAxis dataKey="channel" type="category" width={120} />
              <Tooltip />
              <Bar dataKey="count" fill="#0088FE" />
            </BarChart>
          </ResponsiveContainer>
          <h3>Top Tags</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={data.topTags} dataKey="count" nameKey="tag" cx="50%" cy="50%" outerRadius={80} label>
                {data.topTags.map((entry: any, idx: number) => (
                  <Cell key={`cell-${idx}`} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default InsightsDashboard;
