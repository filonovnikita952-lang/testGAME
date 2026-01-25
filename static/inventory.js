(() => {
    const inventoryRoots = document.querySelectorAll('[data-inventory-root]');
    if (!inventoryRoots.length) return;

    const lobbyInventories = window.LOBBY_INVENTORIES || {};
    const lobbyPlayers = window.LOBBY_TRANSFER_PLAYERS || {};
    const fallbackInventory = window.INVENTORY_DATA || null;
    const DEBUG_INVENTORY = String(window.DEBUG_INVENTORY || '') === '1';
    const ADMIN_TAB_STORAGE_KEY = 'dra-admin-tab';

    const parseNumber = (value, fallback = 0) => {
        const parsed = Number.parseInt(value, 10);
        return Number.isNaN(parsed) ? fallback : parsed;
    };

    const randomInt = (maxValue) => {
        const max = Number.parseInt(maxValue, 10);
        if (Number.isNaN(max) || max < 0) return null;
        return Math.floor(Math.random() * (max + 1));
    };

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

    const formulaStatMap = {
        mana: 'mana_max',
        armor_class: 'armor_class',
        max_hp: 'hp_max',
        hp_head: 'hp_head',
        hp_torso: 'hp_torso',
        hp_left_arm: 'hp_left_arm',
        hp_right_arm: 'hp_right_arm',
        hp_left_leg: 'hp_left_leg',
        hp_right_leg: 'hp_right_leg',
        reason: 'reason',
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
            this.detailAmmo = this.root.querySelector('[data-item-detail-ammo]');
            this.detailActions = this.root.querySelector('[data-item-detail-actions]');
            this.detailSplitField = this.root.querySelector('[data-detail-split]');
            this.detailSplitAmount = this.root.querySelector('[data-detail-split-amount]');
            this.detailDurabilityField = this.root.querySelector('[data-detail-durability]');
            this.detailDurabilityInput = this.root.querySelector('[data-detail-durability-input]');
            this.detailItemId = null;
            this.stats = null;
            this.attributes = null;
            this.statsValues = {
                hp: Array.from(this.root.querySelectorAll('[data-stat-value="hp"]')),
                mana: Array.from(this.root.querySelectorAll('[data-stat-value="mana"]')),
                ki: Array.from(this.root.querySelectorAll('[data-stat-value="ki"]')),
                speed: Array.from(this.root.querySelectorAll('[data-stat-value="speed"]')),
                hungry: Array.from(this.root.querySelectorAll('[data-stat-value="hungry"]')),
                ac: Array.from(this.root.querySelectorAll('[data-stat-value="ac"]')),
            };
            this.healthValues = {
                hp_head: this.root.querySelector('[data-health-value="hp_head"]'),
                hp_torso: this.root.querySelector('[data-health-value="hp_torso"]'),
                hp_left_arm: this.root.querySelector('[data-health-value="hp_left_arm"]'),
                hp_right_arm: this.root.querySelector('[data-health-value="hp_right_arm"]'),
                hp_left_leg: this.root.querySelector('[data-health-value="hp_left_leg"]'),
                hp_right_leg: this.root.querySelector('[data-health-value="hp_right_leg"]'),
                reason: this.root.querySelector('[data-health-value="reason"]'),
            };
            this.statsFills = {
                hp: this.root.querySelector('[data-stat-fill="hp"]'),
                mana: this.root.querySelector('[data-stat-fill="mana"]'),
                ki: this.root.querySelector('[data-stat-fill="ki"]'),
                hungry: this.root.querySelector('[data-stat-fill="hungry"]'),
            };
            this.statsInputs = Array.from(this.root.querySelectorAll('[data-stat-input]'));
            this.formulaSection = this.root.querySelector('[data-formula-section]');
            this.formulaRows = Array.from(this.root.querySelectorAll('[data-formula-row]'));
            this.formulaSaveButton = this.root.querySelector('[data-formula-save]');
            this.formulaTestButton = this.root.querySelector('[data-formula-test]');
            this.formulaInputs = new Map();
            this.formulaResults = new Map();
            this.formulaErrors = new Map();
            this.formulaValues = {};
            this.formulaErrorState = {};
            this.notesInput = this.root.querySelector('[data-notes-input]');
            this.notesRendered = this.root.querySelector('[data-notes-rendered]');
            this.notesActions = this.root.querySelector('[data-notes-actions]');
            this.notesSaveButton = this.root.querySelector('[data-notes-save]');
            this.notesEditButton = this.root.querySelector('[data-notes-edit]');
            this.notesStatus = this.root.querySelector('[data-notes-status]');
            this.notesPayload = null;
            this.notesSaveTimer = null;
            this.notesMode = 'view';
            this.bagGridList = this.root.querySelector('[data-bag-grid-list]');
            this.fastSlotList = this.root.querySelector('[data-fast-slot-list]');
            this.fastSlotPanel = this.root.querySelector('[data-fast-slot-panel]');
            const lobbyRoom = this.root.closest('.lobby-room');
            this.masterToggle = lobbyRoom
                ? lobbyRoom.querySelector(`[data-master-toggle][data-lobby-id="${this.lobbyId}"]`)
                : this.root.querySelector('[data-master-toggle]');
            this.masterMode = 'view';
            this.gridElements = Array.from(this.root.querySelectorAll('.tetris-grid'));
            this.characterClassText = this.root.querySelector('[data-character-class-text]');
            this.characterClassSelect = this.root.querySelector('[data-character-class-select]');
            this.characterRaceText = this.root.querySelector('[data-character-race-text]');
            this.characterRaceInput = this.root.querySelector('[data-character-race-input]');
            this.characterMasteryInput = this.root.querySelector('[data-character-mastery-input]');
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
            this.shopOverlay = document.querySelector(`[data-shop-overlay][data-lobby-id="${this.lobbyId}"]`);
            this.shopGrid = this.shopOverlay?.querySelector('[data-shop-grid]');
            this.shopContainerLabel = this.shopOverlay?.querySelector('[data-shop-container-label]');
            this.shopOpenButton = this.root.querySelector('[data-shop-open]');
            this.shopStopButton = this.root.querySelector('[data-shop-stop]');
            this.shopCloseButton = this.shopOverlay?.querySelector('[data-shop-close]');
            this.shopDetailImage = this.shopOverlay?.querySelector('[data-shop-detail-image]');
            this.shopDetailName = this.shopOverlay?.querySelector('[data-shop-detail-name]');
            this.shopDetailDescription = this.shopOverlay?.querySelector('[data-shop-detail-description]');
            this.shopDetailQty = this.shopOverlay?.querySelector('[data-shop-detail-qty]');
            this.shopDetailDurability = this.shopOverlay?.querySelector('[data-shop-detail-durability]');
            this.shopPollInterval = 3000;
            this.shopPollTimer = null;
            this.shopActive = false;
            this.shopContainer = null;
            this.shopItems = [];
            this.shopDetailItemId = null;
            this.lastPointer = null;
            this.debugActionTimestamps = new Map();
            this.pendingSplits = new Set();

            this.formulaRows.forEach((row) => {
                const statKey = row.dataset.formulaKey;
                if (!statKey) return;
                const input = row.querySelector('[data-formula-input]');
                const result = row.querySelector('[data-formula-result]');
                const error = row.querySelector('[data-formula-error]');
                if (input) this.formulaInputs.set(statKey, input);
                if (result) this.formulaResults.set(statKey, result);
                if (error) this.formulaErrors.set(statKey, error);
            });

            this.bindEvents();
            this.loadInitialState();
            this.initShop();
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
                if (event.key === 'Escape' && this.shopOverlay?.classList.contains('is-open')) {
                    this.closeShopOverlay();
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
                    if (button.dataset.detailActionBound === 'true') return;
                    button.dataset.detailActionBound = 'true';
                    button.addEventListener('click', () => {
                        this.handleDetailAction(button.dataset.detailAction, button);
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
            if (this.characterRaceInput) {
                this.characterRaceInput.addEventListener('change', () => {
                    if (!this.canEditProfile()) return;
                    this.saveCharacterProfile();
                });
            }
            if (this.characterMasteryInput) {
                this.characterMasteryInput.addEventListener('change', () => {
                    if (!this.canEditProfile()) return;
                    this.saveCharacterProfile();
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
                input?.addEventListener('change', () => {
                    if (!this.canEditAttributes()) return;
                    this.submitAttributeUpdate();
                });
            });

            if (this.formulaSaveButton) {
                this.formulaSaveButton.addEventListener('click', () => {
                    if (!this.canEditFormulas()) return;
                    this.saveFormulas();
                });
            }

            if (this.formulaTestButton) {
                this.formulaTestButton.addEventListener('click', () => {
                    this.evaluateFormulas();
                });
            }

            this.formulaInputs.forEach((input, statKey) => {
                input.addEventListener('input', () => {
                    this.clearFormulaError(statKey);
                });
            });

            if (this.notesSaveButton) {
                this.notesSaveButton.addEventListener('click', () => {
                    this.saveNotes({ switchToView: true });
                });
            }
            if (this.notesEditButton) {
                this.notesEditButton.addEventListener('click', () => {
                    this.setNotesMode('edit');
                });
            }
            if (this.notesInput) {
                this.notesInput.addEventListener('input', () => {
                    this.setNotesStatus('unsaved');
                    this.scheduleNotesSave();
                });
            }
            if (this.notesRendered) {
                this.notesRendered.addEventListener('click', (event) => {
                    if (this.notesMode !== 'view') return;
                    const target = event.target.closest('.note-roll');
                    if (!target || !(target instanceof HTMLElement)) return;
                    if (target.classList.contains('is-disabled')) return;
                    const rollText = target.dataset.roll || '';
                    if (!rollText.trim()) return;
                    event.preventDefault();
                    event.stopPropagation();
                    console.debug('[Notes] Roll click', rollText);
                    this.submitNotesRoll(rollText);
                });
            }

            this.mapClose?.addEventListener('click', () => this.closeMapOverlay());
            this.mapOverlay?.addEventListener('click', (event) => {
                if (event.target === this.mapOverlay) this.closeMapOverlay();
            });

            this.shopOpenButton?.addEventListener('click', () => this.openShopOverlay());
            this.shopCloseButton?.addEventListener('click', () => this.closeShopOverlay());
            this.shopOverlay?.addEventListener('click', (event) => {
                if (event.target === this.shopOverlay) this.closeShopOverlay();
            });
            this.shopStopButton?.addEventListener('click', () => this.confirmShopStop());
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

        initShop() {
            if (!this.lobbyId || !this.shopOverlay) return;
            this.refreshShopStatus();
            this.shopPollTimer = window.setInterval(() => this.refreshShopStatus(), this.shopPollInterval);
        }

        async refreshShopStatus() {
            if (!this.lobbyId) return;
            try {
                const response = await fetch(`/api/lobby/${this.lobbyId}/shop/status`);
                if (!response.ok) return;
                const payload = await response.json().catch(() => ({}));
                this.handleShopStatus(payload || {});
            } catch (error) {
                console.debug('[Shop] Status refresh failed', error);
            }
        }

        handleShopStatus(payload) {
            const isActive = Boolean(payload?.active);
            if (!isActive) {
                this.shopActive = false;
                this.shopContainer = null;
                this.shopItems = [];
                this.updateShopButtons(false);
                if (this.shopOverlay?.classList.contains('is-open')) {
                    this.closeShopOverlay();
                }
                this.notifyShopStatus(false);
                return;
            }
            this.shopActive = true;
            this.shopContainer = payload.container || null;
            this.shopItems = Array.isArray(payload.items) ? payload.items : [];
            if (this.shopContainerLabel) {
                this.shopContainerLabel.textContent = this.shopContainer?.label || '—';
            }
            this.updateShopButtons(true);
            if (this.shopOverlay?.classList.contains('is-open')) {
                this.renderShopGrid();
            }
            this.notifyShopStatus(true);
        }

        updateShopButtons(isActive) {
            this.shopOpenButton?.classList.toggle('is-hidden', !isActive);
            const shouldHideStop = !isActive || !this.permissions.is_master;
            this.shopStopButton?.classList.toggle('is-hidden', shouldHideStop);
        }

        openShopOverlay() {
            if (!this.shopActive || !this.shopOverlay) return;
            this.shopOverlay.classList.add('is-open');
            this.shopOverlay.setAttribute('aria-hidden', 'false');
            this.renderShopGrid();
        }

        closeShopOverlay() {
            if (!this.shopOverlay) return;
            this.shopOverlay.classList.remove('is-open');
            this.shopOverlay.setAttribute('aria-hidden', 'true');
            this.shopDetailItemId = null;
            this.updateShopDetails(null);
        }

        notifyShopStatus(isActive) {
            if (!this.lobbyId) return;
            document.dispatchEvent(new CustomEvent('shop-status', {
                detail: {
                    lobbyId: this.lobbyId,
                    active: isActive,
                },
            }));
        }

        async confirmShopStop() {
            if (!this.permissions.is_master) return;
            if (!this.shopActive) return;
            const confirmed = window.confirm('Закрити магазин для всіх гравців?');
            if (!confirmed) return;
            await this.stopShop();
        }

        async stopShop() {
            if (!this.lobbyId) return;
            const response = await fetch(`/api/lobby/${this.lobbyId}/shop/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            if (response.ok) {
                await this.refreshShopStatus();
            }
        }

        async startShop(containerId) {
            if (!this.lobbyId || !this.permissions.is_master) return;
            if (!containerId) return;
            const response = await fetch(`/api/lobby/${this.lobbyId}/shop/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ container_id: containerId }),
            });
            if (response.ok) {
                await this.refreshShopStatus();
            }
        }

        bindShopContainerButtons() {
            this.root.querySelectorAll('[data-shop-start]').forEach((button) => {
                if (button.dataset.shopBound === 'true') return;
                button.dataset.shopBound = 'true';
                button.addEventListener('click', () => {
                    const containerId = button.dataset.containerId;
                    this.startShop(containerId);
                });
            });
        }

        renderShopGrid() {
            if (!this.shopGrid || !this.shopContainer) return;
            this.buildGrid(this.shopGrid, this.shopContainer);
            this.shopGrid.querySelectorAll('.inventory-item, .inventory-ghost').forEach((node) => node.remove());
            this.shopItems.forEach((item) => {
                if (item.container_id !== this.shopContainer.id) return;
                if (item.pos_x === null || item.pos_y === null) return;
                const size = this.getItemSize(item);
                const metrics = this.cellSize(this.shopGrid, this.shopContainer);
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
                element.style.left = `${metrics.paddingX + (item.pos_x - 1) * (metrics.width + metrics.gapX)}px`;
                element.style.top = `${metrics.paddingY + (item.pos_y - 1) * (metrics.height + metrics.gapY)}px`;
                element.style.width = `${size.w * metrics.width + metrics.gapX * (size.w - 1) - 4}px`;
                element.style.height = `${size.h * metrics.height + metrics.gapY * (size.h - 1) - 4}px`;
                const durabilityLabel = item.has_durability
                    ? (item.str_current <= 0 ? 'Broken' : `${item.str_current}/${item.max_durability}`)
                    : '—';
                element.innerHTML = `
                    <div class="inventory-item__label">${item.name}</div>
                    <div class="inventory-item__meta">${durabilityLabel}</div>
                    ${item.stackable ? `<div class="inventory-item__qty">x${item.amount}</div>` : ''}
                `;
                element.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.shopDetailItemId = item.id;
                    this.updateShopDetails(item);
                });
                this.shopGrid.appendChild(element);
            });
            if (this.shopDetailItemId) {
                const detailItem = this.shopItems.find((entry) => String(entry.id) === String(this.shopDetailItemId));
                this.updateShopDetails(detailItem || null);
            } else {
                this.updateShopDetails(null);
            }
        }

        updateShopDetails(item) {
            if (!this.shopDetailImage || !this.shopDetailName || !this.shopDetailDescription) return;
            if (!item) {
                this.shopDetailImage.src = '/static/images/default_avatar.png';
                this.shopDetailImage.alt = 'Item';
                this.shopDetailName.textContent = 'Оберіть предмет';
                this.shopDetailDescription.textContent = '';
                if (this.shopDetailQty) {
                    this.shopDetailQty.textContent = 'Qty: —';
                    this.shopDetailQty.classList.add('is-hidden');
                }
                if (this.shopDetailDurability) {
                    this.shopDetailDurability.textContent = 'Durability: —';
                    this.shopDetailDurability.classList.add('is-hidden');
                }
                return;
            }
            const imageUrl = this.resolveImageUrl(item.image_path);
            this.shopDetailImage.src = imageUrl || '/static/images/default_avatar.png';
            this.shopDetailImage.alt = item.name || 'Item';
            this.shopDetailName.textContent = item.name || 'Item';
            this.shopDetailDescription.textContent = item.description || '';
            if (this.shopDetailQty) {
                if (item.stackable) {
                    this.shopDetailQty.textContent = `Qty: x${item.amount}`;
                    this.shopDetailQty.classList.remove('is-hidden');
                } else {
                    this.shopDetailQty.textContent = 'Qty: —';
                    this.shopDetailQty.classList.add('is-hidden');
                }
            }
            if (this.shopDetailDurability) {
                if (item.has_durability) {
                    const label = item.str_current <= 0 ? 'Broken' : `${item.str_current}/${item.max_durability}`;
                    this.shopDetailDurability.textContent = `Durability: ${label}`;
                    this.shopDetailDurability.classList.remove('is-hidden');
                } else {
                    this.shopDetailDurability.textContent = 'Durability: —';
                    this.shopDetailDurability.classList.add('is-hidden');
                }
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
            this.loadFormulas();
            this.loadNotes();
            this.updateWeightDisplay(payload.weight);
            this.root.classList.toggle('is-readonly', !this.permissions.can_edit);
            if (this.inventoryActions) {
                this.inventoryActions.classList.toggle('is-disabled', !this.permissions.can_edit);
            }
            this.updateShopButtons(this.shopActive);
            this.refreshMasterModeState();
            this.rebuildBagGrids();
            this.rebuildFastSlots();
            this.bindShopContainerButtons();
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
                    const headerActions = [];
                    if (container.bag_broken) {
                        headerActions.push('<span class="panel-tag danger">Broken</span>');
                    }
                    if (this.permissions.is_master) {
                        headerActions.push(
                            `<button class="button ghost shop-button" type="button" data-shop-start data-container-id="${container.id}" title="Open Shop">🛒</button>`,
                        );
                    }
                    panel.innerHTML = `
                        <div class="panel-header">
                            <span class="panel-title">${container.label || 'Bag'}</span>
                            ${headerActions.length ? `<div class="panel-header__actions">${headerActions.join('')}</div>` : ''}
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
                const headerActions = this.permissions.is_master
                    ? `<div class="panel-header__actions">
                        <button class="button ghost shop-button" type="button" data-shop-start data-container-id="${container.id}" title="Open Shop">🛒</button>
                    </div>`
                    : '';
                panel.innerHTML = `
                    <div class="panel-header">
                        <span class="panel-title">${container.label || 'Fast Slot'}</span>
                        ${headerActions}
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
                    ? (item.str_current <= 0 ? 'Broken' : `${item.str_current}/${item.max_durability}`)
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

        handleDetailAction(action, triggerButton = null) {
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
                        this.splitItem(item, {
                            amount,
                            attachDrag: true,
                            triggerButton,
                            source: 'detail',
                        });
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
                    durabilityInput.max = `${item.max_durability || 0}`;
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
            if (this.pendingSplits.has(item.id)) return;
            this.trackAction(`split:${item.id}`);
            const hasProvidedAmount = Object.prototype.hasOwnProperty.call(options, 'amount');
            const amount = hasProvidedAmount
                ? options.amount
                : Number.parseInt(this.contextMenu?.querySelector('[data-split-amount]')?.value || '1', 10);
            if (!options.splitHalf) {
                if (!amount || Number.isNaN(amount)) return;
                if (amount < 1 || amount >= item.amount) return;
            }
            if (options.triggerButton) {
                options.triggerButton.disabled = true;
            }
            this.pendingSplits.add(item.id);
            const payload = {
                item_id: item.id,
                version: item.version,
            };
            if (options.splitHalf) {
                payload.split_half = true;
            } else {
                payload.amount = amount;
            }
            console.debug('[Inventory] Split request', payload);
            try {
                const response = await fetch('/api/inventory/split', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                const json = await response.json().catch(() => ({}));
                console.debug('[Inventory] Split response', {
                    ok: response.ok,
                    status: response.status,
                    payload: json,
                });
                if (response.ok) {
                    if (!Array.isArray(json.instances)) {
                        console.warn('[Inventory] Split missing instances payload', json);
                        return;
                    }
                    this.applyInstanceUpdates(json.instances);
                    if (json.weight) {
                        this.updateWeightDisplay(json.weight);
                    }
                    if (options.attachDrag && json?.new_instance_id) {
                        const newItem = this.getItemById(json.new_instance_id);
                        if (newItem) {
                            this.attachDragToItem(newItem);
                        }
                    }
                    return;
                }
                if (response.status === 409) {
                    await this.refreshInventory(this.selectedPlayerId);
                    return;
                }
                if (response.status === 400) {
                    console.warn('[Inventory] Split rejected', {
                        error: json?.error,
                        item_id: item.id,
                    });
                }
            } finally {
                this.pendingSplits.delete(item.id);
                if (options.triggerButton) {
                    options.triggerButton.disabled = false;
                }
            }
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
            if (value < 0 || (item.max_durability != null && value > item.max_durability)) return;
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
            if (templateInput && item?.template_id) {
                templateInput.value = `${item.template_id}`;
            }
            const definitionId = Number.parseInt(templateInput?.value || '0', 10);
            const target = Number.parseInt(targetInput?.value || '0', 10);
            const amount = Number.parseInt(amountInput?.value || '1', 10);
            if (!definitionId || !target) return;
            if (Number.isNaN(amount) || amount < 1) {
                this.showIssueByIdError({ error: 'invalid_amount' });
                return;
            }
            const confirmed = window.confirm(`Видати шаблон #${definitionId} для користувача ${target}?`);
            if (!confirmed) return;
            this.trackAction(`issue-by-id:${definitionId}:${target}`);
            if (DEBUG_INVENTORY) {
                console.debug('[IssueById]', 'context issue start', { definitionId, target, amount });
            }
            const durabilityRaw = durabilityInput?.value ?? '';
            const payload = {
                lobby_id: this.lobbyId,
                definition_id: definitionId,
                target_user_id: target,
                amount: Number.isNaN(amount) ? 1 : amount,
                durability_current: durabilityRaw === '' ? null : durabilityRaw,
            };
            console.debug('GiveID fetch started', payload);
            console.log('GiveID fetch starting', payload);
            let response;
            try {
                response = await fetch(`/api/lobby/${this.lobbyId}/master/give-id`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                console.log('GiveID fetch completed', { status: response.status });
            } catch (error) {
                console.log('GiveID fetch failed', error);
                throw error;
            }
            const responsePayload = await response.clone().json().catch(() => null);
            console.debug('GiveID response', {
                status: response.status,
                request_id: responsePayload?.request_id || null,
                payload: responsePayload,
            });
            if (response.ok) {
                await this.refreshInventory(this.selectedPlayerId);
                return;
            }
            const errorPayload = responsePayload || await response.json().catch(() => ({}));
            this.showIssueByIdError(errorPayload);
            await this.refreshInventory(this.selectedPlayerId);
        }

        showIssueByIdError(payload) {
            const error = payload?.error || '';
            let message = 'Не вдалося видати предмет.';
            if (error === 'no_space') {
                message = 'Немає місця у інвентарі для цього предмета.';
            } else if (error === 'non_stackable_amount') {
                message = 'Цей предмет не є стековим. Кількість має бути 1.';
            } else if (error === 'invalid_amount') {
                message = 'Кількість має бути 1 або більше.';
            } else if (error === 'invalid_durability') {
                message = 'Некоректне значення durability.';
            } else if (error === 'durability_not_allowed') {
                message = 'Цей предмет не має durability. Очистіть значення.';
            } else if (error === 'missing_definition') {
                message = 'Вкажіть ID або назву шаблону.';
            } else if (error === 'not_found') {
                message = 'Шаблон не знайдено.';
            } else if (error === 'forbidden') {
                message = 'Недостатньо прав для видачі предмета.';
            }
            window.alert(message);
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
                if (this.detailAmmo) {
                    this.detailAmmo.classList.add('is-hidden');
                    this.detailAmmo.textContent = '';
                }
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
            if (this.detailAmmo) {
                const ammoType = `${item.ammo_type || ''}`.trim();
                const isWeapon = item.type === 'weapon';
                if (isWeapon) {
                    this.detailAmmo.textContent = ammoType ? `AmmoType: ${ammoType}` : 'Ammo: none';
                    this.detailAmmo.classList.remove('is-hidden');
                } else {
                    this.detailAmmo.textContent = '';
                    this.detailAmmo.classList.add('is-hidden');
                }
            }
            if (this.detailActions) {
                this.detailActions.classList.toggle('is-hidden', !this.permissions.can_edit);
                const useButton = this.detailActions.querySelector('[data-detail-action="use"]');
                useButton?.classList.toggle(
                    'is-hidden',
                    !['food', 'map', 'weapon'].includes(item.type),
                );
                if (useButton && item.type === 'weapon') {
                    const isBroken = (item.str_current ?? 0) <= 0;
                    useButton.disabled = isBroken;
                } else if (useButton) {
                    useButton.disabled = false;
                }
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
                    this.detailDurabilityInput.max = `${item.max_durability || 0}`;
                    this.detailDurabilityInput.value = `${item.str_current ?? 0}`;
                }
            }
        }

        normalizeAmmoType(value) {
            return `${value || ''}`.trim().toLowerCase();
        }

        hasAmmoForWeapon(ammoType) {
            if (!ammoType) return true;
            const target = this.normalizeAmmoType(ammoType);
            return this.items.some((entry) => (
                entry.type === 'ammo'
                && this.normalizeAmmoType(entry.ammo_type) === target
                && (entry.amount ?? 0) > 0
            ));
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
            if (this.characterRaceInput) {
                this.characterRaceInput.disabled = !this.canEditProfile();
            }
            if (this.characterMasteryInput) {
                this.characterMasteryInput.disabled = !this.canEditProfile();
            }
            this.attributeRows.forEach((row) => {
                row.classList.toggle('is-readonly', !this.canEditAttributes());
                const input = row.querySelector('[data-attribute-input]');
                if (input) input.disabled = !this.canEditAttributes();
            });
            if (this.attributeFormulaInput) {
                this.attributeFormulaInput.disabled = !this.canEditAttributes();
            }
            if (this.attributeFormulaSave) {
                this.attributeFormulaSave.disabled = !this.canEditAttributes();
            }
            if (this.formulaSection) {
                this.formulaSection.classList.toggle('is-hidden', !this.permissions.is_master);
            }
            this.formulaInputs.forEach((input) => {
                input.disabled = !this.canEditFormulas();
            });
            if (this.formulaSaveButton) {
                this.formulaSaveButton.disabled = !this.canEditFormulas();
            }
            if (this.formulaTestButton) {
                this.formulaTestButton.disabled = !this.permissions.is_master;
            }
            if (this.notesInput || this.notesRendered) {
                this.updateNotesUI();
            }
        }

        canEditStats() {
            return this.permissions.is_master && this.masterMode === 'control';
        }

        canEditAttributes() {
            return this.permissions.is_master && this.masterMode === 'control';
        }

        canEditFormulas() {
            return this.permissions.is_master && this.masterMode === 'control';
        }

        canEditProfile() {
            return this.permissions.is_master || String(this.currentUserId) === String(this.selectedPlayerId);
        }

        canEditNotes() {
            if (!this.selectedPlayerId) return false;
            return this.permissions.is_master || String(this.currentUserId) === String(this.selectedPlayerId);
        }

        canRollNotes() {
            return this.canEditNotes() && this.notesMode === 'view';
        }

        setNotesStatus(state, updatedAt = null) {
            if (!this.notesStatus) return;
            if (!state) {
                this.notesStatus.textContent = '';
                return;
            }
            if (state === 'saving') {
                this.notesStatus.textContent = 'Збереження...';
                return;
            }
            if (state === 'error') {
                this.notesStatus.textContent = 'Не вдалося зберегти.';
                return;
            }
            if (state === 'unsaved') {
                this.notesStatus.textContent = 'Є незбережені зміни.';
                return;
            }
            if (state === 'saved') {
                this.notesStatus.textContent = updatedAt ? `Збережено: ${updatedAt}` : 'Збережено.';
            }
        }

        buildNotesTokens(text) {
            const tokens = [];
            if (!text) return tokens;
            const rollPattern = /^\s*\d+d\d+(?:\s*[+-]\s*\d+)?\s*$/i;
            let index = 0;
            while (index < text.length) {
                const start = text.indexOf('(', index);
                if (start === -1) {
                    tokens.push({ type: 'text', value: text.slice(index) });
                    break;
                }
                if (start > index) {
                    tokens.push({ type: 'text', value: text.slice(index, start) });
                }
                let depth = 0;
                let end = -1;
                for (let i = start; i < text.length; i += 1) {
                    const char = text[i];
                    if (char === '(') depth += 1;
                    if (char === ')') {
                        depth -= 1;
                        if (depth === 0) {
                            end = i;
                            break;
                        }
                    }
                }
                if (end === -1) {
                    tokens.push({ type: 'text', value: text.slice(start) });
                    break;
                }
                const rollText = text.slice(start + 1, end);
                if (rollPattern.test(rollText)) {
                    const normalized = rollText.replace(/\s+/g, '');
                    tokens.push({ type: 'roll', value: normalized });
                } else {
                    tokens.push({ type: 'text', value: text.slice(start, end + 1) });
                }
                index = end + 1;
            }
            return tokens;
        }

        renderNotesPreview(text) {
            if (!this.notesRendered) return;
            this.notesRendered.innerHTML = '';
            const fragment = document.createDocumentFragment();
            const tokens = this.buildNotesTokens(text);
            if (!tokens.length) {
                this.notesRendered.classList.add('is-hidden');
                return;
            }
            tokens.forEach((token) => {
                if (token.type === 'text') {
                    fragment.appendChild(document.createTextNode(token.value));
                    return;
                }
                const span = document.createElement('span');
                span.className = 'note-roll';
                if (!this.canRollNotes()) {
                    span.classList.add('is-disabled');
                }
                span.dataset.roll = token.value;
                span.textContent = `(${token.value})`;
                fragment.appendChild(span);
            });
            this.notesRendered.appendChild(fragment);
            this.notesRendered.classList.remove('is-hidden');
        }

        getNotesText() {
            return this.notesInput?.value ?? this.notesPayload?.notes_text ?? '';
        }

        setNotesMode(mode) {
            if (!mode || this.notesMode === mode) return;
            this.notesMode = mode;
            this.updateNotesUI();
        }

        updateNotesUI() {
            const canEditNotes = this.canEditNotes();
            const isEditing = this.notesMode === 'edit' && canEditNotes;
            if (this.notesInput) {
                this.notesInput.disabled = !canEditNotes;
                this.notesInput.classList.toggle('is-hidden', !isEditing);
            }
            if (this.notesRendered) {
                if (isEditing) {
                    this.notesRendered.classList.add('is-hidden');
                } else {
                    const notesText = this.getNotesText();
                    this.renderNotesPreview(notesText);
                    this.notesRendered.classList.remove('is-hidden');
                }
            }
            if (this.notesSaveButton) {
                this.notesSaveButton.disabled = !canEditNotes;
                this.notesSaveButton.classList.toggle('is-hidden', !isEditing);
            }
            if (this.notesEditButton) {
                this.notesEditButton.disabled = !canEditNotes;
                this.notesEditButton.classList.toggle('is-hidden', !canEditNotes || isEditing);
            }
            if (this.notesActions) {
                this.notesActions.classList.toggle('is-hidden', !canEditNotes);
            }
        }

        async submitNotesRoll(rollText) {
            if (!this.lobbyId || !this.selectedPlayerId) return;
            if (!this.canRollNotes()) return;
            try {
                const response = await fetch(`/api/lobby/${this.lobbyId}/notes/roll`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        user_id: this.selectedPlayerId,
                        roll_text: rollText,
                    }),
                });
                if (!response.ok) {
                    console.debug('[Notes] Roll failed', response.status);
                    return;
                }
                console.debug('[Notes] Roll sent', rollText);
            } catch (error) {
                console.debug('[Notes] Roll failed', error);
            }
        }

        updateFormulaValuesFromStats() {
            if (!this.stats) return;
            this.formulaValues = {};
            Object.entries(formulaStatMap).forEach(([formulaKey, statKey]) => {
                const value = this.stats?.[statKey];
                if (value !== undefined && value !== null) {
                    this.formulaValues[formulaKey] = value;
                }
            });
        }

        refreshFormulaResultsFromStats() {
            if (!this.permissions.is_master) return;
            this.formulaResults.forEach((node, statKey) => {
                const value = this.formulaValues?.[statKey];
                if (node) {
                    node.textContent = Number.isFinite(value) ? `${value}` : '—';
                }
            });
        }

        updateStatsUI() {
            if (!this.stats) return;
            const hpCurrent = this.stats.hp_current ?? 0;
            const hpMax = this.stats.hp_max ?? 0;
            const manaCurrent = this.stats.mana_current ?? 0;
            const manaMax = this.stats.mana_max ?? 0;
            const kiCurrent = this.stats.ki_current ?? 0;
            const kiMax = this.stats.ki_max ?? 0;
            const hungry = this.stats.hungry ?? 0;
            const ac = this.stats.armor_class ?? 0;
            const speed = this.stats.speed ?? 0;
            const setStatValue = (nodes, value) => {
                nodes.forEach((node) => {
                    if (node) node.textContent = value;
                });
            };
            setStatValue(this.statsValues.hp, `${hpCurrent}/${hpMax}`);
            setStatValue(this.statsValues.mana, `${manaCurrent}/${manaMax}`);
            setStatValue(this.statsValues.ki, `${kiCurrent}/${kiMax}`);
            setStatValue(this.statsValues.speed, `${speed}`);
            setStatValue(this.statsValues.hungry, `${hungry}/100`);
            setStatValue(this.statsValues.ac, `${ac}`);
            if (this.statsFills.hp) {
                const pct = hpMax > 0 ? (hpCurrent / hpMax) * 100 : 0;
                this.statsFills.hp.style.width = `${Math.min(Math.max(pct, 0), 100)}%`;
            }
            if (this.statsFills.mana) {
                const pct = manaMax > 0 ? (manaCurrent / manaMax) * 100 : 0;
                this.statsFills.mana.style.width = `${Math.min(Math.max(pct, 0), 100)}%`;
            }
            if (this.statsFills.ki) {
                const pct = kiMax > 0 ? (kiCurrent / kiMax) * 100 : 0;
                this.statsFills.ki.style.width = `${Math.min(Math.max(pct, 0), 100)}%`;
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
                    case 'ki_current':
                        input.max = `${kiMax}`;
                        input.value = `${kiCurrent}`;
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
            this.updateFormulaValuesFromStats();
            this.refreshFormulaResultsFromStats();
            this.updateHealthUI();
        }

        updateHealthUI() {
            const defaults = {
                hp_head: this.stats?.hp_head ?? 0,
                hp_torso: this.stats?.hp_torso ?? 0,
                hp_left_arm: this.stats?.hp_left_arm ?? 0,
                hp_right_arm: this.stats?.hp_right_arm ?? 0,
                hp_left_leg: this.stats?.hp_left_leg ?? 0,
                hp_right_leg: this.stats?.hp_right_leg ?? 0,
                reason: this.stats?.reason ?? 0,
            };
            const values = { ...defaults, ...this.formulaValues };
            Object.entries(this.healthValues).forEach(([key, node]) => {
                if (!node) return;
                const value = values[key];
                node.textContent = Number.isFinite(value) ? `${value}` : '—';
            });
        }

        updateClassUI(userPayload) {
            if (!userPayload) return;
            const className = userPayload.character_class || '???';
            if (this.characterClassText) {
                this.characterClassText.textContent = className;
            }
            if (this.characterClassSelect) {
                this.characterClassSelect.value = className;
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
            const race = this.attributes.race || '';
            const mastery = this.attributes.mastery ?? 7;
            if (this.characterRaceText) {
                this.characterRaceText.textContent = race || '—';
            }
            if (this.characterRaceInput) {
                this.characterRaceInput.value = race;
            }
            if (this.characterMasteryInput) {
                this.characterMasteryInput.value = `${mastery}`;
            }
            this.attributeRows.forEach((row) => {
                const statKey = row.dataset.attributeKey;
                if (!statKey) return;
                const value = stats[statKey] ?? 0;
                const modifier = modifiers[statKey] ?? 0;
                const input = row.querySelector('[data-attribute-input]');
                const readonly = row.querySelector('[data-attribute-readonly]');
                const modifierNode = row.querySelector('[data-attribute-modifier]');
                if (input) input.value = `${value}`;
                if (readonly) readonly.textContent = `${value}`;
                if (modifierNode) modifierNode.textContent = this.formatModifier(modifier);
            });
            if (this.attributeFormulaInput && this.permissions.is_master) {
                this.attributeFormulaInput.value = this.attributes.formula || '';
            }
            if (this.attributeFormulaWrap) {
                this.attributeFormulaWrap.classList.toggle('is-hidden', !this.permissions.is_master);
            }
            this.refreshMasterModeState();
        }

        clearFormulaError(statKey) {
            const errorNode = this.formulaErrors.get(statKey);
            const row = this.formulaRows.find((entry) => entry.dataset.formulaKey === statKey);
            if (errorNode) errorNode.textContent = '';
            if (row) row.classList.remove('is-error');
            delete this.formulaErrorState[statKey];
        }

        applyFormulaResponse(payload) {
            const results = payload?.results || {};
            const errors = payload?.errors || {};
            Object.entries(results).forEach(([statKey, result]) => {
                if (!result || typeof result.value !== 'number') return;
                this.formulaValues[statKey] = result.value;
                const statField = formulaStatMap[statKey];
                if (statField && this.stats) {
                    this.stats[statField] = result.value;
                }
                const resultNode = this.formulaResults.get(statKey);
                if (resultNode) {
                    resultNode.textContent = `${result.value}`;
                }
                this.clearFormulaError(statKey);
            });
            Object.entries(errors).forEach(([statKey, error]) => {
                const errorNode = this.formulaErrors.get(statKey);
                const row = this.formulaRows.find((entry) => entry.dataset.formulaKey === statKey);
                if (errorNode) {
                    errorNode.textContent = error?.error || 'Error';
                }
                if (row) row.classList.add('is-error');
                this.formulaErrorState[statKey] = error?.error || 'Error';
            });
            this.updateStatsUI();
        }

        async loadFormulas() {
            if (!this.permissions.is_master || !this.formulaSection) return;
            if (!this.selectedPlayerId) return;
            try {
                const response = await fetch(
                    `/api/lobby/${this.lobbyId}/character/${this.selectedPlayerId}/formulas`,
                );
                if (!response.ok) return;
                const data = await response.json().catch(() => ({}));
                const formulas = data?.formulas || {};
                this.formulaErrorState = {};
                this.formulaInputs.forEach((input, statKey) => {
                    const entry = formulas[statKey] || {};
                    input.value = entry.formula || '';
                    const resultNode = this.formulaResults.get(statKey);
                    if (resultNode) {
                        const value = this.formulaValues?.[statKey];
                        resultNode.textContent = Number.isFinite(value) ? `${value}` : '—';
                    }
                    this.clearFormulaError(statKey);
                });
                this.updateHealthUI();
            } catch (error) {
                console.debug('[Formulas] Load failed', error);
            }
        }

        async loadNotes() {
            if (!this.selectedPlayerId || !this.lobbyId) return;
            if (!this.notesInput && !this.notesRendered) return;
            try {
                const response = await fetch(
                    `/api/lobby/${this.lobbyId}/character/${this.selectedPlayerId}/notes`,
                );
                if (!response.ok) return;
                const data = await response.json().catch(() => ({}));
                this.notesPayload = data;
                const notesText = data?.notes_text ?? '';
                if (this.notesInput) {
                    this.notesInput.value = notesText;
                }
                this.notesMode = 'view';
                this.updateNotesUI();
                if (this.canEditNotes()) {
                    if (data?.updated_at) {
                        const updatedAt = new Date(data.updated_at).toLocaleString();
                        this.setNotesStatus('saved', updatedAt);
                    } else {
                        this.setNotesStatus('saved');
                    }
                } else {
                    this.setNotesStatus('');
                }
                console.debug('[Notes] Load success', { lobbyId: this.lobbyId, userId: this.selectedPlayerId });
            } catch (error) {
                console.debug('[Notes] Load failed', error);
            }
        }

        async saveNotes({ switchToView = false } = {}) {
            if (!this.selectedPlayerId || !this.lobbyId || !this.notesInput) return;
            if (!this.canEditNotes()) return;
            if (this.notesSaveTimer) {
                clearTimeout(this.notesSaveTimer);
                this.notesSaveTimer = null;
            }
            this.setNotesStatus('saving');
            try {
                const response = await fetch(
                    `/api/lobby/${this.lobbyId}/character/${this.selectedPlayerId}/notes`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            notes_text: this.notesInput.value,
                        }),
                    },
                );
                if (!response.ok) {
                    this.setNotesStatus('error');
                    return;
                }
                const data = await response.json().catch(() => ({}));
                this.notesPayload = {
                    ...(this.notesPayload || {}),
                    notes_text: this.notesInput.value,
                    updated_at: data?.updated_at || this.notesPayload?.updated_at || null,
                };
                if (data?.updated_at) {
                    const updatedAt = new Date(data.updated_at).toLocaleString();
                    this.setNotesStatus('saved', updatedAt);
                } else {
                    this.setNotesStatus('saved');
                }
                if (switchToView) {
                    this.setNotesMode('view');
                }
                console.debug('[Notes] Save success', { lobbyId: this.lobbyId, userId: this.selectedPlayerId });
            } catch (error) {
                console.debug('[Notes] Save failed', error);
                this.setNotesStatus('error');
            }
        }

        scheduleNotesSave() {
            if (!this.canEditNotes()) return;
            if (!this.notesInput) return;
            if (this.notesSaveTimer) {
                clearTimeout(this.notesSaveTimer);
            }
            this.notesSaveTimer = window.setTimeout(() => {
                this.saveNotes();
            }, 1200);
        }

        async saveFormulas() {
            if (!this.selectedPlayerId) return;
            for (const [statKey, input] of this.formulaInputs.entries()) {
                await this.setFormula(statKey, input.value.trim());
            }
            this.updateStatsUI();
        }

        async setFormula(statKey, formula) {
            if (!this.permissions.is_master || !this.selectedPlayerId) return;
            try {
                const response = await fetch(
                    `/api/lobby/${this.lobbyId}/character/${this.selectedPlayerId}/formulas/set`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            field_key: statKey,
                            formula,
                        }),
                    },
                );
                const data = await response.json().catch(() => ({}));
                if (!response.ok || !data?.ok) {
                    const errorNode = this.formulaErrors.get(statKey);
                    const row = this.formulaRows.find((entry) => entry.dataset.formulaKey === statKey);
                    const message = data?.error || 'Error';
                    if (errorNode) errorNode.textContent = message;
                    if (row) row.classList.add('is-error');
                    this.formulaErrorState[statKey] = message;
                    return;
                }
                const statField = formulaStatMap[statKey];
                if (typeof data.computed_value === 'number') {
                    this.formulaValues[statKey] = data.computed_value;
                    if (statField && this.stats) {
                        this.stats[statField] = data.computed_value;
                    }
                }
                this.clearFormulaError(statKey);
            } catch (error) {
                console.debug('[Formulas] Save failed', error);
            }
        }

        async evaluateFormulas(statKeys = null) {
            if (!this.permissions.is_master || !this.selectedPlayerId) return;
            const payload = { lobby_id: this.lobbyId };
            if (Array.isArray(statKeys) && statKeys.length) {
                payload.stat_keys = statKeys;
            }
            try {
                const response = await fetch(
                    `/api/lobby/${this.lobbyId}/character/${this.selectedPlayerId}/formulas/recompute`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                    },
                );
                if (!response.ok) return;
                const data = await response.json().catch(() => ({}));
                this.applyFormulaResponse(data);
            } catch (error) {
                console.debug('[Formulas] Evaluate failed', error);
            }
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

        async saveCharacterProfile() {
            if (!this.lobbyId || !this.selectedPlayerId) return;
            const payload = {};
            if (this.characterRaceInput) {
                payload.race = this.characterRaceInput.value.trim();
            }
            if (this.characterMasteryInput) {
                const masteryValue = Number.parseInt(this.characterMasteryInput.value || '0', 10);
                if (!Number.isNaN(masteryValue)) {
                    payload.mastery = masteryValue;
                }
            }
            if (payload.race === undefined && payload.mastery === undefined) {
                return;
            }
            const response = await fetch(
                `/api/lobby/${this.lobbyId}/character/${this.selectedPlayerId}/profile`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
            );
            if (response.ok) {
                const data = await response.json().catch(() => ({}));
                if (data?.attributes) {
                    this.attributes = data.attributes;
                    this.updateAttributesUI();
                }
                if (data?.stats) {
                    this.stats = data.stats;
                    this.updateStatsUI();
                }
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
                    if (data?.stats) {
                        this.stats = data.stats;
                        this.updateStatsUI();
                    }
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

        updateStatsPreviewFromInputs() {
            const stats = {
                hp_current: this.stats?.hp_current ?? 0,
                hp_max: this.stats?.hp_max ?? 0,
                mana_current: this.stats?.mana_current ?? 0,
                mana_max: this.stats?.mana_max ?? 0,
                ki_current: this.stats?.ki_current ?? 0,
                ki_max: this.stats?.ki_max ?? 0,
                hungry: this.stats?.hungry ?? 0,
                armor_class: this.stats?.armor_class ?? 0,
            };
            this.statsInputs.forEach((input) => {
                const value = Number.parseInt(input.value || '0', 10);
                if (Number.isNaN(value)) return;
                if (input.dataset.statInput === 'hp_current') stats.hp_current = value;
                if (input.dataset.statInput === 'mana_current') stats.mana_current = value;
                if (input.dataset.statInput === 'ki_current') stats.ki_current = value;
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
        const lobbyId = root.dataset.lobbyId;
        if (lobbyId) {
            window.LOBBY_INVENTORY_CONTROLLERS = window.LOBBY_INVENTORY_CONTROLLERS || {};
            window.LOBBY_INVENTORY_CONTROLLERS[lobbyId] = controller;
        }

        const setAdminTab = (tabId) => {
            const tabButtons = root.querySelectorAll('[data-admin-tab]');
            const tabPanels = root.querySelectorAll('[data-admin-panel]');
            tabButtons.forEach((button) => {
                button.classList.toggle('is-active', button.dataset.adminTab === tabId);
            });
            tabPanels.forEach((panel) => {
                panel.classList.toggle('is-active', panel.dataset.adminPanel === tabId);
            });
            if (lobbyId) {
                window.localStorage.setItem(`${ADMIN_TAB_STORAGE_KEY}:${lobbyId}`, tabId);
            }
        };

        const initializeAdminTabs = () => {
            const tabButtons = root.querySelectorAll('[data-admin-tab]');
            if (!tabButtons.length) return;
            const saved = lobbyId ? window.localStorage.getItem(`${ADMIN_TAB_STORAGE_KEY}:${lobbyId}`) : null;
            const initialTab = saved || tabButtons[0].dataset.adminTab || 'create';
            setAdminTab(initialTab);
            tabButtons.forEach((button) => {
                button.addEventListener('click', () => {
                    const tabId = button.dataset.adminTab;
                    if (tabId) setAdminTab(tabId);
                });
            });
        };

        const updateClothBeltVisibility = (form) => {
            const typeSelect = form.querySelector('select[id^="item_type_"], select[data-template-type]');
            const clothToggle = form.querySelector('input[id^="item_is_cloth_"], input[data-template-is-cloth]');
            const clothFields = form.querySelector('[data-cloth-fields]');
            const beltFields = form.querySelector('[data-belt-fields]');
            const typeValue = typeSelect?.value || 'other';
            const clothToggleTypes = new Set(['backpack', 'shirt', 'pants', 'armor']);
            const isCloth = clothToggle?.checked || typeValue === 'cloth' || typeValue === 'belt';
            const shouldShowClothFields = isCloth || clothToggleTypes.has(typeValue);
            const isBelt = typeValue === 'belt';
            clothFields?.classList.toggle('is-hidden', !shouldShowClothFields);
            beltFields?.classList.toggle('is-hidden', !isBelt);
            clothFields?.querySelectorAll(
                'input[id^="item_bag_w_"], input[id^="item_bag_h_"], input[data-template-bag-width], input[data-template-bag-height]',
            ).forEach((input) => {
                input.disabled = !isCloth;
            });
            beltFields?.querySelectorAll(
                'input[id^="item_fast_w_"], input[id^="item_fast_h_"], input[data-template-fast-w], input[data-template-fast-h]',
            ).forEach((input) => {
                input.disabled = !isBelt;
            });
        };

        const updateAmmoVisibility = (form) => {
            const typeSelect = form.querySelector('select[id^="item_type_"], select[data-template-type]');
            const ammoFields = form.querySelector('[data-ammo-fields]');
            const ammoInput = form.querySelector('input[id^="item_ammo_type_"], input[data-template-ammo-type]');
            const typeValue = typeSelect?.value || 'other';
            const isAmmoRelevant = typeValue === 'weapon' || typeValue === 'ammo';
            ammoFields?.classList.toggle('is-hidden', !isAmmoRelevant);
            if (ammoInput) {
                ammoInput.required = typeValue === 'ammo';
            }
        };

        const updateWeaponDurabilityRequirement = (form) => {
            const typeSelect = form.querySelector('select[id^="item_type_"], select[data-template-type]');
            const durabilityInput = form.querySelector('input[id^="item_durability_"], input[data-template-max-durability]');
            const typeValue = typeSelect?.value || 'other';
            if (!durabilityInput) return;
            if (typeValue === 'weapon') {
                durabilityInput.required = true;
                durabilityInput.min = '1';
            } else {
                durabilityInput.required = false;
                durabilityInput.min = '0';
            }
        };

        const wireRandomDurability = (options) => {
            const {
                randomButton,
                maxInput,
                durabilityInput,
            } = options;
            const refresh = () => {
                const maxValue = maxInput ? maxInput.value : '';
                const hasMax = maxValue !== '' && !Number.isNaN(Number.parseInt(maxValue, 10));
                if (randomButton) {
                    randomButton.disabled = !hasMax;
                }
                if (durabilityInput) {
                    durabilityInput.max = hasMax ? `${parseNumber(maxValue, 0)}` : '';
                }
            };
            refresh();
            maxInput?.addEventListener('input', refresh);
            randomButton?.addEventListener('click', () => {
                if (randomButton?.disabled) return;
                const value = randomInt(maxInput?.value);
                if (value === null || !durabilityInput) return;
                durabilityInput.value = `${value}`;
            });
            return refresh;
        };

        initializeAdminTabs();
        root.querySelectorAll('[data-master-create]').forEach((form) => {
            const issueButton = form.querySelector('[data-create-submit]');
            const randomButton = form.querySelector('[data-random-durability]');
            const durabilityInput = form.querySelector('input[id^="item_durability_current_"]');
            const randomInput = form.querySelector('input[id^="item_random_durability_"]');
            const max_durability_input = form.querySelector('input[id^="item_durability_"]');
            const typeSelect = form.querySelector('select[id^="item_type_"]');
            const ammoTypeInput = form.querySelector('input[id^="item_ammo_type_"]');
            const clothToggle = form.querySelector('input[id^="item_is_cloth_"]');
            const issueSelfToggle = form.querySelector('[data-issue-self]');
            const refreshRandom = wireRandomDurability({
                randomButton,
                maxInput: max_durability_input,
                durabilityInput,
            });
            if (randomInput) randomInput.value = '0';
            updateClothBeltVisibility(form);
            updateAmmoVisibility(form);
            updateWeaponDurabilityRequirement(form);
            typeSelect?.addEventListener('change', () => {
                updateClothBeltVisibility(form);
                updateAmmoVisibility(form);
                updateWeaponDurabilityRequirement(form);
            });
            clothToggle?.addEventListener('change', () => {
                updateClothBeltVisibility(form);
            });
            issueButton?.addEventListener('click', async () => {
                const name = form.querySelector('input[id^="item_name_"]')?.value?.trim();
                const description = form.querySelector('textarea[id^="item_description_"]')?.value?.trim();
                const type = form.querySelector('select[id^="item_type_"]')?.value;
                const quality = form.querySelector('select[id^="item_quality_"]')?.value;
                const width = Number.parseInt(form.querySelector('input[id^="item_w_"]')?.value || '1', 10);
                const height = Number.parseInt(form.querySelector('input[id^="item_h_"]')?.value || '1', 10);
                const weight = parseFloat(form.querySelector('input[id^="item_weight_"]')?.value || '0');
                const max_durability_value = Number.parseInt(
                    form.querySelector('input[id^="item_durability_"]')?.value || '1',
                    10,
                );
                const durabilityCurrent = form.querySelector('input[id^="item_durability_current_"]')?.value || '';
                const randomDurability = form.querySelector('input[id^="item_random_durability_"]')?.value || '';
                const maxAmount = Number.parseInt(form.querySelector('input[id^="item_max_amount_"]')?.value || '1', 10);
                const issueAmount = Number.parseInt(form.querySelector('input[id^="item_issue_amount_"]')?.value || '1', 10);
                const typeValue = type || 'other';
                const isCloth = form.querySelector('input[id^="item_is_cloth_"]')?.checked
                    || typeValue === 'cloth'
                    || typeValue === 'belt';
                const isBelt = typeValue === 'belt';
                const bagWidth = Number.parseInt(form.querySelector('input[id^="item_bag_w_"]')?.value || '0', 10);
                const bagHeight = Number.parseInt(form.querySelector('input[id^="item_bag_h_"]')?.value || '0', 10);
                const fastWidth = Number.parseInt(form.querySelector('input[id^="item_fast_w_"]')?.value || '0', 10);
                const fastHeight = Number.parseInt(form.querySelector('input[id^="item_fast_h_"]')?.value || '0', 10);
                const ammoType = ammoTypeInput?.value?.trim() || '';
                const targetSelect = form.querySelector('select[id^="item_target_"]');
                const target = targetSelect?.value;
                const imageInput = form.querySelector('input[type="file"]');

                if (!name) {
                    return;
                }
                if (typeValue === 'weapon' && (!Number.isFinite(max_durability_value) || max_durability_value < 1)) {
                    window.alert('Weapon max durability must be at least 1.');
                    return;
                }
                if (typeValue === 'ammo' && !ammoType) {
                    window.alert('Ammo type is required for ammo items.');
                    return;
                }
                if (isCloth && (!Number.isFinite(bagWidth) || bagWidth < 1 || !Number.isFinite(bagHeight) || bagHeight < 1)) {
                    window.alert('Bag width and height must be at least 1 for cloth items.');
                    return;
                }
                if (isBelt && (!Number.isFinite(fastWidth) || fastWidth < 1 || !Number.isFinite(fastHeight) || fastHeight < 1)) {
                    window.alert('Fast slot width and height must be at least 1 for belts.');
                    return;
                }

                const payload = new FormData();
                payload.append('lobby_id', lobbyId);
                payload.append('name', name);
                payload.append('description', description || '');
                payload.append('type', typeValue);
                payload.append('quality', quality || 'common');
                payload.append('width', width);
                payload.append('height', height);
                payload.append('weight', weight);
                payload.append('max_durability', max_durability_value);
                payload.append('durability_current', durabilityCurrent);
                payload.append('random_durability', randomDurability);
                payload.append('max_amount', maxAmount);
                payload.append('issue_amount', issueAmount);
                payload.append('is_cloth', isCloth ? '1' : '0');
                payload.append('bag_width', isCloth && !Number.isNaN(bagWidth) ? bagWidth : 0);
                payload.append('bag_height', isCloth && !Number.isNaN(bagHeight) ? bagHeight : 0);
                payload.append('fast_w', isBelt && !Number.isNaN(fastWidth) ? fastWidth : 0);
                payload.append('fast_h', isBelt && !Number.isNaN(fastHeight) ? fastHeight : 0);
                payload.append('ammo_type', ammoType);
                const issueTo = issueSelfToggle?.checked ? root.dataset.currentUserId : (target || '');
                payload.append('issue_to', issueTo || '');
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
                    refreshRandom();
                    updateClothBeltVisibility(form);
                    updateAmmoVisibility(form);
                    updateWeaponDurabilityRequirement(form);
                    if (randomInput) randomInput.value = '0';
                    if (targetSelect) targetSelect.value = '';
                    return;
                }
                await response.json().catch(() => ({}));
                await controller.refreshInventory(controller.selectedPlayerId);
            });
        });

        root.querySelectorAll('[data-master-issue]').forEach((form) => {
            const button = form.querySelector('[data-issue-submit]');
            const durabilityInput = form.querySelector('input[id^="issue_durability_current_"]');
            const templateInput = form.querySelector('[data-template-id]');
            const searchInput = form.querySelector('[data-template-search]');
            const resultsBox = form.querySelector('[data-template-results]');
            const max_durability_input = form.querySelector('[data-template-max-durability]');
            const nameInput = form.querySelector('[data-template-name]');
            const descriptionInput = form.querySelector('[data-template-description]');
            const imageInput = form.querySelector('[data-template-image]');
            const imagePreview = form.querySelector('[data-template-image-preview]');
            const imageEmpty = form.querySelector('[data-template-image-empty]');
            const typeInput = form.querySelector('[data-template-type]');
            const qualityInput = form.querySelector('[data-template-quality]');
            const widthInput = form.querySelector('[data-template-width]');
            const heightInput = form.querySelector('[data-template-height]');
            const weightInput = form.querySelector('[data-template-weight]');
            const maxAmountInput = form.querySelector('[data-template-max-amount]');
            const clothToggle = form.querySelector('[data-template-is-cloth]');
            const bagWidthInput = form.querySelector('[data-template-bag-width]');
            const bagHeightInput = form.querySelector('[data-template-bag-height]');
            const fastWInput = form.querySelector('[data-template-fast-w]');
            const fastHInput = form.querySelector('[data-template-fast-h]');
            let searchTimer = null;
            updateClothBeltVisibility(form);
            if (form.dataset.issueByIdBound) return;
            form.dataset.issueByIdBound = 'true';
            const logIssueDebug = (message, payload) => {
                if (!DEBUG_INVENTORY) return;
                console.debug('[IssueById]', message, payload);
            };
            const refreshRandom = wireRandomDurability({
                randomButton: null,
                maxInput: max_durability_input,
                durabilityInput,
            });
            const clearResults = () => {
                if (!resultsBox) return;
                resultsBox.innerHTML = '';
                resultsBox.classList.remove('is-open');
            };
            const resolveTemplateFromInput = async () => {
                const templateId = parseNumber(templateInput?.value, 0);
                if (templateId) {
                    const loadedTemplate = await loadTemplate(templateId);
                    if (!loadedTemplate) {
                        return { ok: false, error: 'not_found' };
                    }
                    return { ok: true, id: templateId, name: loadedTemplate.name || '' };
                }
                const query = searchInput?.value?.trim() || '';
                if (!query) {
                    return { ok: false, error: 'missing_definition' };
                }
                const response = await fetch(
                    `/api/master/item_template/search?lobby_id=${encodeURIComponent(lobbyId)}&q=${encodeURIComponent(query)}`,
                );
                if (!response.ok) {
                    return { ok: false, error: 'not_found' };
                }
                const payload = await response.json().catch(() => ({}));
                const results = Array.isArray(payload.results) ? payload.results : [];
                const queryLower = query.toLowerCase();
                const matched = results.find((result) => (
                    `${result.id}` === query || `${result.id}` === queryLower
                    || `${result.name || ''}`.toLowerCase() === queryLower
                ));
                const resolved = matched || (results.length === 1 ? results[0] : null);
                if (!resolved) {
                    return { ok: false, error: 'not_found' };
                }
                if (templateInput) templateInput.value = `${resolved.id}`;
                if (searchInput && resolved.name) searchInput.value = resolved.name;
                const loadedTemplate = await loadTemplate(resolved.id);
                if (!loadedTemplate) {
                    return { ok: false, error: 'not_found' };
                }
                return { ok: true, id: resolved.id, name: loadedTemplate.name || '' };
            };
            const applyTemplate = (template) => {
                if (!template) return;
                console.debug('[GiveID] Template payload', template);
                if (nameInput) nameInput.value = template.name || '';
                if (descriptionInput) descriptionInput.value = template.description || '';
                if (typeInput) typeInput.value = template.type || 'other';
                if (qualityInput) qualityInput.value = template.quality || 'common';
                if (widthInput) widthInput.value = `${template.width || 1}`;
                if (heightInput) heightInput.value = `${template.height || 1}`;
                if (weightInput) weightInput.value = `${template.weight || 0}`;
                if (max_durability_input) max_durability_input.value = template.max_durability ?? '';
                if (maxAmountInput) maxAmountInput.value = `${template.max_amount || 1}`;
                if (clothToggle) clothToggle.checked = Boolean(template.is_cloth);
                if (bagWidthInput) bagWidthInput.value = `${template.bag_width || 0}`;
                if (bagHeightInput) bagHeightInput.value = `${template.bag_height || 0}`;
                if (fastWInput) fastWInput.value = `${template.fast_w || 0}`;
                if (fastHInput) fastHInput.value = `${template.fast_h || 0}`;
                if (imageInput) imageInput.value = template.image || '';
                if (imagePreview && imageEmpty) {
                    if (template.image) {
                        imagePreview.src = `/static/${template.image}`;
                        imagePreview.style.display = 'block';
                        imageEmpty.style.display = 'none';
                    } else {
                        imagePreview.removeAttribute('src');
                        imagePreview.style.display = 'none';
                        imageEmpty.style.display = 'block';
                    }
                }
                updateClothBeltVisibility(form);
                console.debug('[GiveID] Template applied', {
                    id: templateInput?.value || '',
                    name: nameInput?.value || '',
                    description: descriptionInput?.value || '',
                    type: typeInput?.value || '',
                    quality: qualityInput?.value || '',
                    width: widthInput?.value || '',
                    height: heightInput?.value || '',
                    weight: weightInput?.value || '',
                    max_durability: max_durability_input?.value ?? '',
                    max_amount: maxAmountInput?.value || '',
                    is_cloth: clothToggle?.checked || false,
                    bag_width: bagWidthInput?.value || '',
                    bag_height: bagHeightInput?.value || '',
                    fast_w: fastWInput?.value || '',
                    fast_h: fastHInput?.value || '',
                    image: imageInput?.value || '',
                });
            };
            const loadTemplate = async (templateId) => {
                if (!templateId) return;
                const response = await fetch(
                    `/api/master/item_template/${templateId}?lobby_id=${encodeURIComponent(lobbyId || '')}`,
                );
                if (!response.ok) return null;
                const payload = await response.json().catch(() => ({}));
                const template = payload.template;
                if (!template) return null;
                applyTemplate(template);
                refreshRandom();
                return template;
            };
            const renderResults = (results) => {
                if (!resultsBox) return;
                resultsBox.innerHTML = '';
                if (!results.length) {
                    resultsBox.innerHTML = '<div class="issue-search__meta">Нічого не знайдено.</div>';
                    resultsBox.classList.add('is-open');
                    return;
                }
                results.forEach((result) => {
                    const buttonEl = document.createElement('button');
                    buttonEl.type = 'button';
                    buttonEl.className = 'issue-search__result';
                    buttonEl.innerHTML = `
                        <strong>${result.name}</strong>
                        <div class="issue-search__meta">
                            <span>${result.type || 'other'}</span>
                            <span>${result.quality}</span>
                            <span>#${result.id}</span>
                        </div>
                    `;
                    buttonEl.addEventListener('click', () => {
                        if (templateInput) templateInput.value = `${result.id}`;
                        if (searchInput) searchInput.value = result.name;
                        loadTemplate(result.id);
                        clearResults();
                    });
                    resultsBox.appendChild(buttonEl);
                });
                resultsBox.classList.add('is-open');
            };
            const runSearch = async (query) => {
                if (!query) {
                    clearResults();
                    return;
                }
                const response = await fetch(
                    `/api/master/item_template/search?lobby_id=${encodeURIComponent(lobbyId)}&q=${encodeURIComponent(query)}`,
                );
                if (!response.ok) {
                    clearResults();
                    return;
                }
                const payload = await response.json().catch(() => ({}));
                const results = Array.isArray(payload.results) ? payload.results : [];
                if (searchInput && searchInput.value.trim() !== query) {
                    return;
                }
                renderResults(results);
            };
            searchInput?.addEventListener('input', () => {
                const query = searchInput.value.trim();
                if (searchTimer) {
                    window.clearTimeout(searchTimer);
                }
                searchTimer = window.setTimeout(() => {
                    runSearch(query);
                }, 200);
            });
            templateInput?.addEventListener('change', async () => {
                const templateId = parseNumber(templateInput.value, 0);
                if (!templateId) return;
                await loadTemplate(templateId);
            });
            searchInput?.addEventListener('blur', async () => {
                if (!templateInput?.value) {
                    await resolveTemplateFromInput();
                }
            });
            document.addEventListener('click', (event) => {
                if (!resultsBox || !searchInput) return;
                if (!form.contains(event.target)) {
                    clearResults();
                }
            });
            const submitIssue = async (event) => {
                event?.preventDefault();
                logIssueDebug('issue click', { lobbyId });
                const templateResult = await resolveTemplateFromInput();
                if (!templateResult.ok) {
                    controller.showIssueByIdError({ error: templateResult.error });
                    return;
                }
                const definitionId = templateResult.id;
                const targetId = Number.parseInt(
                    form.querySelector('select[id^="issue_target_"]')?.value || '0',
                    10,
                );
                const amount = Number.parseInt(
                    form.querySelector('input[id^="issue_amount_"]')?.value || '1',
                    10,
                );
                const durabilityRaw = form.querySelector('input[id^="issue_durability_current_"]')?.value ?? '';
                const durabilityCurrent = durabilityRaw === '' ? null : durabilityRaw;
                if (!definitionId || !targetId) {
                    logIssueDebug('issue validation failed', { definitionId, targetId });
                    return;
                }
                if (Number.isNaN(amount) || amount < 1) {
                    controller.showIssueByIdError({ error: 'invalid_amount' });
                    return;
                }
                const templateLabel = templateResult.name ? `${templateResult.name} (#${definitionId})` : `#${definitionId}`;
                const confirmed = window.confirm(`Видати шаблон ${templateLabel} для користувача ${targetId}?`);
                if (!confirmed) {
                    logIssueDebug('issue cancelled', { definitionId, targetId });
                    return;
                }
                controller.trackAction(`issue-by-id:${definitionId}:${targetId}`);
                logIssueDebug('issue fetch', { definitionId, targetId, amount });
                console.debug('GiveID fetch payload', {
                    lobby_id: lobbyId,
                    definition_id: definitionId,
                    definition_name: templateInput?.value ? '' : searchInput?.value?.trim(),
                    target_user_id: targetId,
                    amount,
                    durability_current: durabilityCurrent,
                });
                console.log('GiveID fetch starting', { definitionId, targetId, amount });
                let response;
                try {
                    response = await fetch(`/api/lobby/${lobbyId}/master/give-id`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            lobby_id: lobbyId,
                            definition_id: definitionId,
                            definition_name: templateInput?.value ? '' : searchInput?.value?.trim(),
                            target_user_id: targetId,
                            amount,
                            durability_current: durabilityCurrent,
                        }),
                    });
                    console.log('GiveID fetch completed', { status: response.status });
                } catch (error) {
                    console.log('GiveID fetch failed', error);
                    throw error;
                }
                const responsePayload = await response.clone().json().catch(() => null);
                logIssueDebug('issue response', {
                    ok: response.ok,
                    status: response.status,
                    request_id: responsePayload?.request_id || null,
                });
                console.debug('GiveID response', responsePayload);
                if (response.ok) {
                    await controller.refreshInventory(controller.selectedPlayerId);
                    return;
                }
                const payload = responsePayload || await response.json().catch(() => ({}));
                controller.showIssueByIdError(payload);
                await controller.refreshInventory(controller.selectedPlayerId);
            };
            button?.addEventListener('click', submitIssue);
            form.addEventListener('submit', submitIssue);
        });

        root.querySelectorAll('[data-master-settings]').forEach((form) => {
            if (form.dataset.settingsBound) return;
            form.dataset.settingsBound = 'true';
            const searchInput = form.querySelector('[data-template-search]');
            const resultsBox = form.querySelector('[data-template-results]');
            const searchIdInput = form.querySelector('[data-template-search-id]');
            const loadButton = form.querySelector('[data-template-load]');
            const originalIdInput = form.querySelector('[data-template-original-id]');
            const templateIdInput = form.querySelector('[data-template-id]');
            const nameInput = form.querySelector('[data-template-name]');
            const descriptionInput = form.querySelector('[data-template-description]');
            const typeSelect = form.querySelector('[data-template-type]');
            const qualitySelect = form.querySelector('[data-template-quality]');
            const widthInput = form.querySelector('[data-template-width]');
            const heightInput = form.querySelector('[data-template-height]');
            const weightInput = form.querySelector('[data-template-weight]');
            const max_durability_input = form.querySelector('[data-template-max-durability]');
            const maxAmountInput = form.querySelector('[data-template-max-amount]');
            const clothToggle = form.querySelector('[data-template-is-cloth]');
            const bagWidthInput = form.querySelector('[data-template-bag-width]');
            const bagHeightInput = form.querySelector('[data-template-bag-height]');
            const fastWInput = form.querySelector('[data-template-fast-w]');
            const fastHInput = form.querySelector('[data-template-fast-h]');
            const ammoTypeInput = form.querySelector('[data-template-ammo-type]');
            const saveButton = form.querySelector('[data-template-save]');
            const statusLine = form.querySelector('[data-template-status]');
            let searchTimer = null;
            updateAmmoVisibility(form);
            updateWeaponDurabilityRequirement(form);

            const clearResults = () => {
                if (!resultsBox) return;
                resultsBox.innerHTML = '';
                resultsBox.classList.remove('is-open');
            };
            const applyTemplate = (template) => {
                if (!template) return;
                console.debug('[Settings] Template payload', template);
                if (originalIdInput) originalIdInput.value = `${template.id}`;
                if (templateIdInput) templateIdInput.value = `${template.id}`;
                if (nameInput) nameInput.value = template.name || '';
                if (descriptionInput) descriptionInput.value = template.description || '';
                if (typeSelect) typeSelect.value = template.type || 'other';
                if (qualitySelect) qualitySelect.value = template.quality || 'common';
                if (widthInput) widthInput.value = `${template.width || 1}`;
                if (heightInput) heightInput.value = `${template.height || 1}`;
                if (weightInput) weightInput.value = `${template.weight || 0}`;
                if (max_durability_input) max_durability_input.value = template.max_durability ?? '';
                if (maxAmountInput) maxAmountInput.value = `${template.max_amount || 1}`;
                if (clothToggle) clothToggle.checked = Boolean(template.is_cloth);
                if (bagWidthInput) bagWidthInput.value = `${template.bag_width || 0}`;
                if (bagHeightInput) bagHeightInput.value = `${template.bag_height || 0}`;
                if (fastWInput) fastWInput.value = `${template.fast_w || 0}`;
                if (fastHInput) fastHInput.value = `${template.fast_h || 0}`;
                if (ammoTypeInput) ammoTypeInput.value = template.ammo_type || '';
                updateClothBeltVisibility(form);
                updateAmmoVisibility(form);
                updateWeaponDurabilityRequirement(form);
                if (statusLine) statusLine.textContent = '';
                console.debug('[Settings] Template applied', {
                    id: templateIdInput?.value || '',
                    name: nameInput?.value || '',
                    description: descriptionInput?.value || '',
                    type: typeSelect?.value || '',
                    quality: qualitySelect?.value || '',
                    width: widthInput?.value || '',
                    height: heightInput?.value || '',
                    weight: weightInput?.value || '',
                    max_durability: max_durability_input?.value ?? '',
                    max_amount: maxAmountInput?.value || '',
                    is_cloth: clothToggle?.checked || false,
                    bag_width: bagWidthInput?.value || '',
                    bag_height: bagHeightInput?.value || '',
                    fast_w: fastWInput?.value || '',
                    fast_h: fastHInput?.value || '',
                    ammo_type: ammoTypeInput?.value || '',
                });
            };
            const loadTemplate = async (templateId) => {
                if (!templateId) return;
                const response = await fetch(
                    `/api/master/item_template/${templateId}?lobby_id=${encodeURIComponent(lobbyId || '')}`,
                );
                if (!response.ok) {
                    if (statusLine) statusLine.textContent = 'Не вдалося знайти шаблон.';
                    return;
                }
                const payload = await response.json().catch(() => ({}));
                applyTemplate(payload.template);
            };

            const renderResults = (results) => {
                if (!resultsBox) return;
                resultsBox.innerHTML = '';
                if (!results.length) {
                    resultsBox.innerHTML = '<div class="issue-search__meta">Нічого не знайдено.</div>';
                    resultsBox.classList.add('is-open');
                    return;
                }
                results.forEach((result) => {
                    const buttonEl = document.createElement('button');
                    buttonEl.type = 'button';
                    buttonEl.className = 'issue-search__result';
                    buttonEl.innerHTML = `
                        <strong>${result.name}</strong>
                        <div class="issue-search__meta">
                            <span>${result.type || 'other'}</span>
                            <span>${result.quality}</span>
                            <span>#${result.id}</span>
                        </div>
                    `;
                    buttonEl.addEventListener('click', () => {
                        if (searchInput) searchInput.value = result.name;
                        clearResults();
                        loadTemplate(result.id);
                    });
                    resultsBox.appendChild(buttonEl);
                });
                resultsBox.classList.add('is-open');
            };

            const runSearch = async (query) => {
                if (!query) {
                    clearResults();
                    return;
                }
                const response = await fetch(
                    `/api/master/item_template/search?lobby_id=${encodeURIComponent(lobbyId || '')}&q=${encodeURIComponent(query)}`,
                );
                if (!response.ok) {
                    clearResults();
                    return;
                }
                const payload = await response.json().catch(() => ({}));
                const results = Array.isArray(payload.results) ? payload.results : [];
                if (searchInput && searchInput.value.trim() !== query) {
                    return;
                }
                renderResults(results);
            };

            searchInput?.addEventListener('input', () => {
                const query = searchInput.value.trim();
                if (searchTimer) {
                    window.clearTimeout(searchTimer);
                }
                searchTimer = window.setTimeout(() => {
                    runSearch(query);
                }, 200);
            });
            loadButton?.addEventListener('click', () => {
                const templateId = parseNumber(searchIdInput?.value || '', 0);
                loadTemplate(templateId);
            });
            searchIdInput?.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                const templateId = parseNumber(searchIdInput?.value || '', 0);
                loadTemplate(templateId);
            });
            document.addEventListener('click', (event) => {
                if (!resultsBox || !searchInput) return;
                if (!form.contains(event.target)) {
                    clearResults();
                }
            });
            typeSelect?.addEventListener('change', () => {
                updateClothBeltVisibility(form);
                updateAmmoVisibility(form);
                updateWeaponDurabilityRequirement(form);
            });
            clothToggle?.addEventListener('change', () => {
                updateClothBeltVisibility(form);
            });

            saveButton?.addEventListener('click', async () => {
                const templateId = parseNumber(originalIdInput?.value || '', 0);
                const newId = parseNumber(templateIdInput?.value || '', 0);
                if (!templateId || !newId) {
                    if (statusLine) statusLine.textContent = 'Вкажіть ID шаблону.';
                    return;
                }
                const typeValue = typeSelect?.value || 'other';
                const isCloth = Boolean(clothToggle?.checked) || typeValue === 'cloth' || typeValue === 'belt';
                const isBelt = typeValue === 'belt';
                const bagWidthValue = parseNumber(bagWidthInput?.value || '0', 0);
                const bagHeightValue = parseNumber(bagHeightInput?.value || '0', 0);
                const fastWValue = parseNumber(fastWInput?.value || '0', 0);
                const fastHValue = parseNumber(fastHInput?.value || '0', 0);
                const payload = {
                    lobby_id: lobbyId,
                    template_id: templateId,
                    new_id: newId,
                    name: nameInput?.value?.trim() || '',
                    description: descriptionInput?.value?.trim() || '',
                    type: typeValue,
                    quality: qualitySelect?.value || 'common',
                    width: parseNumber(widthInput?.value || '1', 1),
                    height: parseNumber(heightInput?.value || '1', 1),
                    weight: parseFloat(weightInput?.value || '0') || 0,
                    max_durability: parseNumber(max_durability_input?.value || '1', 1),
                    max_amount: parseNumber(maxAmountInput?.value || '1', 1),
                    is_cloth: isCloth ? '1' : '0',
                    bag_width: isCloth ? bagWidthValue : 0,
                    bag_height: isCloth ? bagHeightValue : 0,
                    fast_w: isBelt ? fastWValue : 0,
                    fast_h: isBelt ? fastHValue : 0,
                    ammo_type: ammoTypeInput?.value?.trim() || '',
                };
                if (payload.type === 'weapon' && (!Number.isFinite(payload.max_durability) || payload.max_durability < 1)) {
                    if (statusLine) statusLine.textContent = 'Weapon max durability must be at least 1.';
                    return;
                }
                if (payload.type === 'ammo' && !payload.ammo_type) {
                    if (statusLine) statusLine.textContent = 'Ammo type is required for ammo items.';
                    return;
                }
                if (isCloth && (bagWidthValue < 1 || bagHeightValue < 1)) {
                    if (statusLine) statusLine.textContent = 'Bag width and height must be at least 1 for cloth items.';
                    return;
                }
                if (isBelt && (fastWValue < 1 || fastHValue < 1)) {
                    if (statusLine) statusLine.textContent = 'Fast slot width and height must be at least 1 for belts.';
                    return;
                }
                const response = await fetch('/api/master/item_template/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                const responsePayload = await response.json().catch(() => ({}));
                if (response.ok) {
                    if (statusLine) {
                        statusLine.textContent = responsePayload.warning
                            ? 'Шаблон збережено. Частину предметів не вдалося розмістити.'
                            : 'Шаблон збережено.';
                    }
                    if (originalIdInput) originalIdInput.value = `${responsePayload.template_id || newId}`;
                    await controller.refreshInventory(controller.selectedPlayerId);
                    return;
                }
                if (statusLine) {
                    statusLine.textContent = responsePayload.error === 'duplicate_id'
                        ? 'ID вже існує. Оберіть інший.'
                        : 'Не вдалося зберегти шаблон.';
                }
            });
        });

        root.querySelectorAll('[data-master-image-update]').forEach((form) => {
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
