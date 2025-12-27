const grid = document.getElementById('tetris-grid');
const rotateButton = document.getElementById('rotate-item');
const autoPackButton = document.getElementById('auto-pack');
const contextMenu = document.getElementById('context-menu');
const transferModal = document.getElementById('transfer-modal');
const transferPlayers = document.getElementById('transfer-players');
const transferClose = document.getElementById('transfer-close');

const gridConfig = { columns: 7, rows: 9 };

const items = [
    {
        id: 'sword_basic',
        name: 'Меч найманця',
        type: 'weapon',
        size: { w: 1, h: 3 },
        rotatable: true,
        stackable: false,
        quality: 'uncommon',
        maxStack: 1,
        weight: 3.2,
        description: 'Балансований клинок для ближнього бою.',
        equipSlot: 'weapon',
        entry: { qty: 1, rotated: false, position: { x: 1, y: 1 } },
    },
    {
        id: 'leather_armor',
        name: 'Шкіряна броня',
        type: 'armor',
        size: { w: 2, h: 3 },
        rotatable: false,
        stackable: false,
        quality: 'common',
        maxStack: 1,
        weight: 5.4,
        description: 'Легка броня для мандрівника.',
        equipSlot: 'body',
        entry: { qty: 1, rotated: false, position: { x: 3, y: 1 } },
    },
    {
        id: 'potion_heal',
        name: 'Зілля лікування',
        type: 'food',
        size: { w: 1, h: 2 },
        rotatable: true,
        stackable: true,
        quality: 'uncommon',
        maxStack: 5,
        weight: 0.3,
        description: 'Відновлює 12 HP.',
        equipSlot: null,
        entry: { qty: 3, rotated: false, position: { x: 6, y: 1 } },
    },
    {
        id: 'coin_pouch',
        name: 'Мішечок монет',
        type: 'money',
        size: { w: 1, h: 1 },
        rotatable: false,
        stackable: true,
        quality: 'common',
        maxStack: 9999,
        weight: 0.01,
        description: 'Золоті монети. Використовуються як предмет.',
        equipSlot: null,
        entry: { qty: 280, rotated: false, position: { x: 7, y: 3 } },
    },
    {
        id: 'arrow_bundle',
        name: 'Стрілковий набір',
        type: 'ammunition',
        size: { w: 2, h: 1 },
        rotatable: true,
        stackable: true,
        quality: 'common',
        maxStack: 30,
        weight: 0.1,
        description: 'Пучок стріл для лука.',
        equipSlot: null,
        entry: { qty: 20, rotated: false, position: { x: 1, y: 6 } },
    },
];

const equipped = {
    head: null,
    body: null,
    hands: null,
    legs: null,
    weapon: null,
    offhand: null,
    amulet: null,
    ring: null,
};

const players = ['Гравець 1', 'Гравець 2', 'Гравець 3'];

const state = {
    draggingId: null,
    ghost: null,
    lastValid: null,
    lastPointer: null,
    selectedId: null,
};

const getItemById = (id) => items.find((item) => item.id === id);

const getItemSize = (item) => {
    if (item.entry.rotated) {
        return { w: item.size.h, h: item.size.w };
    }
    return { w: item.size.w, h: item.size.h };
};

const inventoryStorageKey = 'dra.inventory.entries';

const persistInventory = () => {
    const payload = items.map((item) => ({
        id: item.id,
        entry: item.entry,
    }));
    localStorage.setItem(inventoryStorageKey, JSON.stringify(payload));
};

const loadInventory = () => {
    const stored = localStorage.getItem(inventoryStorageKey);
    if (!stored) return;
    try {
        const payload = JSON.parse(stored);
        payload.forEach((saved) => {
            const item = getItemById(saved.id);
            if (item && saved.entry) {
                item.entry = {
                    ...item.entry,
                    ...saved.entry,
                    rotated: Boolean(saved.entry.rotated),
                };
            }
        });
    } catch (error) {
        console.warn('Inventory load failed', error);
    }
};

