(() => {
    const storageKey = 'dra-theme';
    const allowedThemes = ['light', 'default', 'dark'];
    const root = document.documentElement;
    const buttons = document.querySelectorAll('[data-theme-value]');

    const applyTheme = (theme) => {
        const normalized = allowedThemes.includes(theme) ? theme : 'default';

        if (normalized === 'default') {
            root.removeAttribute('data-theme');
        } else {
            root.setAttribute('data-theme', normalized);
        }

        buttons.forEach((button) => {
            const isActive = button.dataset.themeValue === normalized;
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    };

    const saved = localStorage.getItem(storageKey);
    applyTheme(saved || 'default');

    buttons.forEach((button) => {
        button.addEventListener('click', () => {
            const nextTheme = button.dataset.themeValue || 'default';
            localStorage.setItem(storageKey, nextTheme);
            applyTheme(nextTheme);
        });
    });
})();
