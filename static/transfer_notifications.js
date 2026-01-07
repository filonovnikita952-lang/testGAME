const notificationContainer = document.getElementById('transfer-notifications');
const currentUserId = window.CURRENT_USER_ID;

const renderNotifications = (transfers) => {
    if (!notificationContainer) return;
    notificationContainer.innerHTML = '';
    transfers.forEach((transfer) => {
        const card = document.createElement('div');
        card.className = 'transfer-notification';
        card.innerHTML = `
            <div class="transfer-notification__content">
                <strong>${transfer.sender_name} передає предмет</strong>
                <span>${transfer.item_name} ×${transfer.amount}</span>
            </div>
            <div class="transfer-notification__actions">
                <button class="button" type="button" data-action="accept" data-id="${transfer.id}">Прийняти</button>
                <button class="button ghost" type="button" data-action="decline" data-id="${transfer.id}">Відхилити</button>
            </div>
        `;
        notificationContainer.appendChild(card);
    });
};

const fetchTransfers = async () => {
    if (!currentUserId) return;
    const response = await fetch('/api/transfers/pending');
    if (!response.ok) return;
    const transfers = await response.json();
    renderNotifications(transfers);
};

const handleAction = async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const transferId = button.dataset.id;
    const response = await fetch(`/api/transfers/${transferId}/${action}`, { method: 'POST' });
    if (response.ok) {
        await fetchTransfers();
        window.dispatchEvent(new CustomEvent('inventory-transfer-updated'));
    } else {
        await response.json().catch(() => ({}));
    }
};

if (notificationContainer && currentUserId) {
    notificationContainer.addEventListener('click', handleAction);
    fetchTransfers();
    setInterval(fetchTransfers, 5000);
}
