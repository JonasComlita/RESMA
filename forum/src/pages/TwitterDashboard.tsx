import React from 'react';
import TwitterFeedList from '../components/TwitterFeedList';
import TwitterFeedCharts from '../components/TwitterFeedCharts';

const TwitterDashboard: React.FC = () => {
  return (
    <div>
      <h1>Twitter Dashboard</h1>
      <TwitterFeedCharts />
      <TwitterFeedList />
    </div>
  );
};

export default TwitterDashboard;
