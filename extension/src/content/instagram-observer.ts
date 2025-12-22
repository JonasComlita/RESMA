// Content script for observing Instagram feed data
console.log('Instagram observer loaded');

// Helper to extract post data from the Instagram feed
function extractInstagramFeed() {
	const items = Array.from(document.querySelectorAll('article'));
	return items.map((item, idx) => {
		const usernameEl = item.querySelector('header a[role="link"]');
		const captionEl = item.querySelector('div[role="button"] > span, div[role="button"]');
		const imgEl = item.querySelector('img');
		const likesEl = item.querySelector('section span[aria-label*="like"]');
		const commentsEl = item.querySelector('section span[aria-label*="comment"]');
		const postId = item.querySelector('a[href*="/p/"]')?.getAttribute('href')?.split('/p/')[1]?.split('/')[0] || null;
		const tags = (captionEl?.textContent?.match(/#[\w]+/g) || []).map(t => t.slice(1));
		return {
			position: idx + 1,
			postId,
			username: usernameEl?.textContent?.trim() || null,
			caption: captionEl?.textContent?.trim() || null,
			thumbnail: imgEl?.src || null,
			likes: likesEl?.textContent?.trim() || null,
			comments: commentsEl?.textContent?.trim() || null,
			tags,
			timestamp: new Date().toISOString(),
		};
	});
}

// Send feed data to background script
function sendFeedData() {
	const feed = extractInstagramFeed();
	chrome.runtime.sendMessage({ type: 'INSTAGRAM_FEED_SNAPSHOT', feed });
}

// Observe changes to the feed (homepage recommendations)
const feedContainer = document.querySelector('main');
if (feedContainer) {
	const observer = new MutationObserver(() => {
		sendFeedData();
	});
	observer.observe(feedContainer, { childList: true, subtree: true });
	// Initial snapshot
	sendFeedData();
}
