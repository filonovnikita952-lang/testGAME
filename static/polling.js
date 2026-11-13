/* One request at a time, with capped retry delay and no hidden-tab polling. */
((root) => {
    root.createPollRefresh = (interval, { fetcher = (...args) => fetch(...args), now = () => Date.now() } = {}) => {
        let pending = false;
        let failures = 0;
        let retryAt = 0;
        return async (url) => {
            if (document.hidden || pending || now() < retryAt) return undefined;
            pending = true;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            try {
                const response = await fetcher(url, { signal: controller.signal });
                if (!response.ok) throw new Error(`Refresh failed: HTTP ${response.status}`);
                const payload = await response.json();
                failures = 0;
                retryAt = 0;
                return payload;
            } catch (error) {
                failures = Math.min(failures + 1, 10);
                retryAt = now() + Math.min(60000, interval * 2 ** failures);
                console.debug('Refresh paused before retry', error);
                return undefined;
            } finally {
                clearTimeout(timeout);
                pending = false;
            }
        };
    };
})(typeof window === 'undefined' ? globalThis : window);
