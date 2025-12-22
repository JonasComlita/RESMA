// Background logic for handling YouTube data capture
console.log('YouTube background service loaded');

// Listen for messages from the content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.type === 'YOUTUBE_FEED_SNAPSHOT') {
		// Relay feed data to backend API
		fetch('http://localhost:3000/youtube/feed', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				// Optionally add authentication headers here
			},
			body: JSON.stringify({ feed: message.feed }),
		})
			.then((res) => res.json())
			.then((data) => {
				console.log('YouTube feed data uploaded:', data);
			})
			.catch((err) => {
				console.error('Failed to upload YouTube feed data:', err);
			});
	}
});
