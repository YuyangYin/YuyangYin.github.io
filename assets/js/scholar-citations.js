/*
 * Live Google Scholar citation badges.
 *
 * For each `.pub-citation[data-scholar-cid]` element on the page, this script
 * fetches the corresponding Scholar "view_citation" page through a public
 * CORS-friendly proxy and extracts the current citation count. Results are
 * cached in localStorage for 24 hours to be friendly to the proxy and to
 * Scholar, while still keeping the badge effectively up to date.
 *
 * If the request fails (network / proxy down / Scholar layout change),
 * the badge silently hides itself instead of showing a broken value.
 */
(function () {
	'use strict';

	var SCHOLAR_USER = 'r100Qh4AAAAJ';
	var CACHE_PREFIX = 'gs_cite_v1::';
	var CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

	// A handful of public CORS proxies. We try them in order until one works.
	function buildProxyUrls(targetUrl) {
		var enc = encodeURIComponent(targetUrl);
		return [
			'https://api.allorigins.win/raw?url=' + enc,
			'https://corsproxy.io/?' + enc,
			'https://api.codetabs.com/v1/proxy?quest=' + targetUrl
		];
	}

	function buildScholarUrl(cid) {
		return 'https://scholar.google.com/citations?view_op=view_citation&hl=en&user=' +
			encodeURIComponent(SCHOLAR_USER) +
			'&citation_for_view=' + encodeURIComponent(SCHOLAR_USER + ':' + cid);
	}

	function readCache(cid) {
		try {
			var raw = window.localStorage.getItem(CACHE_PREFIX + cid);
			if (!raw) return null;
			var obj = JSON.parse(raw);
			if (!obj || typeof obj.n !== 'number' || typeof obj.t !== 'number') return null;
			if (Date.now() - obj.t > CACHE_TTL_MS) return null;
			return obj.n;
		} catch (_) {
			return null;
		}
	}

	function writeCache(cid, n) {
		try {
			window.localStorage.setItem(
				CACHE_PREFIX + cid,
				JSON.stringify({ n: n, t: Date.now() })
			);
		} catch (_) { /* ignore quota errors */ }
	}

	function parseCitations(html) {
		if (!html || typeof html !== 'string') return null;

		// Strategy 1: the "Cited by N" link/text on the citation detail page.
		// e.g. <a ...>Cited by 123</a>
		var m = html.match(/Cited by\s*<\/?[^>]*>?\s*(\d[\d,]*)/i);
		if (m) return parseInt(m[1].replace(/,/g, ''), 10);

		m = html.match(/Cited by\s*(\d[\d,]*)/i);
		if (m) return parseInt(m[1].replace(/,/g, ''), 10);

		// Strategy 2: the "Citations" row in the metrics table.
		// <td class="gsc_oci_value">123</td> right after a "Citations" label.
		m = html.match(/Citations<\/[^>]+>[\s\S]{0,200}?gsc_oci_value[^>]*>\s*(\d[\d,]*)/i);
		if (m) return parseInt(m[1].replace(/,/g, ''), 10);

		return null;
	}

	function fetchWithProxies(urls) {
		// Try each proxy URL sequentially; resolve with the first non-empty
		// response, or reject if all of them fail.
		return new Promise(function (resolve, reject) {
			var i = 0;
			function tryNext() {
				if (i >= urls.length) {
					reject(new Error('all proxies failed'));
					return;
				}
				var url = urls[i++];
				fetch(url, { method: 'GET', credentials: 'omit' })
					.then(function (resp) {
						if (!resp.ok) throw new Error('bad status: ' + resp.status);
						return resp.text();
					})
					.then(function (text) {
						if (!text || text.length < 200) {
							throw new Error('empty body');
						}
						resolve(text);
					})
					.catch(function () { tryNext(); });
			}
			tryNext();
		});
	}

	function setBadge(el, n) {
		var numEl = el.querySelector('.pub-citation-num');
		if (numEl) numEl.textContent = String(n);
		el.classList.remove('is-loading');
		el.classList.add('is-ready');
		el.setAttribute('title', 'Cited by ' + n + ' (Google Scholar, auto-updated daily)');
	}

	function failBadge(el) {
		el.classList.remove('is-loading');
		el.classList.add('is-error');
	}

	function loadOne(el) {
		var cid = el.getAttribute('data-scholar-cid');
		if (!cid) return;
		el.classList.add('is-loading');

		var cached = readCache(cid);
		if (cached !== null) {
			setBadge(el, cached);
			return;
		}

		var target = buildScholarUrl(cid);
		fetchWithProxies(buildProxyUrls(target))
			.then(function (html) {
				var n = parseCitations(html);
				if (n === null || isNaN(n)) throw new Error('parse failed');
				writeCache(cid, n);
				setBadge(el, n);
			})
			.catch(function () { failBadge(el); });
	}

	function init() {
		var nodes = document.querySelectorAll('.pub-citation[data-scholar-cid]');
		Array.prototype.forEach.call(nodes, loadOne);
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