const createGridCells = () => {
    grid.style.setProperty('--grid-columns', gridConfig.columns);
    grid.style.setProperty('--grid-rows', gridConfig.rows);
    grid.innerHTML = '';
    for (let row = 0; row < gridConfig.rows; row += 1) {
        for (let col = 0; col < gridConfig.columns; col += 1) {
            const cell = document.createElement('div');
            cell.className = 'tetris-cell';
            grid.appendChild(cell);
        }
    }
};

const renderItems = () => {
    const existing = grid.querySelectorAll('.inventory-item, .inventory-ghost');
    existing.forEach((node) => node.remove());
    items.forEach((item) => {
        if (!item.entry.position) {
            return;
        }
        const element = document.createElement('div');
        element.className = `inventory-item inventory-item--${item.type}`;
        element.dataset.itemId = item.id;
        const size = getItemSize(item);
        const { x, y } = item.entry.position;
        const metrics = cellSize();
        element.style.left = `${metrics.paddingX + (x - 1) * (metrics.width + metrics.gapX)}px`;
        element.style.top = `${metrics.paddingY + (y - 1) * (metrics.height + metrics.gapY)}px`;
        element.style.width = `${size.w * metrics.width + metrics.gapX * (size.w - 1) - 4}px`;
        element.style.height = `${size.h * metrics.height + metrics.gapY * (size.h - 1) - 4}px`;
        element.innerHTML = `
            <div class="inventory-item__label">${item.name}</div>
            ${item.stackable ? `<div class="inventory-item__qty">x${item.entry.qty}</div>` : ''}
        `;
        element.addEventListener('pointerdown', (event) => startDrag(event, item.id));
        element.addEventListener('click', () => selectItem(item.id));
        element.addEventListener('contextmenu', (event) => openContextMenu(event, item.id));
        grid.appendChild(element);
    });
};

const cellSize = () => {
    const rect = grid.getBoundingClientRect();
    const styles = getComputedStyle(grid);
    const paddingX = parseFloat(styles.paddingLeft) || 0;
    const paddingY = parseFloat(styles.paddingTop) || 0;
    const gapX = parseFloat(styles.columnGap) || 0;
    const gapY = parseFloat(styles.rowGap) || 0;
    const width = (rect.width - paddingX * 2 - gapX * (gridConfig.columns - 1)) / gridConfig.columns;
    const height = (rect.height - paddingY * 2 - gapY * (gridConfig.rows - 1)) / gridConfig.rows;
    return {
        width,
        height,
        paddingX,
        paddingY,
        gapX,
        gapY,
    };
};

const isPositionValid = (itemId, position, size) => {
    if (position.x < 1 || position.y < 1) {
        return { valid: false, overlap: null };
    }
    if (position.x + size.w - 1 > gridConfig.columns || position.y + size.h - 1 > gridConfig.rows) {
        return { valid: false, overlap: null };
    }
    let overlapItem = null;
    for (const other of items) {
        if (other.id === itemId || !other.entry.position) {
            continue;
        }
        const otherSize = getItemSize(other);
        const otherPos = other.entry.position;
        const overlapX = position.x < otherPos.x + otherSize.w && position.x + size.w > otherPos.x;
        const overlapY = position.y < otherPos.y + otherSize.h && position.y + size.h > otherPos.y;
        if (overlapX && overlapY) {
            overlapItem = other;
            break;
        }
    }
    return { valid: overlapItem === null, overlap: overlapItem };
};

const startDrag = (event, itemId) => {
    event.preventDefault();
    const item = getItemById(itemId);
    if (!item) return;
    state.draggingId = itemId;
    selectItem(itemId);
    const ghost = document.createElement('div');
    ghost.className = 'inventory-ghost';
    state.ghost = ghost;
    grid.appendChild(ghost);
    const element = grid.querySelector(`[data-item-id="${itemId}"]`);
    element.classList.add('is-dragging');
    updateGhost(event);
    window.addEventListener('pointermove', updateGhost);
    window.addEventListener('pointerup', endDrag);
};

