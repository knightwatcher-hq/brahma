/**
 * BRAHMA YANTRA — CENTRAL ENGINE v2
 * Single source of truth for all data fetching and utilities.
 * Load in every HTML file: <script src="by-engine.js"></script>
 *
 * TO ADD A NEW PAGE:
 *   1. Add <script src="by-engine.js"></script> to its <head>
 *   2. Replace your fetch logic with: BY_ENGINE.getSheetData('tabname')
 *   3. That's it.
 */

const BY_CONFIG = {
    // ONE key used by ALL pages — launcher sets it, all pages read it
    URL_KEY:   'brahma_script_url',
    CACHE_KEY: 'by_cache',
    CACHE_TTL: 5 * 60 * 1000,   // 5 minutes
};

const BY_ENGINE = {

    // ── GET URL ─────────────────────────────────────────────
    getURL() {
        const url = localStorage.getItem(BY_CONFIG.URL_KEY);
        if (!url || !url.startsWith('https://script.google.com')) {
            throw new Error('NO_URL');  // caught by callers
        }
        return url;
    },

    // ── READ from Sheet (GET) ────────────────────────────────
    async getSheetData(tabName = 'daily', forceRefresh = false) {
        const cacheKey = `${BY_CONFIG.CACHE_KEY}_${tabName}`;

        // Try cache first
        if (!forceRefresh) {
            try {
                const cached = JSON.parse(localStorage.getItem(cacheKey));
                if (cached && Date.now() - cached.ts < BY_CONFIG.CACHE_TTL) {
                    return cached.data;
                }
            } catch (_) {}
        }

        // Fetch fresh
        const url = this.getURL();
        const res  = await fetch(`${url}?tab=${tabName}&t=${Date.now()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.status !== 'ok') throw new Error(json.message || 'Sheet error');

        // Cache it
        localStorage.setItem(cacheKey, JSON.stringify({
            ts:   Date.now(),
            data: json.data,
        }));

        return json.data;
    },

    // ── WRITE to Sheet (POST, no-cors) ───────────────────────
    async postData(payload) {
        const url = this.getURL();
        await fetch(url, {
            method:  'POST',
            mode:    'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload),
        });
        // no-cors gives opaque response — assume success
        // Clear cache for the tab we just wrote to
        if (payload.tab) {
            localStorage.removeItem(`${BY_CONFIG.CACHE_KEY}_${payload.tab}`);
        }
        this.clearCache(); // clear all — safest after a write
    },

    // ── CLEAR CACHE ──────────────────────────────────────────
    clearCache(tabName = null) {
        if (tabName) {
            localStorage.removeItem(`${BY_CONFIG.CACHE_KEY}_${tabName}`);
            return;
        }
        Object.keys(localStorage)
            .filter(k => k.startsWith(BY_CONFIG.CACHE_KEY))
            .forEach(k => localStorage.removeItem(k));
    },

    // ── CHECK if URL is configured ───────────────────────────
    isConfigured() {
        const url = localStorage.getItem(BY_CONFIG.URL_KEY);
        return !!(url && url.startsWith('https://script.google.com'));
    },
};

// ── SHARED UTILITIES ─────────────────────────────────────────
// Attach to window.BY so every page can use BY.parseDate() etc.
window.BY = Object.assign(window.BY || {}, {

    parseDate(s) {
        if (!s) return null;
        const str = String(s).trim();
        // DD/MM/YYYY
        let m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (m) return new Date(+m[3], +m[2]-1, +m[1]);
        // YYYY-MM-DD
        m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) return new Date(+m[1], +m[2]-1, +m[3]);
        return null;
    },

    formatDate(d) {
        if (!d) return '';
        return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    },

    todayStr() {
        return BY.formatDate(new Date());
    },

    // Parse "20+20+15+15" → { parts, total, sets, best }
    parseSets(str) {
        if (!str || !str.trim()) return { parts:[], total:0, sets:0, best:0, raw:'' };
        const parts = String(str).split('+')
            .map(s => parseInt(s.trim()))
            .filter(n => !isNaN(n) && n > 0);
        return {
            raw:   str.trim(),
            parts,
            total: parts.reduce((a,b) => a+b, 0),
            sets:  parts.length,
            best:  parts.length ? Math.max(...parts) : 0,
        };
    },

    // Days between two Date objects
    daysBetween(a, b) {
        return Math.floor(Math.abs(b - a) / 86400000);
    },

    pad2(n) { return String(n).padStart(2,'0'); },
});

// ── ENGINE REFERENCE ON WINDOW ────────────────────────────────
window.BY_ENGINE = BY_ENGINE;