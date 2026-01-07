(() => {
    const inventoryRoots = document.querySelectorAll('[data-inventory-root]');
    if (!inventoryRoots.length) return;

    const lobbyInventories = window.LOBBY_INVENTORIES || {};
    const lobbyPlayers = window.LOBBY_TRANSFER_PLAYERS || {};
    const fallbackInventory = window.INVENTORY_DATA || null;
    const DEBUG_INVENTORY = String(window.DEBUG_INVENTORY || '') === '1';

    const containerTypeMap = {
        equip_head: ['head'],
        equip_shirt: ['shirt'],
        equip_pants: ['pants'],
        equip_armor: ['armor'],
        equip_boots: ['boots'],
        equip_weapon: ['weapon'],
        equip_back: ['backpack'],
        equip_amulet: ['amulet'],
        slot_weapon_main: ['weapon'],
        slot_shield: ['shield'],
    };

    const equipTargetMap = {
        weapon: 'equip_weapon',
        shield: 'slot_shield',
        backpack: 'equip_back',
        head: 'equip_head',
        shirt: 'equip_shirt',
        pants: 'equip_pants',
        armor: 'equip_armor',
        boots: 'equip_boots',
        amulet: 'equip_amulet',
    };

    class LobbyInventory {
        constructor(root) {
            this.root = root;
            this.lobbyId = root.dataset.lobbyId || null;
            this.currentUserId = root.dataset.currentUserId || null;
            this.selectedPlayerId = root.dataset.playerId || this.currentUserId;
            this.role = root.dataset.role || 'player';
            this.isMaster = root.dataset.isMaster === 'true';
            this.items = [];
            this.containers = new Map();
            this.permissions = { can_edit: false, is_master: false };
            this.dragState = null;
            this.contextMenu = document.getElementById('context-menu');
            this.transferModal = document.getElementById('transfer-modal');
            this.transferPlayers = document.getElementById('transfer-players');
            this.transferClose = document.getElementById('transfer-close');
            this.inventoryActions = this.root.querySelector('[data-inventory-actions]');
            this.weightDisplay = this.root.querySelector('[data-weight-display]');
            this.playerName = this.root.querySelector('[data-player-name]');
            this.playerRole = this.root.querySelector('[data-player-role]');
            this.gridElements = Array.from(this.root.querySelectorAll('.tetris-grid'));
            this.rosterList = this.lobbyId
                ? document.querySelector(`.lobby-roster__list[data-lobby-id="${this.lobbyId}"]`)
                : null;

            this.bindEvents();
            this.loadInitialState();
        }

        bindEvents() {
            if (this.rosterList) {
                this.rosterList.querySelectorAll('.roster-card').forEach((card) => {
                    card.addEventListener('click', () => {
                        const playerId = card.dataset.playerId;
                        if (!playerId) return;
                        this.setSelectedPlayer(playerId, card);
                    });
                });
            }

            if (this.inventoryActions) {
                this.inventoryActions.querySelector('[data-action="rotate-item"]')?.addEventListener('click', () => {
                    if (this.dragState?.item) {
                        this.toggleRotation(this.dragState.item);
                    }
                });
            }

            document.addEventListener('keydown', (event) => {
                if (event.key.toLowerCase() === 'r' && this.dragState?.item) {
                    this.toggleRotation(this.dragState.item);
                }
            });

            if (this.contextMenu) {
                document.addEventListener('click', (event) => {
                    if (!this.contextMenu.contains(event.target)) {
                        this.closeContextMenu();
                    }
                });

                this.contextMenu.querySelectorAll('[data-action]').forEach((button) => {
                    button.addEventListener('click', () => {
                        this.handleContextAction(button.dataset.action);
                    });
                });
            }

            this.transferClose?.addEventListener('click', () => this.closeTransferModal());
            this.transferModal?.addEventListener('click', (event) => {
                if (event.target === this.transferModal) this.closeTransferModal();
            });
        }

        loadInitialState() {
            if (this.lobbyId && lobbyInventories[this.lobbyId]) {
                this.applyInventory(lobbyInventories[this.lobbyId]);
                return;
            }
            if (fallbackInventory) {
                this.applyInventory(fallbackInventory);
                return;
            }
            if (this.selectedPlayerId) {
                this.refreshInventory(this.selectedPlayerId);
            }
        }

        async refreshInventory(playerId) {
            const targetId = playerId || this.selectedPlayerId;
            if (!targetId) return;
            const endpoint = this.lobbyId
                ? `/api/lobby/${this.lobbyId}/inventory/${targetId}`
                : `/api/inventory/${targetId}`;
            try {
                const response = await fetch(endpoint);
                if (!response.ok) {
                    throw new Error('Не вдалося завантажити інвентар.');
                }
                const payload = await response.json();
                this.applyInventory(payload);
            } catch (error) {
                alert(error.message || 'Не вдалося завантажити інвентар.');
            }
        }

        setSelectedPlayer(playerId, card) {
            this.selectedPlayerId = playerId;
            if (this.rosterList) {
                this.rosterList.querySelectorAll('.roster-card').forEach((item) => {
                    item.classList.toggle('is-selected', item.dataset.playerId === playerId);
                });
            }
            if (card) {
                card.open = true;
            }
            this.refreshInventory(playerId);
        }

        applyInventory(payload) {
            if (!payload) return;
            this.items = Array.isArray(payload.items) ? payload.items : [];
            this.permissions = payload.permissions || { can_edit: false, is_master: false };
            this.containers = new Map();
            (payload.containers || []).forEach((container) => {
                this.containers.set(container.id, container);
            });
            if (payload.user) {
                this.selectedPlayerId = payload.user.id;
                if (this.playerName) this.playerName.textContent = payload.user.name || 'Player';
                if (this.playerRole) {
                    const roleLabel = this.permissions.can_edit ? 'Керує' : 'Перегляд';
                    this.playerRole.textContent = roleLabel;
                }
            }
            if (this.weightDisplay && payload.weight) {
                this.weightDisplay.textContent = `Вага: ${payload.weight.current} / ${payload.weight.capacity} kg`;
            }
            this.root.classList.toggle('is-readonly', !this.permissions.can_edit);
            if (this.inventoryActions) {
                this.inventoryActions.classList.toggle('is-disabled', !this.permissions.can_edit);
            }
            this.syncBackpackContainer();
            this.render();
        }

        syncBackpackContainer() {
            const backpackContainer = Array.from(this.containers.values()).find((item) => item.is_backpack);
            const backpackGrid = this.gridElements.find((grid) => grid.dataset.containerRole === 'backpack');
            if (!backpackGrid) return;
            if (!backpackContainer) {
                backpackGrid.classList.add('is-hidden');
                backpackGrid.removeAttribute('data-container-id');
                backpackGrid.innerHTML = '';
                return;
            }
            backpackGrid.classList.remove('is-hidden');
            backpackGrid.dataset.containerId = backpackContainer.id;
        }

        render() {
            this.gridElements.forEach((grid) => {
                const containerId = grid.dataset.containerId;
                if (!containerId) return;
                const container = this.containers.get(containerId);
                if (!container) return;
                this.buildGrid(grid, container);
            });
            this.renderItems();
        }

        buildGrid(grid, container) {
            grid.style.setProperty('--grid-columns', container.w);
            grid.style.setProperty('--grid-rows', container.h);
            grid.innerHTML = '';
            for (let row = 0; row < container.h; row += 1) {
                for (let col = 0; col < container.w; col += 1) {
                    const cell = document.createElement('div');
                    cell.className = 'tetris-cell';
                    grid.appendChild(cell);
                }
            }
        }

        renderItems() {
            this.gridElements.forEach((grid) => {
                grid.querySelectorAll('.inventory-item, .inventory-ghost').forEach((node) => node.remove());
            });
            this.items.forEach((item) => {
                const grid = this.gridElements.find((el) => el.dataset.containerId === item.container_id);
                if (!grid || item.pos_x === null || item.pos_y === null) return;
                const container = this.containers.get(item.container_id);
                if (!container) return;
                const element = document.createElement('div');
                const qualityClass = `inventory-item--quality-${item.quality}`;
                element.className = `inventory-item inventory-item--${item.type} ${qualityClass}`;
                if (item.has_durability && item.str_current <= 0) {
                    element.classList.add('is-broken');
                }
                element.dataset.itemId = item.id;
                const size = this.getItemSize(item);
                const metrics = this.cellSize(grid, container);
                element.style.left = `${metrics.paddingX + (item.pos_x - 1) * (metrics.width + metrics.gapX)}px`;
                element.style.top = `${metrics.paddingY + (item.pos_y - 1) * (metrics.height + metrics.gapY)}px`;
                element.style.width = `${size.w * metrics.width + metrics.gapX * (size.w - 1) - 4}px`;
                element.style.height = `${size.h * metrics.height + metrics.gapY * (size.h - 1) - 4}px`;
                const durabilityLabel = item.has_durability
                    ? (item.str_current <= 0 ? 'Broken' : `${item.str_current}/${item.max_str}`)
                    : '—';
                element.innerHTML = `
                    <div class="inventory-item__label">${item.name}</div>
                    <div class="inventory-item__meta">${durabilityLabel}</div>
                    ${item.stackable ? `<div class="inventory-item__qty">x${item.amount}</div>` : ''}
                `;
                if (this.permissions.can_edit) {
                    element.addEventListener('pointerdown', (event) => this.startDrag(event, item));
                    element.addEventListener('contextmenu', (event) => this.openContextMenu(event, item));
                }
                grid.appendChild(element);
            });
        }

        cellSize(grid, container) {
            const rect = grid.getBoundingClientRect();
            const styles = getComputedStyle(grid);
            const paddingX = parseFloat(styles.paddingLeft) || 0;
            const paddingY = parseFloat(styles.paddingTop) || 0;
            const gapX = parseFloat(styles.columnGap) || 0;
            const gapY = parseFloat(styles.rowGap) || 0;
            const width = (rect.width - paddingX * 2 - gapX * (container.w - 1)) / container.w;
            const height = (rect.height - paddingY * 2 - gapY * (container.h - 1)) / container.h;
            return { width, height, paddingX, paddingY, gapX, gapY };
        }

        getItemSize(item) {
            if (item.rotated === 1) {
                return { w: item.size.h, h: item.size.w };
            }
            return { w: item.size.w, h: item.size.h };
        }

        startDrag(event, item) {
            event.preventDefault();
            const originGrid = this.gridElements.find((grid) => grid.dataset.containerId === item.container_id);
            if (!originGrid) return;
            const element = originGrid.querySelector(`[data-item-id="${item.id}"]`);
            const elementRect = element?.getBoundingClientRect();
            this.dragState = {
                item,
                originGrid,
                originContainer: item.container_id,
                ghost: document.createElement('div'),
                lastPointer: { x: event.clientX, y: event.clientY },
                preview: null,
                previewOffset: elementRect
                    ? { x: event.clientX - elementRect.left, y: event.clientY - elementRect.top }
                    : { x: 0, y: 0 },
            };
            this.dragState.ghost.className = 'inventory-ghost';
            originGrid.appendChild(this.dragState.ghost);
            element?.classList.add('is-dragging');
            if (element) {
                this.dragState.preview = element.cloneNode(true);
                this.dragState.preview.classList.add('inventory-drag-preview');
                this.dragState.preview.classList.remove('is-dragging');
                document.body.appendChild(this.dragState.preview);
                if (elementRect) {
                    this.dragState.preview.style.width = `${elementRect.width}px`;
                    this.dragState.preview.style.height = `${elementRect.height}px`;
                }
                this.updateDragPreviewPosition(event);
            }
            window.addEventListener('pointermove', this.onDragMove);
            window.addEventListener('pointerup', this.onDragEnd);
            this.updateGhost(event);
        }

        onDragMove = (event) => {
            if (!this.dragState) return;
            this.dragState.lastPointer = { x: event.clientX, y: event.clientY };
            this.updateGhost(event);
            this.updateDragPreviewPosition(event);
        };

        onDragEnd = async (event) => {
            if (!this.dragState) return;
            const { item } = this.dragState;
            const targetGrid = document.elementFromPoint(event.clientX, event.clientY)?.closest('.tetris-grid');
            const targetContainer = targetGrid?.dataset.containerId || null;
            const allowed = targetContainer ? this.isContainerAllowed(item, targetContainer) : false;
            let targetPosition = null;
            if (targetGrid && allowed) {
                targetPosition = this.getDropPosition(targetGrid, targetContainer, item, event);
            }
            if (targetGrid && allowed && targetPosition) {
                await this.submitMove(item, targetContainer, targetPosition);
            } else {
                this.renderItems();
            }
            this.cleanupDrag(item.id);
        };

        updateGhost(event) {
            if (!this.dragState) return;
            const { item, ghost } = this.dragState;
            const targetGrid = document.elementFromPoint(event.clientX, event.clientY)?.closest('.tetris-grid')
                || this.dragState.originGrid;
            if (!targetGrid) return;
            const containerId = targetGrid.dataset.containerId;
            const container = containerId ? this.containers.get(containerId) : null;
            if (!container) return;
            const size = this.getItemSize(item);
            const metrics = this.cellSize(targetGrid, container);
            const rect = targetGrid.getBoundingClientRect();
            const relativeX = event.clientX - rect.left - metrics.paddingX;
            const relativeY = event.clientY - rect.top - metrics.paddingY;
            const x = Math.floor(relativeX / (metrics.width + metrics.gapX)) + 1;
            const y = Math.floor(relativeY / (metrics.height + metrics.gapY)) + 1;
            const isValid = this.isPositionValid(item, containerId, { x, y });
            ghost.classList.toggle('is-invalid', !isValid);
            ghost.style.left = `${metrics.paddingX + (x - 1) * (metrics.width + metrics.gapX)}px`;
            ghost.style.top = `${metrics.paddingY + (y - 1) * (metrics.height + metrics.gapY)}px`;
            ghost.style.width = `${size.w * metrics.width + metrics.gapX * (size.w - 1) - 4}px`;
            ghost.style.height = `${size.h * metrics.height + metrics.gapY * (size.h - 1) - 4}px`;
        }

        cleanupDrag(itemId) {
            const element = this.root.querySelector(`[data-item-id="${itemId}"]`);
            element?.classList.remove('is-dragging');
            if (this.dragState?.ghost) {
                this.dragState.ghost.remove();
            }
            if (this.dragState?.preview) {
                this.dragState.preview.remove();
            }
            this.dragState = null;
            window.removeEventListener('pointermove', this.onDragMove);
            window.removeEventListener('pointerup', this.onDragEnd);
        }

        isContainerAllowed(item, containerId) {
            if (!containerId) return false;
            if (containerId === 'inv_main') return true;
            if (containerId === 'hands') return true;
            if (containerId.startsWith('bag:')) return true;
            const allowed = containerTypeMap[containerId];
            if (!allowed) return false;
            return allowed.includes(item.type);
        }

        getDropPosition(grid, containerId, item, event) {
            const container = this.containers.get(containerId);
            if (!container) return null;
            const metrics = this.cellSize(grid, container);
            const rect = grid.getBoundingClientRect();
            const relativeX = event.clientX - rect.left - metrics.paddingX;
            const relativeY = event.clientY - rect.top - metrics.paddingY;
            const x = Math.floor(relativeX / (metrics.width + metrics.gapX)) + 1;
            const y = Math.floor(relativeY / (metrics.height + metrics.gapY)) + 1;
            if (!this.isPositionValid(item, containerId, { x, y })) {
                return null;
            }
            return { x, y };
        }

        isPositionValid(item, containerId, position) {
            if (!this.isContainerAllowed(item, containerId)) return false;
            const container = this.containers.get(containerId);
            if (!container) return false;
            const size = this.getItemSize(item);
            if (position.x < 1 || position.y < 1) return false;
            if (position.x + size.w - 1 > container.w || position.y + size.h - 1 > container.h) {
                return false;
            }
            const overlaps = this.items.some((other) => {
                if (other.id === item.id || other.container_id !== containerId) return false;
                const otherSize = this.getItemSize(other);
                const overlapX = position.x < other.pos_x + otherSize.w && position.x + size.w > other.pos_x;
                const overlapY = position.y < other.pos_y + otherSize.h && position.y + size.h > other.pos_y;
                return overlapX && overlapY;
            });
            return !overlaps;
        }

        updateDragPreviewPosition(event) {
            if (!this.dragState?.preview) return;
            const { preview, previewOffset } = this.dragState;
            preview.style.left = `${event.clientX - previewOffset.x}px`;
            preview.style.top = `${event.clientY - previewOffset.y}px`;
        }

        updateDragPreviewSize() {
            if (!this.dragState?.preview) return;
            const { item, originGrid, originContainer, preview } = this.dragState;
            const container = this.containers.get(originContainer);
            if (!container) return;
            const size = this.getItemSize(item);
            const metrics = this.cellSize(originGrid, container);
            preview.style.width = `${size.w * metrics.width + metrics.gapX * (size.w - 1) - 4}px`;
            preview.style.height = `${size.h * metrics.height + metrics.gapY * (size.h - 1) - 4}px`;
        }

        logConflict(action, item, payload = {}) {
            if (!DEBUG_INVENTORY) return;
            console.debug('[Inventory] Conflict detected', {
                action,
                instance_id: item?.instance_id ?? item?.id ?? null,
                local_version: item?.version ?? null,
                server_version: payload?.version ?? payload?.server_version ?? null,
            });
        }

        async handleConflict(action, item, payload = {}) {
            this.logConflict(action, item, payload);
            await this.refreshInventory(this.selectedPlayerId);
        }

        async submitMove(item, containerId, position) {
            if (!this.permissions.can_edit) return;
            if (!containerId || !this.isContainerAllowed(item, containerId)) {
                this.renderItems();
                return;
            }
            const response = await fetch('/api/inventory/move', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    item_id: item.id,
                    container_id: containerId,
                    pos_x: position?.x || null,
                    pos_y: position?.y || null,
                    rotated: item.rotated,
                    version: item.version,
                }),
            });
            if (response.ok) {
                await this.refreshInventory(this.selectedPlayerId);
                return;
            }
            const payload = await response.json().catch(() => ({}));
            if (response.status === 409) {
                await this.handleConflict('move', item, payload);
                return;
            }
            alert(payload.error || 'Не вдалося перемістити предмет.');
        }

        toggleRotation(item) {
            if (!item.rotatable || !this.permissions.can_edit) return;
            if (!this.canRotateItem(item)) return;
            item.rotated = item.rotated === 1 ? 0 : 1;
            this.renderItems();
            if (this.dragState?.lastPointer) {
                this.updateGhost({
                    clientX: this.dragState.lastPointer.x,
                    clientY: this.dragState.lastPointer.y,
                });
                this.updateDragPreviewPosition({
                    clientX: this.dragState.lastPointer.x,
                    clientY: this.dragState.lastPointer.y,
                });
                this.updateDragPreviewSize();
            }
        }

        canRotateItem(item) {
            return Boolean(item.container_id);
        }

        openContextMenu(event, item) {
            if (!this.contextMenu) return;
            event.preventDefault();
            this.contextMenu.dataset.itemId = item.id;
            this.contextMenu.dataset.itemVersion = item.version;
            this.contextMenu.dataset.itemType = item.type;
            document.getElementById('context-name').textContent = item.name;
            document.getElementById('context-type').textContent = item.type;
            document.getElementById('context-quality').textContent = item.quality;
            const size = this.getItemSize(item);
            document.getElementById('context-size').textContent = `Розмір: ${size.w}×${size.h}`;
            document.getElementById('context-weight').textContent = `Вага: ${(item.weight * item.amount).toFixed(2)} кг`;
            document.getElementById('context-description').textContent = item.description || '';
            const notes = document.getElementById('context-notes');
            if (notes) {
                notes.textContent = item.custom_description || '';
                notes.style.display = item.custom_description ? 'block' : 'none';
            }
            const templateMeta = document.getElementById('context-template');
            if (templateMeta) {
                templateMeta.textContent = `Template ID: ${item.template_id}`;
                templateMeta.style.display = this.permissions.is_master ? 'block' : 'none';
            }
            const masterOnly = this.contextMenu.querySelector('[data-master-only]');
            if (masterOnly) {
                masterOnly.style.display = this.permissions.is_master ? 'block' : 'none';
            }
            this.contextMenu.style.left = `${event.clientX + 12}px`;
            this.contextMenu.style.top = `${event.clientY + 12}px`;
            this.contextMenu.classList.add('is-open');
        }

        closeContextMenu() {
            if (!this.contextMenu) return;
            this.contextMenu.classList.remove('is-open');
            this.contextMenu.dataset.itemId = '';
        }

        async handleContextAction(action) {
            const itemId = this.contextMenu?.dataset.itemId;
            const version = Number.parseInt(this.contextMenu?.dataset.itemVersion || '0', 10);
            const item = this.items.find((entry) => String(entry.id) === String(itemId));
            if (!item) {
                this.closeContextMenu();
                return;
            }
            switch (action) {
                case 'use':
                    alert('Використання предметів поки що не реалізовано.');
                    break;
                case 'equip':
                    await this.equipItem(item);
                    break;
                case 'rotate':
                    await this.rotateItem(item, version);
                    break;
                case 'split':
                    await this.splitItem(item, version);
                    break;
                case 'drop':
                    await this.dropItem(item, version);
                    break;
                case 'transfer':
                    this.openTransferModal(item);
                    break;
                case 'issue-by-id':
                    await this.issueById();
                    break;
                default:
                    break;
            }
            this.closeContextMenu();
        }

        async equipItem(item) {
            const targetContainer = equipTargetMap[item.type];
            if (!targetContainer) {
                alert('Цей предмет не має відповідного слотy.');
                return;
            }
            await this.submitMove(item, targetContainer, null);
        }

        async rotateItem(item, version) {
            const response = await fetch('/api/inventory/rotate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_id: item.id, version }),
            });
            if (response.ok) {
                await this.refreshInventory(this.selectedPlayerId);
                return;
            }
            const payload = await response.json().catch(() => ({}));
            if (response.status === 409) {
                await this.handleConflict('rotate', item, payload);
                return;
            }
            alert(payload.error || 'Не вдалося повернути предмет.');
        }

        async splitItem(item, version) {
            if (!item.stackable || item.amount <= 1) {
                alert('Цей предмет не можна розділити.');
                return;
            }
            const amount = Number.parseInt(prompt(`Скільки відділити? (1-${item.amount - 1})`, '1'), 10);
            if (!amount || Number.isNaN(amount)) return;
            const response = await fetch('/api/inventory/split', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_id: item.id, amount, version }),
            });
            if (response.ok) {
                await this.refreshInventory(this.selectedPlayerId);
                return;
            }
            const payload = await response.json().catch(() => ({}));
            if (response.status === 409) {
                await this.handleConflict('split', item, payload);
                return;
            }
            alert(payload.error || 'Не вдалося розділити.');
        }

        async dropItem(item, version) {
            if (!confirm('Скинути цей предмет?')) return;
            const response = await fetch('/api/inventory/drop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_id: item.id, version }),
            });
            if (response.ok) {
                await this.refreshInventory(this.selectedPlayerId);
                return;
            }
            const payload = await response.json().catch(() => ({}));
            if (response.status === 409) {
                await this.handleConflict('drop', item, payload);
                return;
            }
            alert(payload.error || 'Не вдалося скинути предмет.');
        }

        openTransferModal(item) {
            if (!this.transferModal || !this.transferPlayers) return;
            this.transferModal.classList.add('is-open');
            this.transferPlayers.innerHTML = '';
            const playerList = this.lobbyId ? lobbyPlayers[this.lobbyId] || [] : [];
            if (!playerList.length) {
                this.transferPlayers.innerHTML = '<p class="muted">Немає доступних гравців.</p>';
                return;
            }
            playerList.forEach((player) => {
                if (String(player.id) === String(item.owner_id)) return;
                const row = document.createElement('div');
                row.className = 'transfer-player';
                row.innerHTML = `<span>${player.name}</span><button class="button ghost" type="button" data-player-id="${player.id}">Передати</button>`;
                row.querySelector('button')?.addEventListener('click', async () => {
                    await this.transferItem(item, player.id);
                });
                this.transferPlayers.appendChild(row);
            });
        }

        closeTransferModal() {
            if (!this.transferModal) return;
            this.transferModal.classList.remove('is-open');
        }

        async transferItem(item, recipientId) {
            let amount = item.amount;
            if (item.stackable && item.amount > 1) {
                const input = prompt(`Скільки передати? (1-${item.amount})`, `${item.amount}`);
                if (!input) return;
                amount = Number.parseInt(input, 10);
                if (Number.isNaN(amount) || amount < 1 || amount > item.amount) {
                    alert('Некоректна кількість.');
                    return;
                }
            }
            const response = await fetch('/api/inventory/transfer', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    item_id: item.id,
                    recipient_id: recipientId,
                    amount,
                    version: item.version,
                }),
            });
            if (response.ok) {
                this.closeTransferModal();
                await this.refreshInventory(this.selectedPlayerId);
                return;
            }
            const payload = await response.json().catch(() => ({}));
            if (response.status === 409) {
                await this.handleConflict('transfer', item, payload);
                return;
            }
            alert(payload.error || 'Не вдалося передати предмет.');
        }

        async issueById() {
            if (!this.permissions.is_master) return;
            const templateId = prompt('Вкажіть ID шаблону предмета:');
            if (!templateId) return;
            const amount = Number.parseInt(prompt('Кількість:', '1'), 10);
            const playerList = this.lobbyId ? lobbyPlayers[this.lobbyId] || [] : [];
            const targetId = playerList.length ? playerList[0].id : null;
            const recipientId = prompt('ID отримувача (за замовчуванням перший в списку):', `${targetId || ''}`);
            const target = Number.parseInt(recipientId || `${targetId || ''}`, 10);
            if (!target) {
                alert('Некоректний отримувач.');
                return;
            }
            const response = await fetch('/api/master/issue_by_id', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lobby_id: this.lobbyId,
                    template_id: Number.parseInt(templateId, 10),
                    target_user_id: target,
                    amount: Number.isNaN(amount) ? 1 : amount,
                }),
            });
            if (response.ok) {
                await this.refreshInventory(this.selectedPlayerId);
                return;
            }
            const payload = await response.json().catch(() => ({}));
            alert(payload.error || 'Не вдалося видати предмет.');
        }
    }

    inventoryRoots.forEach((root) => {
        const controller = new LobbyInventory(root);
        root.querySelectorAll('[data-master-create]').forEach((form) => {
            const lobbyId = root.dataset.lobbyId;
            const issueButton = form.querySelector('button');
            issueButton?.addEventListener('click', async () => {
                const name = form.querySelector('input[id^="item_name_"]')?.value?.trim();
                const description = form.querySelector('textarea[id^="item_description_"]')?.value?.trim();
                const type = form.querySelector('select[id^="item_type_"]')?.value;
                const quality = form.querySelector('select[id^="item_quality_"]')?.value;
                const width = Number.parseInt(form.querySelector('input[id^="item_w_"]')?.value || '1', 10);
                const height = Number.parseInt(form.querySelector('input[id^="item_h_"]')?.value || '1', 10);
                const weight = parseFloat(form.querySelector('input[id^="item_weight_"]')?.value || '0');
                const maxDurability = Number.parseInt(form.querySelector('input[id^="item_durability_"]')?.value || '1', 10);
                const maxAmount = Number.parseInt(form.querySelector('input[id^="item_max_amount_"]')?.value || '1', 10);
                const target = form.querySelector('select[id^="item_target_"]')?.value;
                const imageInput = form.querySelector('input[type="file"]');

                if (!name) {
                    alert('Вкажіть назву предмета.');
                    return;
                }

                const payload = new FormData();
                payload.append('lobby_id', lobbyId);
                payload.append('name', name);
                payload.append('description', description || '');
                payload.append('type', type || 'other');
                payload.append('quality', quality || 'common');
                payload.append('width', width);
                payload.append('height', height);
                payload.append('weight', weight);
                payload.append('max_durability', maxDurability);
                payload.append('max_amount', maxAmount);
                payload.append('issue_to', target || '');
                if (imageInput?.files?.length) {
                    payload.append('image', imageInput.files[0]);
                }

                const response = await fetch('/api/master/item_template/create', {
                    method: 'POST',
                    body: payload,
                });
                if (response.ok) {
                    await controller.refreshInventory(controller.selectedPlayerId);
                    form.reset();
                    return;
                }
                const data = await response.json().catch(() => ({}));
                alert(data.error || 'Не вдалося створити предмет.');
            });
        });

        root.querySelectorAll('[data-master-issue]').forEach((form) => {
            const lobbyId = root.dataset.lobbyId;
            const button = form.querySelector('button');
            button?.addEventListener('click', async () => {
                const templateId = Number.parseInt(
                    form.querySelector('input[id^="issue_template_"]')?.value || '0',
                    10,
                );
                const targetId = Number.parseInt(
                    form.querySelector('select[id^="issue_target_"]')?.value || '0',
                    10,
                );
                const amount = Number.parseInt(
                    form.querySelector('input[id^="issue_amount_"]')?.value || '1',
                    10,
                );
                if (!templateId || !targetId) {
                    alert('Заповніть ID шаблону та отримувача.');
                    return;
                }
                const response = await fetch('/api/master/issue_by_id', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        lobby_id: lobbyId,
                        template_id: templateId,
                        target_user_id: targetId,
                        amount,
                    }),
                });
                if (response.ok) {
                    await controller.refreshInventory(controller.selectedPlayerId);
                    return;
                }
                const data = await response.json().catch(() => ({}));
                alert(data.error || 'Не вдалося видати предмет.');
            });
        });
    });
})();