const updateGhost = (event) => {
    const item = getItemById(state.draggingId);
    if (!item || !state.ghost) return;
    if (event?.clientX !== undefined) {
        state.lastPointer = { x: event.clientX, y: event.clientY };
    }
    const pointer = state.lastPointer;
    if (!pointer) return;
    const rect = grid.getBoundingClientRect();
    const size = getItemSize(item);
    const metrics = cellSize();
    const relativeX = pointer.x - rect.left - metrics.paddingX;
    const relativeY = pointer.y - rect.top - metrics.paddingY;
    const x = Math.floor(relativeX / (metrics.width + metrics.gapX)) + 1;
    const y = Math.floor(relativeY / (metrics.height + metrics.gapY)) + 1;
    const position = { x, y };
    const check = isPositionValid(item.id, position, size);
    state.lastValid = check.valid ? position : null;
    state.ghost.classList.toggle('is-invalid', !check.valid);
    state.ghost.style.left = `${metrics.paddingX + (x - 1) * (metrics.width + metrics.gapX)}px`;
    state.ghost.style.top = `${metrics.paddingY + (y - 1) * (metrics.height + metrics.gapY)}px`;
    state.ghost.style.width = `${size.w * metrics.width + metrics.gapX * (size.w - 1) - 4}px`;
    state.ghost.style.height = `${size.h * metrics.height + metrics.gapY * (size.h - 1) - 4}px`;
};

const endDrag = (event) => {
    const item = getItemById(state.draggingId);
    if (!item) return;
    const targetSlot = document.elementFromPoint(event.clientX, event.clientY)?.closest('.paper-doll__slot');
    if (targetSlot && tryEquip(item)) {
        cleanupDrag(item.id);
        renderItems();
        return;
    }
    const size = getItemSize(item);
    const rect = grid.getBoundingClientRect();
    const metrics = cellSize();
    const relativeX = event.clientX - rect.left - metrics.paddingX;
    const relativeY = event.clientY - rect.top - metrics.paddingY;
    const position = {
        x: Math.floor(relativeX / (metrics.width + metrics.gapX)) + 1,
        y: Math.floor(relativeY / (metrics.height + metrics.gapY)) + 1,
    };
    const check = isPositionValid(item.id, position, size);
    if (check.valid) {
        item.entry.position = position;
        persistInventory();
    } else if (check.overlap && item.stackable && check.overlap.id === item.id) {
        const space = check.overlap.maxStack - check.overlap.entry.qty;
        const moved = Math.min(space, item.entry.qty);
        check.overlap.entry.qty += moved;
        item.entry.qty -= moved;
        if (item.entry.qty <= 0) {
            item.entry.position = null;
        }
        persistInventory();
    }
    cleanupDrag(item.id);
    renderItems();
};

const cleanupDrag = (itemId) => {
    const element = grid.querySelector(`[data-item-id="${itemId}"]`);
    if (element) {
        element.classList.remove('is-dragging');
    }
    if (state.ghost) {
        state.ghost.remove();
    }
    state.draggingId = null;
    state.ghost = null;
    state.lastValid = null;
    state.lastPointer = null;
    window.removeEventListener('pointermove', updateGhost);
    window.removeEventListener('pointerup', endDrag);
};

const selectItem = (itemId) => {
    state.selectedId = itemId;
    grid.querySelectorAll('.inventory-item').forEach((node) => node.classList.remove('is-selected'));
    const element = grid.querySelector(`[data-item-id="${itemId}"]`);
    if (element) {
        element.classList.add('is-selected');
    }
};

const toggleRotation = (item) => {
    if (!item || !item.rotatable) return;
    item.entry.rotated = !item.entry.rotated;
    persistInventory();
};

