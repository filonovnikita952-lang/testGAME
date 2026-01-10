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
        equip_back: ['backpack'],
        equip_amulet: ['amulet'],
        equip_belt: ['belt'],
        equip_shield: ['shield'],
        slot_weapon_main: ['weapon'],
    };

    const equipTargetMap = {
        weapon: 'hands',
        shield: 'equip_shield',
        backpack: 'equip_back',
        head: 'equip_head',
        shirt: 'equip_shirt',
        pants: 'equip_pants',
        armor: 'equip_armor',
        boots: 'equip_boots',
        amulet: 'equip_amulet',
        belt: 'equip_belt',
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
            this.transferAmount = document.getElementById('transfer-amount');
            this.transferItemName = document.getElementById('transfer-item-name');
            this.transferItemData = null;
            this.inventoryActions = this.root.querySelector('[data-inventory-actions]');
            this.weightDisplay = this.root.querySelector('[data-weight-display]');
            this.playerName = this.root.querySelector('[data-player-name]');
            this.playerRole = this.root.querySelector('[data-player-role]');
            this.detailImage = this.root.querySelector('[data-item-detail-image]');
            this.detailName = this.root.querySelector('[data-item-detail-name]');
            this.detailDescription = this.root.querySelector('[data-item-detail-description]');
            this.detailActions = this.root.querySelector('[data-item-detail-actions]');
            this.detailSplitField = this.root.querySelector('[data-detail-split]');
            this.detailSplitAmount = this.root.querySelector('[data-detail-split-amount]');
            this.detailDurabilityField = this.root.querySelector('[data-detail-durability]');
            this.detailDurabilityInput = this.root.querySelector('[data-detail-durability-input]');
            this.detailItemId = null;
            this.stats = null;
            this.attributes = null;
            this.statsValues = {
                hp: this.root.querySelector('[data-stat-value="hp"]'),
                mana: this.root.querySelector('[data-stat-value="mana"]'),
                hungry: this.root.querySelector('[data-stat-value="hungry"]'),
                ac: this.root.querySelector('[data-stat-value="ac"]'),
            };
            this.statsFills = {
                hp: this.root.querySelector('[data-stat-fill="hp"]'),
                mana: this.root.querySelector('[data-stat-fill="mana"]'),
                hungry: this.root.querySelector('[data-stat-fill="hungry"]'),
            };
            this.statsInputs = Array.from(this.root.querySelectorAll('[data-stat-input]'));
            this.bagGridList = this.root.querySelector('[data-bag-grid-list]');
            this.fastSlotList = this.root.querySelector('[data-fast-slot-list]');
            this.fastSlotPanel = this.root.querySelector('[data-fast-slot-panel]');
            this.masterToggle = this.root.querySelector('[data-master-toggle]');
            this.masterMode = 'view';
            this.gridElements = Array.from(this.root.querySelectorAll('.tetris-grid'));
            this.characterClassText = this.root.querySelector('[data-character-class-text]');
            this.characterClassSelect = this.root.querySelector('[data-character-class-select]');
            this.attributeRows = Array.from(this.root.querySelectorAll('[data-attribute-row]'));
            this.attributeFormulaInput = this.root.querySelector('[data-attribute-formula-input]');
            this.attributeFormulaSave = this.root.querySelector('[data-attribute-formula-save]');
            this.attributeFormulaWrap = this.root.querySelector('[data-attribute-formula]');
            this.attributesTabInput = this.root.querySelector('input[id^="lobby-tab-attributes"]');
            this.rosterList = this.lobbyId
                ? document.querySelector(`.lobby-roster__list[data-lobby-id="${this.lobbyId}"]`)
                : null;
            this.mapOverlay = document.getElementById('map-overlay');
            this.mapImage = this.mapOverlay?.querySelector('[data-map-image]');
            this.mapClose = this.mapOverlay?.querySelector('[data-map-close]');
            this.lastPointer = null;
            this.debugActionTimestamps = new Map();

            this.bindEvents();
            this.loadInitialState();
        }

        trackAction(actionKey) {
            const now = Date.now();
            const last = this.debugActionTimestamps.get(actionKey);
            if (last && now - last < 400) {
                console.debug('[Inventory] Duplicate action detected', actionKey);
            }
            this.debugActionTimestamps.set(actionKey, now);
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
                    this.rotateActiveItem();
                });
            }

            document.addEventListener('keydown', (event) => {
                if (event.target?.closest('input, textarea, select')) return;
                if (event.key === 'Escape' && this.dragState?.item) {
                    this.cancelDrag();
                    return;
                }
                if (event.key === 'Escape' && this.mapOverlay?.classList.contains('is-open')) {
                    this.closeMapOverlay();
                    return;
                }
                if (event.key.toLowerCase() === 'r') {
                    this.rotateActiveItem();
                    return;
                }
                if (event.key.toLowerCase() === 'h') {
                    this.splitActiveItemHalf();
                }
            });

            document.addEventListener('pointermove', (event) => {
                this.lastPointer = { x: event.clientX, y: event.clientY };
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

            if (this.detailActions) {
                this.detailActions.querySelectorAll('[data-detail-action]').forEach((button) => {
                    button.addEventListener('click', () => {
                        this.handleDetailAction(button.dataset.detailAction);
                    });
                });
            }

            if (this.masterToggle) {
                this.masterToggle.querySelectorAll('[data-master-mode]').forEach((button) => {
                    button.addEventListener('click', () => {
                        const mode = button.dataset.masterMode || 'view';
                        this.setMasterMode(mode);
                    });
                });
            }

            this.statsInputs.forEach((input) => {
                input.addEventListener('input', () => {
                    if (!this.canEditStats()) return;
                    this.updateStatsPreviewFromInputs();
                });
                input.addEventListener('change', () => {
                    if (!this.canEditStats()) return;
                    this.submitStatsUpdate();
                });
            });

            if (this.characterClassSelect) {
                this.characterClassSelect.addEventListener('change', () => {
                    if (!this.canEditAttributes()) return;
                    this.updateCharacterClass();
                });
            }

            if (this.attributeFormulaSave) {
                this.attributeFormulaSave.addEventListener('click', () => {
                    if (!this.canEditAttributes()) return;
                    this.updateAttributeFormula();
                });
            }

            if (this.attributesTabInput) {
                this.attributesTabInput.addEventListener('change', () => {
                    if (!this.attributesTabInput.checked) return;
                    this.refreshInventory(this.selectedPlayerId);
                });
            }

            this.attributeRows.forEach((row) => {
                const input = row.querySelector('[data-attribute-input]');
                const toggle = row.querySelector('[data-attribute-prof-toggle]');
                input?.addEventListener('change', () => {
                    if (!this.canEditAttributes()) return;
                    this.submitAttributeUpdate();
                });
                toggle?.addEventListener('click', () => {
                    if (!this.canEditAttributes()) return;
                    const statKey = row.dataset.attributeKey;
                    if (!statKey) return;
                    this.toggleAttributeProficiency(statKey);
                });
            });

            this.mapClose?.addEventListener('click', () => this.closeMapOverlay());
            this.mapOverlay?.addEventListener('click', (event) => {
                if (event.target === this.mapOverlay) this.closeMapOverlay();
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
                if (DEBUG_INVENTORY) {
                    console.debug(error.message || 'Не вдалося завантажити інвентар.');
                }
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
            this.stats = payload.stats || null;
            this.attributes = payload.attributes || null;
            this.updateStatsUI();
            this.updateClassUI(payload.user);
            this.updateAttributesUI();
            this.updateWeightDisplay(payload.weight);
            this.root.classList.toggle('is-readonly', !this.permissions.can_edit);
            if (this.inventoryActions) {
                this.inventoryActions.classList.toggle('is-disabled', !this.permissions.can_edit);
            }
            this.refreshMasterModeState();
            this.rebuildBagGrids();
            this.rebuildFastSlots();
            if (this.detailItemId) {
                const detailItem = this.items.find((entry) => String(entry.id) === String(this.detailItemId));
                this.updateDetailsPanel(detailItem || null);
            } else {
                this.updateDetailsPanel(null);
            }
            this.render();
        }

        rebuildBagGrids() {
            if (!this.bagGridList) return;
            this.bagGridList.innerHTML = '';
            const bagContainers = Array.from(this.containers.values()).filter((container) => container.is_bag);
            if (!bagContainers.length) {
                const empty = document.createElement('p');
                empty.className = 'muted';
                empty.textContent = 'Немає додаткових сумок.';
                this.bagGridList.appendChild(empty);
            } else {
                bagContainers.forEach((container) => {
                    const panel = document.createElement('div');
                    panel.className = 'bag-grid-panel';
                    if (container.bag_broken) {
                        panel.classList.add('is-broken');
                    }
                    panel.innerHTML = `
                        <div class="panel-header">
                            <span class="panel-title">${container.label || 'Bag'}</span>
                            ${container.bag_broken ? '<span class="panel-tag danger">Broken</span>' : ''}
                        </div>
                        <div class="tetris-grid tetris-grid--backpack" data-container-id="${container.id}"></div>
                    `;
                    this.bagGridList.appendChild(panel);
                });
            }
            this.gridElements = Array.from(this.root.querySelectorAll('.tetris-grid'));
        }

        rebuildFastSlots() {
            if (!this.fastSlotList) return;
            this.fastSlotList.innerHTML = '';
            const fastContainers = Array.from(this.containers.values()).filter((container) => container.is_fast);
            if (this.fastSlotPanel) {
                this.fastSlotPanel.classList.toggle('is-hidden', !fastContainers.length);
            }
            if (!fastContainers.length) {
                this.gridElements = Array.from(this.root.querySelectorAll('.tetris-grid'));
                return;
            }
            fastContainers.forEach((container) => {
                const panel = document.createElement('div');
                panel.className = 'fast-slot-panel';
                panel.innerHTML = `
                    <div class="panel-header">
                        <span class="panel-title">${container.label || 'Fast Slot'}</span>
                    </div>
                    <div class="tetris-grid tetris-grid--compact" data-container-id="${container.id}"></div>
                `;
                this.fastSlotList.appendChild(panel);
            });
            this.gridElements = Array.from(this.root.querySelectorAll('.tetris-grid'));
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
                if (item.is_cloth && item.has_durability && item.str_current <= 0) {
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
                element.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.detailItemId = item.id;
                    this.updateDetailsPanel(item);
                });
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
            if (this.dragState) {
                this.cancelDrag();
            }
            this.detailItemId = item.id;
            this.updateDetailsPanel(item);
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
            const dropTargetItem = document.elementFromPoint(event.clientX, event.clientY)?.closest('.inventory-item');
            if (dropTargetItem) {
                const targetItemId = dropTargetItem.dataset.itemId;
                const targetItem = this.items.find((entry) => String(entry.id) === String(targetItemId));
                if (targetItem && targetItem.id !== item.id) {
                    const merged = await this.submitMerge(item, targetItem);
                    this.cleanupDrag(item.id);
                    if (!merged) {
                        this.renderItems();
                    }
                    return;
                }
            }
            const targetGrid = document.elementFromPoint(event.clientX, event.clientY)?.closest('.tetris-grid');
            const targetContainer = targetGrid?.dataset.containerId || null;
            const allowed = targetContainer ? this.isContainerAllowed(item, targetContainer) : false;
            let targetPosition = null;
            if (targetGrid && allowed) {
                targetPosition = this.getDropPosition(targetGrid, targetContainer, item, event);
            }
            try {
                if (targetGrid && allowed && targetPosition) {
                    const moved = await this.submitMove(item, targetContainer, targetPosition);
                    if (!moved) {
                        this.renderItems();
                    }
                } else {
                    this.renderItems();
                }
            } finally {
                this.cleanupDrag(item.id);
            }
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

        cancelDrag() {
            if (!this.dragState) return;
            const itemId = this.dragState.item?.id;
            this.renderItems();
            if (itemId) {
                this.cleanupDrag(itemId);
            } else {
                this.cleanupDrag('0');
            }
        }

        isContainerAllowed(item, containerId) {
            if (!containerId) return false;
            if (containerId === 'inv_main') return true;
            if (containerId === 'hands') return true;
            if (containerId.startsWith('bag:')) return this.containers.has(containerId);
            if (containerId.startsWith('fast:')) return this.containers.has(containerId);
            const allowed = containerTypeMap[containerId];
            if (!allowed) return false;
            return allowed.includes(item.type);
        }

        canSplitItem(item) {
            if (!item || !item.stackable || item.amount <= 1) return false;
            if (item.container_id === 'inv_main' || item.container_id === 'hands') return true;
            return Boolean(item.container_id && item.container_id.startsWith('bag:'));
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
            console.warn('[Inventory] Conflict detected', {
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

        getItemById(itemId) {
            return this.items.find((entry) => String(entry.id) === String(itemId));
        }

        getActiveItem() {
            if (this.dragState?.item) return this.dragState.item;
            if (this.detailItemId) return this.getItemById(this.detailItemId);
            return null;
        }

        rotateActiveItem() {
            const item = this.getActiveItem();
            if (!item) return;
            this.rotateItem(item);
        }

        splitActiveItemHalf() {
            const item = this.getActiveItem();
            if (!item) return;
            this.splitItem(item, { splitHalf: true, attachDrag: true });
        }

        handleDetailAction(action) {
            const item = this.getItemById(this.detailItemId);
            if (!item) return;
            switch (action) {
                case 'rotate':
                    this.rotateItem(item);
                    break;
                case 'use':
                    this.useItem(item);
                    break;
                case 'split':
                    {
                        const amount = Number.parseInt(this.detailSplitAmount?.value || '1', 10);
                        if (Number.isNaN(amount)) return;
                        this.splitItem(item, { amount, attachDrag: true });
                    }
                    break;
                case 'set-durability':
                    this.updateDurability(item);
                    break;
                default:
                    break;
            }
        }

        applyInstanceUpdates(instances = [], deletedIds = []) {
            const normalizedDeleted = deletedIds.map((id) => String(id));
            let nextItems = this.items.filter((entry) => !normalizedDeleted.includes(String(entry.id)));
            instances.forEach((instance) => {
                const index = nextItems.findIndex((entry) => String(entry.id) === String(instance.id));
                if (index >= 0) {
                    nextItems[index] = instance;
                } else {
                    nextItems.push(instance);
                }
            });
            this.items = nextItems;
            if (this.dragState?.item) {
                const updated = this.getItemById(this.dragState.item.id);
                if (updated) {
                    this.dragState.item = updated;
                }
            }
            if (this.detailItemId) {
                const detailItem = this.getItemById(this.detailItemId);
                if (!detailItem) {
                    this.detailItemId = null;
                }
                this.updateDetailsPanel(detailItem || null);
            }
            this.renderItems();
        }

        getItemCenterPosition(item) {
            const grid = this.gridElements.find((el) => el.dataset.containerId === item.container_id);
            const container = this.containers.get(item.container_id);
            if (!grid || !container) return null;
            const rect = grid.getBoundingClientRect();
            const metrics = this.cellSize(grid, container);
            const size = this.getItemSize(item);
            const left = rect.left + metrics.paddingX + (item.pos_x - 1) * (metrics.width + metrics.gapX);
            const top = rect.top + metrics.paddingY + (item.pos_y - 1) * (metrics.height + metrics.gapY);
            const width = size.w * metrics.width + metrics.gapX * (size.w - 1) - 4;
            const height = size.h * metrics.height + metrics.gapY * (size.h - 1) - 4;
            return { x: left + width / 2, y: top + height / 2 };
        }

        attachDragToItem(item) {
            const pointer = this.lastPointer || this.getItemCenterPosition(item);
            if (!pointer) return;
            const event = {
                clientX: pointer.x,
                clientY: pointer.y,
                preventDefault: () => {},
            };
            this.startDrag(event, item);
        }

        async submitMove(item, containerId, position) {
            if (!this.permissions.can_edit) return false;
            if (!containerId || !this.isContainerAllowed(item, containerId)) {
                this.renderItems();
                return false;
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
                return true;
            }
            const payload = await response.json().catch(() => ({}));
            if (response.status === 409) {
                await this.handleConflict('move', item, payload);
                return false;
            }
            console.debug('[Inventory] Move rejected', payload);
            await this.refreshInventory(this.selectedPlayerId);
            return false;
        }

        async submitMerge(sourceItem, targetItem) {
            if (!this.permissions.can_edit) return false;
            if (!sourceItem.stackable || !targetItem.stackable) return false;
            if (sourceItem.template_id !== targetItem.template_id) return false;
            if (sourceItem.id === targetItem.id) return false;
            const response = await fetch('/api/inventory/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source_instance_id: sourceItem.id,
                    target_instance_id: targetItem.id,
                    source_version: sourceItem.version,
                    target_version: targetItem.version,
                }),
            });
            if (response.ok) {
                await response.json().catch(() => ({}));
                await this.refreshInventory(this.selectedPlayerId);
                return true;
            }
            const payload = await response.json().catch(() => ({}));
            if (response.status === 409) {
                await this.handleConflict('merge', sourceItem, payload);
            }
            await this.refreshInventory(this.selectedPlayerId);
            return false;
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
            this.contextMenu.dataset.itemTemplateId = item.template_id;
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
            const useButton = this.contextMenu.querySelector('[data-action="use"]');
            if (useButton) {
                useButton.style.display = ['food', 'map', 'weapon'].includes(item.type) ? 'inline-flex' : 'none';
            }
            const splitButton = this.contextMenu.querySelector('[data-action="split"]');
            const canSplit = this.canSplitItem(item);
            if (splitButton) {
                splitButton.style.display = canSplit ? 'inline-flex' : 'none';
            }
            const equipButton = this.contextMenu.querySelector('[data-action="equip"]');
            if (equipButton) {
                equipButton.style.display = equipTargetMap[item.type] ? 'inline-flex' : 'none';
            }
            const splitField = this.contextMenu.querySelector('[data-split-field]');
            const splitInput = this.contextMenu.querySelector('[data-split-amount]');
            if (splitField && splitInput) {
                if (canSplit) {
                    splitField.style.display = 'flex';
                    splitInput.value = '1';
                    splitInput.max = `${item.amount - 1}`;
                } else {
                    splitField.style.display = 'none';
                }
            }
            const durabilityField = this.contextMenu.querySelector('[data-durability-field]');
            const durabilityInput = this.contextMenu.querySelector('[data-durability-input]');
            if (durabilityField && durabilityInput) {
                if (this.permissions.is_master && item.has_durability && !item.stackable) {
                    durabilityField.style.display = 'flex';
                    durabilityInput.min = '0';
                    durabilityInput.max = `${item.max_str || 0}`;
                    durabilityInput.value = `${item.str_current ?? 0}`;
                } else {
                    durabilityField.style.display = 'none';
                }
            }
            const templateMeta = document.getElementById('context-template');
            if (templateMeta) {
                templateMeta.textContent = `Template ID: ${item.template_id}`;
            }
            this.contextMenu.querySelectorAll('[data-master-only]').forEach((node) => {
                node.style.display = this.permissions.is_master ? '' : 'none';
            });
            this.contextMenu.style.left = `${event.clientX + 12}px`;
            this.contextMenu.style.top = `${event.clientY + 12}px`;
            this.contextMenu.classList.add('is-open');
            this.detailItemId = item.id;
            this.updateDetailsPanel(item);
        }

        closeContextMenu() {
            if (!this.contextMenu) return;
            this.contextMenu.classList.remove('is-open');
            this.contextMenu.dataset.itemId = '';
        }

        async handleContextAction(action) {
            const itemId = this.contextMenu?.dataset.itemId;
            const item = this.items.find((entry) => String(entry.id) === String(itemId));
            if (!item) {
                this.closeContextMenu();
                return;
            }
            switch (action) {
                case 'use':
                    await this.useItem(item);
                    break;
                case 'equip':
                    await this.equipItem(item);
                    break;
                case 'rotate':
                    await this.rotateItem(item);
                    break;
                case 'split':
                    await this.splitItem(item, { attachDrag: true });
                    break;
                case 'drop':
                    await this.dropItem(item);
                    break;
                case 'transfer':
                    this.openTransferModal(item);
                    break;
                case 'issue-by-id':
                    await this.issueByIdFromPanel(item);
                    break;
                case 'set-durability':
                    await this.updateDurability(item);
                    break;
                default:
                    break;
            }
            this.closeContextMenu();
        }

        async equipItem(item) {
            const targetContainer = equipTargetMap[item.type];
            if (!targetContainer) {
                return;
            }
            await this.submitMove(item, targetContainer, null);
        }

        async rotateItem(item) {
            if (!item.rotatable || !this.permissions.can_edit) return;
            const response = await fetch('/api/inventory/rotate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_id: item.id, version: item.version }),
            });
            if (response.ok) {
                await response.json().catch(() => ({}));
                await this.refreshInventory(this.selectedPlayerId);
                return;
            }
            const payload = await response.json().catch(() => ({}));
            if (response.status === 409) {
                await this.handleConflict('rotate', item, payload);
                return;
            }
            console.debug('[Inventory] Rotate rejected', payload);
            await this.refreshInventory(this.selectedPlayerId);
        }

        async splitItem(item, options = {}) {
            if (!this.permissions.can_edit) return;
            if (!this.canSplitItem(item)) return;
            this.trackAction(`split:${item.id}`);
            const amount = Number.isFinite(options.amount)
                ? options.amount
                : Number.parseInt(this.contextMenu?.querySelector('[data-split-amount]')?.value || '1', 10);
            if (!options.splitHalf) {
                if (!amount || Number.isNaN(amount)) return;
                if (amount < 1 || amount >= item.amount) return;
            }
            const response = await fetch('/api/inventory/split', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    item_id: item.id,
                    amount: options.splitHalf ? null : amount,
                    split_half: options.splitHalf ? true : null,
                    version: item.version,
                }),
            });
            if (response.ok) {
                const payload = await response.json().catch(() => ({}));
                await this.refreshInventory(this.selectedPlayerId);
                if (options.attachDrag && payload?.new_instance_id) {
                    const newItem = this.getItemById(payload.new_instance_id);
                    if (newItem) {
                        this.attachDragToItem(newItem);
                    }
                }
                return;
            }
            const payload = await response.json().catch(() => ({}));
            if (response.status === 409) {
                await this.handleConflict('split', item, payload);
                return;
            }
            console.warn('[Inventory] Split rejected', payload);
            await this.refreshInventory(this.selectedPlayerId);
        }

        async dropItem(item) {
            const response = await fetch('/api/inventory/drop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_id: item.id, version: item.version }),
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
            await this.refreshInventory(this.selectedPlayerId);
        }

        async useItem(item) {
            if (!this.permissions.can_edit) return;
            const response = await fetch('/api/inventory/use', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_id: item.id, version: item.version }),
            });
            if (response.ok) {
                const payload = await response.json().catch(() => ({}));
                if (payload?.map_image) {
                    this.openMapOverlay(payload.map_image);
                }
                await this.refreshInventory(this.selectedPlayerId);
                return;
            }
            const payload = await response.json().catch(() => ({}));
            if (response.status === 409) {
                await this.handleConflict('use', item, payload);
                return;
            }
            await this.refreshInventory(this.selectedPlayerId);
        }

        async updateDurability(item) {
            if (!this.permissions.is_master) return;
            const durabilityInput = this.detailDurabilityInput || this.contextMenu?.querySelector('[data-durability-input]');
            const value = Number.parseInt(durabilityInput?.value || '0', 10);
            if (Number.isNaN(value)) return;
            if (value < 0 || (item.max_str != null && value > item.max_str)) return;
            const response = await fetch('/api/master/item_instance/set_durability', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ item_id: item.id, value, version: item.version }),
            });
            if (response.ok) {
                await response.json().catch(() => ({}));
                await this.refreshInventory(this.selectedPlayerId);
                return;
            }
            const payload = await response.json().catch(() => ({}));
            if (response.status === 409) {
                await this.handleConflict('durability', item, payload);
                return;
            }
            await this.refreshInventory(this.selectedPlayerId);
        }

        openTransferModal(item) {
            if (!this.transferModal || !this.transferPlayers) return;
            this.transferModal.classList.add('is-open');
            this.transferPlayers.innerHTML = '';
            this.transferItemData = item;
            if (this.transferItemName) {
                this.transferItemName.textContent = item.name || 'Предмет';
            }
            if (this.transferAmount) {
                this.transferAmount.value = `${item.amount || 1}`;
                this.transferAmount.max = `${item.amount || 1}`;
                this.transferAmount.min = '1';
                this.transferAmount.disabled = !(item.stackable && item.amount > 1);
            }
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
            this.transferItemData = null;
        }

        async transferItem(item, recipientId) {
            let amount = item.amount;
            if (item.stackable && item.amount > 1) {
                amount = Number.parseInt(this.transferAmount?.value || `${item.amount}`, 10);
                if (Number.isNaN(amount) || amount < 1 || amount > item.amount) {
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
                    lobby_id: this.lobbyId,
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
            await this.refreshInventory(this.selectedPlayerId);
        }

        async issueByIdFromPanel(item) {
            if (!this.permissions.is_master) return;
            const issueForm = this.root.querySelector('[data-master-issue]');
            if (!issueForm) return;
            const templateInput = issueForm.querySelector('input[id^="issue_template_"]');
            const targetInput = issueForm.querySelector('select[id^="issue_target_"]');
            const amountInput = issueForm.querySelector('input[id^="issue_amount_"]');
            const durabilityInput = issueForm.querySelector('input[id^="issue_durability_current_"]');
            const randomInput = issueForm.querySelector('input[id^="issue_random_durability_"]');
            if (templateInput && item?.template_id) {
                templateInput.value = `${item.template_id}`;
            }
            const templateId = Number.parseInt(templateInput?.value || '0', 10);
            const target = Number.parseInt(targetInput?.value || '0', 10);
            const amount = Number.parseInt(amountInput?.value || '1', 10);
            if (!templateId || !target) return;
            this.trackAction(`issue-by-id:${templateId}:${target}`);
            const response = await fetch('/api/master/issue_by_id', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lobby_id: this.lobbyId,
                    template_id: templateId,
                    target_user_id: target,
                    amount: Number.isNaN(amount) ? 1 : amount,
                    durability_current: durabilityInput?.value || null,
                    random_durability: randomInput?.value || '',
                }),
            });
            if (response.ok) {
                await this.refreshInventory(this.selectedPlayerId);
                return;
            }
            await response.json().catch(() => ({}));
            await this.refreshInventory(this.selectedPlayerId);
        }

        resolveImageUrl(path) {
            if (!path) return '';
            if (path.startsWith('http')) return path;
            if (path.startsWith('/')) return path;
            const normalized = path.startsWith('static/') ? path.slice(7) : path;
            return `/static/${normalized}`;
        }

        openMapOverlay(path) {
            if (!this.mapOverlay || !this.mapImage) return;
            const imageUrl = this.resolveImageUrl(path);
            if (!imageUrl) return;
            this.mapImage.src = imageUrl;
            this.mapOverlay.classList.add('is-open');
        }

        closeMapOverlay() {
            if (!this.mapOverlay || !this.mapImage) return;
            this.mapOverlay.classList.remove('is-open');
            this.mapImage.src = '';
        }

        updateDetailsPanel(item) {
            if (!this.detailImage || !this.detailName || !this.detailDescription) return;
            if (!item) {
                this.detailImage.src = '/static/images/default_avatar.png';
                this.detailImage.alt = 'Item';
                this.detailName.textContent = 'Оберіть предмет';
                this.detailDescription.textContent = '';
                if (this.detailActions) {
                    this.detailActions.classList.add('is-hidden');
                }
                return;
            }
            const imageUrl = this.resolveImageUrl(item.image_path);
            this.detailImage.src = imageUrl || '/static/images/default_avatar.png';
            this.detailImage.alt = item.name || 'Item';
            this.detailName.textContent = item.name || 'Item';
            this.detailDescription.textContent = item.description || '';
            if (this.detailActions) {
                this.detailActions.classList.toggle('is-hidden', !this.permissions.can_edit);
                this.detailActions.querySelector('[data-detail-action="use"]')?.classList.toggle(
                    'is-hidden',
                    !['food', 'map', 'weapon'].includes(item.type),
                );
                this.detailActions.querySelector('[data-detail-action="rotate"]')?.classList.toggle(
                    'is-hidden',
                    !item.rotatable,
                );
            }
            if (this.detailSplitField && this.detailSplitAmount) {
                const canSplit = this.permissions.can_edit && this.canSplitItem(item);
                this.detailSplitField.classList.toggle('is-hidden', !canSplit);
                if (canSplit) {
                    this.detailSplitAmount.value = '1';
                    this.detailSplitAmount.max = `${item.amount - 1}`;
                }
            }
            if (this.detailDurabilityField && this.detailDurabilityInput) {
                const canEdit = this.permissions.is_master && item.has_durability && !item.stackable;
                this.detailDurabilityField.classList.toggle('is-hidden', !canEdit);
                if (canEdit) {
                    this.detailDurabilityInput.min = '0';
                    this.detailDurabilityInput.max = `${item.max_str || 0}`;
                    this.detailDurabilityInput.value = `${item.str_current ?? 0}`;
                }
            }
        }

        setMasterMode(mode) {
            this.masterMode = mode === 'control' ? 'control' : 'view';
            this.refreshMasterModeState();
        }

        refreshMasterModeState() {
            const isMaster = this.permissions.is_master;
            this.root.classList.toggle('master-mode-control', isMaster && this.masterMode === 'control');
            this.root.classList.toggle('master-mode-view', !isMaster || this.masterMode !== 'control');
            if (this.masterToggle) {
                this.masterToggle.querySelectorAll('[data-master-mode]').forEach((button) => {
                    const isActive = button.dataset.masterMode === this.masterMode;
                    button.classList.toggle('is-active', isActive);
                });
            }
            this.statsInputs.forEach((input) => {
                input.disabled = !this.canEditStats();
            });
            if (this.characterClassSelect) {
                this.characterClassSelect.disabled = !this.canEditAttributes();
            }
            this.attributeRows.forEach((row) => {
                row.classList.toggle('is-readonly', !this.canEditAttributes());
                const input = row.querySelector('[data-attribute-input]');
                const toggle = row.querySelector('[data-attribute-prof-toggle]');
                if (input) input.disabled = !this.canEditAttributes();
                if (toggle) toggle.disabled = !this.canEditAttributes();
            });
            if (this.attributeFormulaInput) {
                this.attributeFormulaInput.disabled = !this.canEditAttributes();
            }
            if (this.attributeFormulaSave) {
                this.attributeFormulaSave.disabled = !this.canEditAttributes();
            }
        }

        canEditStats() {
            return this.permissions.is_master && this.masterMode === 'control';
        }

        canEditAttributes() {
            return this.permissions.is_master && this.masterMode === 'control';
        }

        updateStatsUI() {
            if (!this.stats) return;
            const hpCurrent = this.stats.hp_current ?? 0;
            const hpMax = this.stats.hp_max ?? 0;
            const manaCurrent = this.stats.mana_current ?? 0;
            const manaMax = this.stats.mana_max ?? 0;
            const hungry = this.stats.hungry ?? 0;
            const ac = this.stats.armor_class ?? 0;
            if (this.statsValues.hp) {
                this.statsValues.hp.textContent = `${hpCurrent}/${hpMax}`;
            }
            if (this.statsValues.mana) {
                this.statsValues.mana.textContent = `${manaCurrent}/${manaMax}`;
            }
            if (this.statsValues.hungry) {
                this.statsValues.hungry.textContent = `${hungry}/100`;
            }
            if (this.statsValues.ac) {
                this.statsValues.ac.textContent = `${ac}`;
            }
            if (this.statsFills.hp) {
                const pct = hpMax > 0 ? (hpCurrent / hpMax) * 100 : 0;
                this.statsFills.hp.style.width = `${Math.min(Math.max(pct, 0), 100)}%`;
            }
            if (this.statsFills.mana) {
                const pct = manaMax > 0 ? (manaCurrent / manaMax) * 100 : 0;
                this.statsFills.mana.style.width = `${Math.min(Math.max(pct, 0), 100)}%`;
            }
            if (this.statsFills.hungry) {
                const pct = (hungry / 100) * 100;
                this.statsFills.hungry.style.width = `${Math.min(Math.max(pct, 0), 100)}%`;
            }
            this.statsInputs.forEach((input) => {
                const key = input.dataset.statInput;
                switch (key) {
                    case 'hp_current':
                        input.max = `${hpMax}`;
                        input.value = `${hpCurrent}`;
                        break;
                    case 'mana_current':
                        input.max = `${manaMax}`;
                        input.value = `${manaCurrent}`;
                        break;
                    case 'hungry':
                        input.max = '100';
                        input.value = `${hungry}`;
                        break;
                    case 'armor_class':
                        input.value = `${ac}`;
                        break;
                    default:
                        break;
                }
            });
        }

        updateClassUI(userPayload) {
            if (!userPayload) return;
            const className = userPayload.character_class || '???';
            if (this.characterClassText) {
                this.characterClassText.textContent = className;
                this.characterClassText.classList.toggle('is-hidden', this.permissions.is_master);
            }
            if (this.characterClassSelect) {
                this.characterClassSelect.value = className;
                this.characterClassSelect.classList.toggle('is-hidden', !this.permissions.is_master);
            }
        }

        formatModifier(value) {
            const numeric = Number(value || 0);
            return numeric >= 0 ? `+${numeric}` : `${numeric}`;
        }

        updateAttributesUI() {
            if (!this.attributes) return;
            const stats = this.attributes.stats || {};
            const modifiers = this.attributes.modifiers || {};
            const proficient = this.attributes.proficient || {};
            this.attributeRows.forEach((row) => {
                const statKey = row.dataset.attributeKey;
                if (!statKey) return;
                const value = stats[statKey] ?? 0;
                const modifier = modifiers[statKey] ?? 0;
                const isProficient = Boolean(proficient[statKey]);
                const input = row.querySelector('[data-attribute-input]');
                const readonly = row.querySelector('[data-attribute-readonly]');
                const modifierNode = row.querySelector('[data-attribute-modifier]');
                const toggle = row.querySelector('[data-attribute-prof-toggle]');
                if (input) input.value = `${value}`;
                if (readonly) readonly.textContent = `${value}`;
                if (modifierNode) modifierNode.textContent = this.formatModifier(modifier);
                row.classList.toggle('is-proficient', isProficient);
                if (toggle) {
                    toggle.classList.toggle('is-active', isProficient);
                }
            });
            if (this.attributeFormulaInput && this.permissions.is_master) {
                this.attributeFormulaInput.value = this.attributes.formula || '';
            }
            if (this.attributeFormulaWrap) {
                this.attributeFormulaWrap.classList.toggle('is-hidden', !this.permissions.is_master);
            }
            this.refreshMasterModeState();
        }

        updateWeightDisplay(weight) {
            if (!this.weightDisplay || !weight) return;
            this.weightDisplay.textContent = `${weight.current} / ${weight.capacity}`;
        }

        async updateCharacterClass() {
            if (!this.characterClassSelect) return;
            const className = this.characterClassSelect.value;
            const response = await fetch('/api/master/set_class', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lobby_id: this.lobbyId,
                    user_id: this.selectedPlayerId,
                    class_name: className,
                }),
            });
            if (response.ok) {
                await this.refreshInventory(this.selectedPlayerId);
                return;
            }
            await response.json().catch(() => ({}));
            await this.refreshInventory(this.selectedPlayerId);
        }

        async submitAttributeUpdate() {
            const payload = {
                lobby_id: this.lobbyId,
                user_id: this.selectedPlayerId,
            };
            this.attributeRows.forEach((row) => {
                const statKey = row.dataset.attributeKey;
                const input = row.querySelector('[data-attribute-input]');
                if (!statKey || !input) return;
                const value = Number.parseInt(input.value || '0', 10);
                if (Number.isNaN(value)) return;
                payload[statKey] = value;
            });
            const response = await fetch('/api/master/attributes/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (response.ok) {
                const data = await response.json().catch(() => ({}));
                if (data?.attributes) {
                    this.attributes = data.attributes;
                    this.updateAttributesUI();
                } else {
                    await this.refreshInventory(this.selectedPlayerId);
                }
                return;
            }
            await response.json().catch(() => ({}));
            await this.refreshInventory(this.selectedPlayerId);
        }

        async updateAttributeFormula() {
            if (!this.attributeFormulaInput) return;
            const formula = this.attributeFormulaInput.value.trim();
            if (!formula) return;
            const response = await fetch('/api/master/attributes/formula', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lobby_id: this.lobbyId, formula }),
            });
            if (response.ok) {
                await this.refreshInventory(this.selectedPlayerId);
                return;
            }
            await response.json().catch(() => ({}));
            await this.refreshInventory(this.selectedPlayerId);
        }

        async toggleAttributeProficiency(statKey) {
            const current = this.attributes?.proficient?.[statKey];
            const response = await fetch('/api/master/attributes/proficiency', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lobby_id: this.lobbyId,
                    user_id: this.selectedPlayerId,
                    stat: statKey,
                    enabled: !current,
                }),
            });
            if (response.ok) {
                const data = await response.json().catch(() => ({}));
                if (data?.attributes) {
                    this.attributes = data.attributes;
                    this.updateAttributesUI();
                } else {
                    await this.refreshInventory(this.selectedPlayerId);
                }
                return;
            }
            await response.json().catch(() => ({}));
            await this.refreshInventory(this.selectedPlayerId);
        }

        updateStatsPreviewFromInputs() {
            const stats = {
                hp_current: this.stats?.hp_current ?? 0,
                hp_max: this.stats?.hp_max ?? 0,
                mana_current: this.stats?.mana_current ?? 0,
                mana_max: this.stats?.mana_max ?? 0,
                hungry: this.stats?.hungry ?? 0,
                armor_class: this.stats?.armor_class ?? 0,
            };
            this.statsInputs.forEach((input) => {
                const value = Number.parseInt(input.value || '0', 10);
                if (Number.isNaN(value)) return;
                if (input.dataset.statInput === 'hp_current') stats.hp_current = value;
                if (input.dataset.statInput === 'mana_current') stats.mana_current = value;
                if (input.dataset.statInput === 'hungry') stats.hungry = value;
                if (input.dataset.statInput === 'armor_class') stats.armor_class = value;
            });
            this.stats = { ...this.stats, ...stats };
            this.updateStatsUI();
        }

        async submitStatsUpdate() {
            if (!this.canEditStats()) return;
            const payload = {
                lobby_id: this.lobbyId,
                user_id: this.selectedPlayerId,
            };
            this.statsInputs.forEach((input) => {
                const key = input.dataset.statInput;
                const value = Number.parseInt(input.value || '0', 10);
                if (Number.isNaN(value)) return;
                payload[key] = value;
            });
            const response = await fetch('/api/master/character_stats/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (response.ok) {
                const data = await response.json().catch(() => ({}));
                if (data?.stats) {
                    this.stats = data.stats;
                    this.updateStatsUI();
                }
                return;
            }
            await response.json().catch(() => ({}));
            await this.refreshInventory(this.selectedPlayerId);
        }
    }

    inventoryRoots.forEach((root) => {
        const controller = new LobbyInventory(root);
        root.querySelectorAll('[data-master-create]').forEach((form) => {
            const lobbyId = root.dataset.lobbyId;
            const issueButton = form.querySelector('button:not([data-random-durability])');
            const randomButton = form.querySelector('[data-random-durability]');
            const durabilityInput = form.querySelector('input[id^="item_durability_current_"]');
            const randomInput = form.querySelector('input[id^="item_random_durability_"]');
            randomButton?.addEventListener('click', () => {
                if (randomInput) randomInput.value = '1';
                if (durabilityInput) durabilityInput.value = '';
            });
            durabilityInput?.addEventListener('input', () => {
                if (randomInput) randomInput.value = '0';
            });
            issueButton?.addEventListener('click', async () => {
                const name = form.querySelector('input[id^="item_name_"]')?.value?.trim();
                const description = form.querySelector('textarea[id^="item_description_"]')?.value?.trim();
                const type = form.querySelector('select[id^="item_type_"]')?.value;
                const quality = form.querySelector('select[id^="item_quality_"]')?.value;
                const width = Number.parseInt(form.querySelector('input[id^="item_w_"]')?.value || '1', 10);
                const height = Number.parseInt(form.querySelector('input[id^="item_h_"]')?.value || '1', 10);
                const weight = parseFloat(form.querySelector('input[id^="item_weight_"]')?.value || '0');
                const maxDurability = Number.parseInt(form.querySelector('input[id^="item_durability_"]')?.value || '1', 10);
                const durabilityCurrent = form.querySelector('input[id^="item_durability_current_"]')?.value || '';
                const randomDurability = form.querySelector('input[id^="item_random_durability_"]')?.value || '';
                const maxAmount = Number.parseInt(form.querySelector('input[id^="item_max_amount_"]')?.value || '1', 10);
                const issueAmount = Number.parseInt(form.querySelector('input[id^="item_issue_amount_"]')?.value || '1', 10);
                const isCloth = form.querySelector('input[id^="item_is_cloth_"]')?.checked;
                const bagWidth = Number.parseInt(form.querySelector('input[id^="item_bag_w_"]')?.value || '0', 10);
                const bagHeight = Number.parseInt(form.querySelector('input[id^="item_bag_h_"]')?.value || '0', 10);
                const fastWidth = Number.parseInt(form.querySelector('input[id^="item_fast_w_"]')?.value || '0', 10);
                const fastHeight = Number.parseInt(form.querySelector('input[id^="item_fast_h_"]')?.value || '0', 10);
                const target = form.querySelector('select[id^="item_target_"]')?.value;
                const imageInput = form.querySelector('input[type="file"]');

                if (!name) {
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
                payload.append('durability_current', durabilityCurrent);
                payload.append('random_durability', randomDurability);
                payload.append('max_amount', maxAmount);
                payload.append('issue_amount', issueAmount);
                payload.append('is_cloth', isCloth ? '1' : '0');
                payload.append('bag_width', Number.isNaN(bagWidth) ? 0 : bagWidth);
                payload.append('bag_height', Number.isNaN(bagHeight) ? 0 : bagHeight);
                payload.append('fast_w', Number.isNaN(fastWidth) ? 0 : fastWidth);
                payload.append('fast_h', Number.isNaN(fastHeight) ? 0 : fastHeight);
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
                await response.json().catch(() => ({}));
                await controller.refreshInventory(controller.selectedPlayerId);
            });
        });

        root.querySelectorAll('[data-master-issue]').forEach((form) => {
            const lobbyId = root.dataset.lobbyId;
            const button = form.querySelector('button:not([data-random-durability])');
            const randomButton = form.querySelector('[data-random-durability]');
            const durabilityInput = form.querySelector('input[id^="issue_durability_current_"]');
            const randomInput = form.querySelector('input[id^="issue_random_durability_"]');
            randomButton?.addEventListener('click', () => {
                if (randomInput) randomInput.value = '1';
                if (durabilityInput) durabilityInput.value = '';
            });
            durabilityInput?.addEventListener('input', () => {
                if (randomInput) randomInput.value = '0';
            });
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
                const durabilityCurrent = form.querySelector('input[id^="issue_durability_current_"]')?.value || '';
                const randomDurability = form.querySelector('input[id^="issue_random_durability_"]')?.value || '';
                if (!templateId || !targetId) {
                    return;
                }
                controller.trackAction(`issue-by-id:${templateId}:${targetId}`);
                const response = await fetch('/api/master/issue_by_id', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        lobby_id: lobbyId,
                        template_id: templateId,
                        target_user_id: targetId,
                        amount,
                        durability_current: durabilityCurrent,
                        random_durability: randomDurability,
                    }),
                });
                if (response.ok) {
                    await controller.refreshInventory(controller.selectedPlayerId);
                    return;
                }
                await response.json().catch(() => ({}));
                await controller.refreshInventory(controller.selectedPlayerId);
            });
        });

        root.querySelectorAll('[data-master-image-update]').forEach((form) => {
            const lobbyId = root.dataset.lobbyId;
            const button = form.querySelector('button');
            button?.addEventListener('click', async () => {
                const templateId = Number.parseInt(
                    form.querySelector('input[id^="image_template_"]')?.value || '0',
                    10,
                );
                const imageInput = form.querySelector('input[type="file"]');
                if (!templateId || !imageInput?.files?.length) return;
                const payload = new FormData();
                payload.append('lobby_id', lobbyId);
                payload.append('image', imageInput.files[0]);
                const response = await fetch(`/api/master/item_template/${templateId}/image`, {
                    method: 'POST',
                    body: payload,
                });
                if (response.ok) {
                    form.reset();
                    return;
                }
                await response.json().catch(() => ({}));
            });
        });
    });
})();
