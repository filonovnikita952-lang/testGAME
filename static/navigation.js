(() => {
    const header = document.querySelector('.header');
    const toggle = document.querySelector('.header__menu-button');
    if (!header || !toggle) return;
    const setOpen = (open) => {
        header.classList.toggle('is-menu-open', open);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? 'Закрити меню' : 'Меню';
    };
    toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
    header.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
            setOpen(false); toggle.focus();
        }
    });
    header.querySelector('.navigation')?.addEventListener('click', (event) => {
        if (event.target.closest('a')) setOpen(false);
    });
    matchMedia('(max-width: 860px)').addEventListener('change', () => setOpen(false));
    // Keep keyboard navigation inside an open transfer/shop dialog.
    document.addEventListener('keydown', (event) => {
        const overlay = document.querySelector('.transfer-modal.is-open, .shop-overlay.is-open');
        const dialog = overlay?.querySelector('[role="dialog"]');
        if (!dialog) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            dialog.querySelector('#transfer-close, [data-shop-close]')?.click();
        } else if (event.key === 'Tab') {
            const nodes = [...dialog.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]')]
                .filter(node => !node.disabled && node.getClientRects().length);
            const first = nodes[0], last = nodes[nodes.length - 1];
            if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
                event.preventDefault(); last?.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
                event.preventDefault(); first?.focus();
            }
        }
    }, true);
})();