const rotateDragging = () => {
    const item = getItemById(state.draggingId || state.selectedId);
    if (!item || !item.rotatable) return;
    toggleRotation(item);
    updateGhost();
    renderItems();
};

const openContextMenu = (event, itemId) => {
    event.preventDefault();
    const item = getItemById(itemId);
    if (!item) return;
    document.getElementById('context-name').textContent = item.name;
    document.getElementById('context-type').textContent = item.type;
    document.getElementById('context-quality').textContent = item.quality;
    const size = getItemSize(item);
    document.getElementById('context-size').textContent = `Розмір: ${size.w}×${size.h}`;
    document.getElementById('context-weight').textContent = `Вага: ${(item.weight * item.entry.qty).toFixed(1)}`;
    document.getElementById('context-description').textContent = item.description;
    contextMenu.dataset.itemId = itemId;
    contextMenu.classList.add('is-open');
};

const closeContextMenu = () => {
    contextMenu.classList.remove('is-open');
    contextMenu.dataset.itemId = '';
};

const openTransferModal = () => {
    transferPlayers.innerHTML = '';
    players.forEach((player) => {
        const row = document.createElement('div');
        row.className = 'transfer-player';
        row.innerHTML = `<span>${player}</span><button class="button ghost" type="button">Передати</button>`;
        transferPlayers.appendChild(row);
    });
    transferModal.classList.add('is-open');
};

const closeTransferModal = () => {
    transferModal.classList.remove('is-open');
};

const setupTabs = () => {
    document.querySelectorAll('.tab-button').forEach((button) => {
        button.addEventListener('click', () => {
            const target = button.dataset.tab;
            document.querySelectorAll('.tab-button').forEach((tab) => tab.classList.remove('is-active'));
            document.querySelectorAll('.tab-content').forEach((panel) => panel.classList.remove('is-active'));
            button.classList.add('is-active');
            document.querySelector(`[data-panel="${target}"]`).classList.add('is-active');
        });
    });
};

const setupContextActions = () => {
    contextMenu.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', () => {
            const action = button.dataset.action;
            if (action === 'transfer') {
                openTransferModal();
            }
            closeContextMenu();
        });
    });
};

const setupEquipSlots = () => {
    document.querySelectorAll('.paper-doll__slot').forEach((slot) => {
        slot.addEventListener('click', () => {
            if (!slot.dataset.itemId) return;
            const item = getItemById(slot.dataset.itemId);
            if (!item) return;
            item.entry.position = { x: 1, y: 1 };
            slot.dataset.itemId = '';
            slot.classList.remove('is-filled');
            slot.textContent = slot.dataset.slotLabel;
            renderItems();
            persistInventory();
        });
        slot.dataset.slotLabel = slot.textContent;
    });
};

const tryEquip = (item) => {
    if (!item.equipSlot) return false;
    const slot = document.querySelector(`.paper-doll__slot[data-slot="${item.equipSlot}"]`);
    if (!slot) return false;
    if (slot.dataset.itemId) {
        return false;
    }
    slot.dataset.itemId = item.id;
    slot.classList.add('is-filled');
    slot.textContent = item.name;
    item.entry.position = null;
    persistInventory();
    return true;
};

document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'r') {
        rotateDragging();
    }
});

rotateButton.addEventListener('click', rotateDragging);
autoPackButton.addEventListener('click', () => {
    alert('Auto-pack поки що недоступний у демо.');
});
transferClose.addEventListener('click', closeTransferModal);
transferModal.addEventListener('click', (event) => {
    if (event.target === transferModal) closeTransferModal();
});
document.addEventListener('click', (event) => {
    if (!contextMenu.contains(event.target)) {
        closeContextMenu();
    }
});

createGridCells();
loadInventory();
renderItems();
setupTabs();
setupContextActions();
setupEquipSlots();
