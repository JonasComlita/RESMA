// Content script for observing YouTube feed data
console.log('YouTube observer loaded');

// Helper to extract video data from the YouTube homepage feed
function extractYouTubeFeed() {
	const items = Array.from(document.querySelectorAll('ytd-rich-item-renderer'));
	return items.map((item, idx) => {
		const titleEl = item.querySelector('#video-title');
		const channelEl = item.querySelector('ytd-channel-name, #channel-name');
		const thumbnailEl = item.querySelector('img#img');
		const viewsEl = item.querySelector('#metadata-line span');
		const videoId = titleEl?.href?.split('v=')[1]?.split('&')[0] || null;
		// Try to extract tags/categories from badges or metadata
		const badges = Array.from(item.querySelectorAll('ytd-badge-supported-renderer'));
		const tags = badges.map(b => b.textContent?.trim()).filter(Boolean);
		// User interaction: listen for click events on video
		titleEl?.addEventListener('click', () => {
			chrome.runtime.sendMessage({ type: 'YOUTUBE_VIDEO_CLICK', videoId });
		}, { once: true });
		return {
			position: idx + 1,
			videoId,
			title: titleEl?.textContent?.trim() || null,
			channel: channelEl?.textContent?.trim() || null,
			thumbnail: thumbnailEl?.src || null,
			views: viewsEl?.textContent?.trim() || null,
			tags,
			timestamp: new Date().toISOString(),
		};
	});
}

// Send feed data to background script
function sendFeedData() {
	const feed = extractYouTubeFeed();
	chrome.runtime.sendMessage({ type: 'YOUTUBE_FEED_SNAPSHOT', feed });
}

// Observe changes to the feed (homepage recommendations)
const feedContainer = document.querySelector('ytd-rich-grid-renderer');
if (feedContainer) {
	const observer = new MutationObserver(() => {
		sendFeedData();
	});
	observer.observe(feedContainer, { childList: true, subtree: true });
	// Initial snapshot
	sendFeedData();
}
