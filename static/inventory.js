const grid = document.getElementById('tetris-grid');
const rotateButton = document.getElementById('rotate-item');
const autoPackButton = document.getElementById('auto-pack');
const contextMenu = document.getElementById('context-menu');
const transferModal = document.getElementById('transfer-modal');
const transferPlayers = document.getElementById('transfer-players');
const transferClose = document.getElementById('transfer-close');
const embeddedInventory = document.querySelector('.inventory--embedded');
const characterSwitcher = document.querySelector('.character-switcher');

const gridConfig = { columns: 12, rows: 8 };

const defaultItems = [
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
        entry: { qty: 1, rotation: 0, position: { x: 1, y: 1 } },
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
        entry: { qty: 1, rotation: 0, position: { x: 3, y: 1 } },
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
        entry: { qty: 3, rotation: 0, position: { x: 6, y: 1 } },
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
        entry: { qty: 280, rotation: 0, position: { x: 8, y: 2 } },
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
        entry: { qty: 20, rotation: 0, position: { x: 1, y: 5 } },
    },
];

let items = Array.isArray(window.INVENTORY_DATA) && window.INVENTORY_DATA.length
    ? window.INVENTORY_DATA
    : defaultItems;

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

const transferPlayersList = Array.isArray(window.TRANSFER_PLAYERS) ? window.TRANSFER_PLAYERS : [];

const state = {
    draggingId: null,
    ghost: null,
    lastValid: null,
    lastPointer: null,
    transferItemId: null,
};

    let items = [];
    let equipped = {
        head: null,
        body: null,
        hands: null,
        legs: null,
        weapon: null,
        offhand: null,
        amulet: null,
        ring: null,
    };

    const players = Array.from(document.querySelectorAll('.character-switcher__chip')).map((chip) => ({
        id: chip.dataset.playerId || chip.textContent.trim(),
        name: chip.textContent.trim(),
    }));

    const state = {
        draggingId: null,
        ghost: null,
        lastValid: null,
        lastPointer: null,
    };

    const getItemById = (id) => items.find((item) => item.id === id);

    const getItemSize = (item) => {
        if (item.entry.rotation === 90) {
            return { w: item.size.h, h: item.size.w };
        }
        return { w: item.size.w, h: item.size.h };
    };

    const getStorageKey = (playerId) => `${storagePrefix}${playerId}`;

    const loadInventory = (playerId) => {
        const raw = localStorage.getItem(getStorageKey(playerId));
        if (!raw) {
            return { items: [], equipped: { ...equipped } };
        }
        try {
            const parsed = JSON.parse(raw);
            return {
                items: Array.isArray(parsed.items) ? parsed.items : [],
                equipped: parsed.equipped || { ...equipped },
            };
        } catch (error) {
            console.warn('Failed to load inventory from storage', error);
            return { items: [], equipped: { ...equipped } };
        }
    };

const setItems = (nextItems) => {
    items = nextItems;
    state.draggingId = null;
    state.ghost = null;
    state.lastValid = null;
    state.lastPointer = null;
    renderItems();
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

    const syncCurrentInventory = () => {
        saveInventory(currentPlayerId, { items, equipped });
    };

    const loadCurrentInventory = () => {
        const stored = loadInventory(currentPlayerId);
        items = stored.items;
        equipped = { ...equipped, ...stored.equipped };
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

    const isPositionValid = (itemId, position, size, pool = items) => {
        if (position.x < 1 || position.y < 1) {
            return { valid: false, overlap: null };
        }
        if (position.x + size.w - 1 > gridConfig.columns || position.y + size.h - 1 > gridConfig.rows) {
            return { valid: false, overlap: null };
        }
        let overlapItem = null;
        for (const other of pool) {
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

    const findFreePosition = (item, pool = items) => {
        const size = getItemSize(item);
        for (let row = 1; row <= gridConfig.rows; row += 1) {
            for (let col = 1; col <= gridConfig.columns; col += 1) {
                const check = isPositionValid(item.id, { x: col, y: row }, size, pool);
                if (check.valid) {
                    return { x: col, y: row };
                }
            }
        }
        return null;
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
            element.addEventListener('contextmenu', (event) => openContextMenu(event, item.id));
            grid.appendChild(element);
        });
    };

    const startDrag = (event, itemId) => {
        event.preventDefault();
        const item = getItemById(itemId);
        if (!item) return;
        state.draggingId = itemId;
        const ghost = document.createElement('div');
        ghost.className = 'inventory-ghost';
        state.ghost = ghost;
        grid.appendChild(ghost);
        const element = grid.querySelector(`[data-item-id="${itemId}"]`);
        element?.classList.add('is-dragging');
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
            syncCurrentInventory();
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
        } else if (check.overlap && item.stackable && check.overlap.id === item.id) {
            const space = check.overlap.maxStack - check.overlap.entry.qty;
            const moved = Math.min(space, item.entry.qty);
            check.overlap.entry.qty += moved;
            item.entry.qty -= moved;
            if (item.entry.qty <= 0) {
                item.entry.position = null;
            }
        }
        cleanupDrag(item.id);
        renderItems();
        syncCurrentInventory();
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

    const rotateDragging = () => {
        const item = getItemById(state.draggingId);
        if (!item || !item.rotatable) return;
        item.entry.rotation = item.entry.rotation === 90 ? 0 : 90;
        updateGhost();
        renderItems();
        syncCurrentInventory();
    };

    const openContextMenu = (event, itemId) => {
        if (!contextMenu) return;
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
        if (!contextMenu) return;
        contextMenu.classList.remove('is-open');
        contextMenu.dataset.itemId = '';
    };

    const openTransferModal = () => {
        if (!transferPlayers || !transferModal) return;
        transferPlayers.innerHTML = '';
        const list = players.length
            ? players
            : [{ id: 'self', name: 'Гравець' }];
        list.forEach((player) => {
            const row = document.createElement('div');
            row.className = 'transfer-player';
            row.innerHTML = `<span>${player.name}</span><button class="button ghost" type="button">Передати</button>`;
            transferPlayers.appendChild(row);
        });
        transferModal.classList.add('is-open');
    };

const openTransferModal = (itemId) => {
    state.transferItemId = itemId;
    transferPlayers.innerHTML = '';
    transferPlayersList.forEach((player) => {
        if (String(player.id) === String(window.CURRENT_USER_ID)) {
            return;
        }
        const row = document.createElement('div');
        row.className = 'transfer-player';
        row.innerHTML = `<span>${player.name}</span><button class="button ghost" type="button" data-player-id="${player.id}">Передати</button>`;
        transferPlayers.appendChild(row);
    });
    transferModal.classList.add('is-open');
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
        if (!contextMenu) return;
        contextMenu.querySelectorAll('[data-action]').forEach((button) => {
            button.addEventListener('click', () => {
                const action = button.dataset.action;
                const itemId = contextMenu.dataset.itemId;
                const item = getItemById(itemId);
                if (!item) {
                    closeContextMenu();
                    return;
                }
                if (action === 'transfer') {
                    openTransferModal();
                }
                if (action === 'rotate' && item.rotatable) {
                    item.entry.rotation = item.entry.rotation === 90 ? 0 : 90;
                    renderItems();
                    syncCurrentInventory();
                }
                if (action === 'drop') {
                    items = items.filter((entry) => entry.id !== itemId);
                    renderItems();
                    syncCurrentInventory();
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
                item.entry.position = findFreePosition(item) || { x: 1, y: 1 };
                slot.dataset.itemId = '';
                slot.classList.remove('is-filled');
                slot.textContent = slot.dataset.slotLabel;
                renderItems();
                syncCurrentInventory();
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
        return true;
    };

    const setupMasterPanel = () => {
        document.querySelectorAll('.master-panel').forEach((panel) => {
            const button = panel.querySelector('button.button');
            if (!button) return;
            button.addEventListener('click', () => {
                const name = panel.querySelector('input[type="text"]')?.value?.trim();
                const type = panel.querySelector('select[id^="item_type_"]')?.value || 'other';
                const quality = panel.querySelector('select[id^="item_quality_"]')?.value || 'common';
                const weight = parseFloat(panel.querySelector('input[id^="item_weight_"]')?.value || '0');
                const width = parseInt(panel.querySelector('input[id^="item_w_"]')?.value || '1', 10);
                const height = parseInt(panel.querySelector('input[id^="item_h_"]')?.value || '1', 10);
                const target = panel.querySelector('select[id^="item_target_"]')?.value || currentPlayerId;

                if (!name) {
                    alert('Вкажіть назву предмета.');
                    return;
                }

                const newItem = {
                    id: `item_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
                    name,
                    type,
                    size: { w: width, h: height },
                    rotatable: true,
                    stackable: false,
                    quality,
                    maxStack: 1,
                    weight: Number.isFinite(weight) ? weight : 0,
                    description: 'Предмет, створений майстром.',
                    equipSlot: type === 'weapon' ? 'weapon' : type === 'armor' ? 'body' : null,
                    entry: { qty: 1, rotation: 0, position: null },
                };

                const targetInventory = loadInventory(target);
                newItem.entry.position = findFreePosition(newItem, targetInventory.items);
                targetInventory.items.push(newItem);
                saveInventory(target, targetInventory);

                if (target === currentPlayerId) {
                    items = targetInventory.items;
                    renderItems();
                    syncCurrentInventory();
                }

                panel.querySelector('input[type="text"]').value = '';
            });
        });
    };

    document.addEventListener('keydown', (event) => {
        if (event.key.toLowerCase() === 'r') {
            rotateDragging();
        }
    });

    rotateButton?.addEventListener('click', rotateDragging);
    autoPackButton?.addEventListener('click', () => {
        alert('Auto-pack поки що недоступний у демо.');
    });
    transferClose?.addEventListener('click', closeTransferModal);
    transferModal?.addEventListener('click', (event) => {
        if (event.target === transferModal) closeTransferModal();
    });
    document.addEventListener('click', (event) => {
        if (contextMenu && !contextMenu.contains(event.target)) {
            closeContextMenu();
        }
    });

    loadCurrentInventory();
    createGridCells();
    renderItems();
    setupTabs();
    setupContextActions();
    setupEquipSlots();
    setupMasterPanel();
};

const lobbyId = embeddedInventory?.dataset.lobbyId;
const canViewOtherInventory = embeddedInventory?.dataset.canView === 'true';
let selectedPlayerId = embeddedInventory?.dataset.playerId || null;

const setSelectedPlayer = (playerId) => {
    selectedPlayerId = playerId;
    if (!characterSwitcher) return;
    characterSwitcher.querySelectorAll('.character-switcher__chip').forEach((chip) => {
        chip.classList.toggle('is-active', chip.dataset.playerId === playerId);
    });
};

const loadInventoryForPlayer = async (playerId) => {
    if (!playerId || !lobbyId) return;
    try {
        const response = await fetch(`/api/inventory/${playerId}?lobby_id=${lobbyId}`);
        if (!response.ok) {
            throw new Error('Не вдалося завантажити інвентар.');
        }
        const data = await response.json();
        setItems(Array.isArray(data) ? data : []);
    } catch (error) {
        alert(error.message || 'Не вдалося завантажити інвентар.');
    }
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
transferPlayers.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-player-id]');
    if (!button) return;
    const recipientId = button.dataset.playerId;
    const item = getItemById(state.transferItemId);
    if (!item) return;
    let amount = item.entry.qty;
    if (item.stackable && item.entry.qty > 1) {
        const input = window.prompt(`Скільки передати? (1-${item.entry.qty})`, `${item.entry.qty}`);
        if (!input) return;
        const parsed = Number.parseInt(input, 10);
        if (Number.isNaN(parsed) || parsed < 1 || parsed > item.entry.qty) {
            alert('Некоректна кількість.');
            return;
        }
        amount = parsed;
    }
    const response = await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            recipient_id: recipientId,
            item_id: item.id,
            amount,
        }),
    });
    if (response.ok) {
        closeTransferModal();
    } else {
        const payload = await response.json().catch(() => ({}));
        alert(payload.error || 'Не вдалося передати предмет.');
    }
});
document.addEventListener('click', (event) => {
    if (!contextMenu.contains(event.target)) {
        closeContextMenu();
    }
});

if (characterSwitcher) {
    const chips = characterSwitcher.querySelectorAll('.character-switcher__chip');
    if (chips.length && !selectedPlayerId) {
        setSelectedPlayer(chips[0].dataset.playerId);
    }
    chips.forEach((chip) => {
        chip.addEventListener('click', () => {
            setSelectedPlayer(chip.dataset.playerId);
            if (canViewOtherInventory) {
                loadInventoryForPlayer(chip.dataset.playerId);
            }
        });
    });
    if (canViewOtherInventory && selectedPlayerId) {
        loadInventoryForPlayer(selectedPlayerId);
    }
}

window.addEventListener('inventory-transfer-updated', () => {
    const currentUserId = window.CURRENT_USER_ID;
    if (!currentUserId) return;
    if (embeddedInventory && selectedPlayerId === String(currentUserId)) {
        loadInventoryForPlayer(selectedPlayerId);
        return;
    }
    if (!embeddedInventory && grid && String(currentUserId)) {
        fetch(`/api/inventory/${currentUserId}`)
            .then((response) => (response.ok ? response.json() : []))
            .then((data) => setItems(Array.isArray(data) ? data : []))
            .catch(() => {});
    }
});

createGridCells();
renderItems();
setupTabs();
setupContextActions();
setupEquipSlots();
