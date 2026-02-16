(() => {
    const SKILL_CHECK_TIME_LIMIT = 30;
    const DEBUG_SKILL_CHECK = String(window.DEBUG_SKILL_CHECK || '') === '1';
    const statGroups = document.querySelectorAll('[data-stat-group]');
    const statInputs = Array.from(document.querySelectorAll('[data-stat-key]'));
    if (statGroups.length) {
        const lobbyId = statGroups[0]?.dataset.lobbyId || 'default';
        const storagePrefix = `dra_lobby_stats_${lobbyId}_`;
        const artStorageKey = `dra_lobby_character_art_${lobbyId}`;

        const syncStatInputs = (key, value) => {
            statInputs
                .filter((input) => input.dataset.statKey === key)
                .forEach((input) => {
                    if (input.value !== value) {
                        input.value = value;
                    }
                });
        };

        statInputs.forEach((input) => {
            const key = input.dataset.statKey;
            const storedValue = localStorage.getItem(`${storagePrefix}${key}`);
            if (storedValue !== null) {
                input.value = storedValue;
            }

            input.addEventListener('input', () => {
                localStorage.setItem(`${storagePrefix}${key}`, input.value);
                syncStatInputs(key, input.value);
            });
        });

        document.querySelectorAll('[data-character-art]').forEach((input) => {
            const previewId = input.id.replace('character_art_', 'character-art-preview-');
            const placeholderId = input.id.replace('character_art_', 'character-art-placeholder-');
            const preview = document.getElementById(previewId);
            const placeholder = document.getElementById(placeholderId);

            const storedArt = localStorage.getItem(artStorageKey);
            if (storedArt && preview) {
                preview.src = storedArt;
                preview.classList.remove('is-hidden');
                placeholder?.classList.add('is-hidden');
            }

            input.addEventListener('change', (event) => {
                const [file] = event.target.files || [];
                if (!file || !preview) return;
                const reader = new FileReader();
                reader.onload = () => {
                    if (typeof reader.result === 'string') {
                        preview.src = reader.result;
                        preview.classList.remove('is-hidden');
                        placeholder?.classList.add('is-hidden');
                        localStorage.setItem(artStorageKey, reader.result);
                    }
                };
                reader.readAsDataURL(file);
            });
        });
    }

    class LobbyChat {
        constructor(root) {
            this.root = root;
            this.lobbyId = root.dataset.lobbyId;
            this.isMaster = root.dataset.isMaster === 'true';
            this.messages = root.querySelector('[data-chat-messages]');
            this.form = root.querySelector('[data-chat-form]');
            this.input = root.querySelector('[data-chat-input]');
            this.sendButton = root.querySelector('[data-chat-send]');
            this.latestId = 0;
            this.pollInterval = 5000;
            this.pollTimer = null;
            this.bind();
            this.refresh();
            this.startPolling();
            this.bindShopStatus();
        }

        bind() {
            this.form?.addEventListener('submit', (event) => {
                event.preventDefault();
                this.submitMessage();
            });
            this.sendButton?.addEventListener('click', (event) => {
                event.preventDefault();
                this.submitMessage();
            });
            this.messages?.addEventListener('click', (event) => {
                const button = event.target?.closest('[data-shop-chat-action]');
                if (!button) return;
                if (!(button instanceof HTMLElement)) return;
                event.preventDefault();
                this.handleShopChatAction(button);
            });
        }

        bindShopStatus() {
            document.addEventListener('shop-status', (event) => {
                const lobbyId = event.detail?.lobbyId;
                if (!lobbyId || String(lobbyId) !== String(this.lobbyId)) return;
                this.updateShopControls(Boolean(event.detail?.active));
            });
        }

        getShopController() {
            if (!this.lobbyId) return null;
            return window.LOBBY_INVENTORY_CONTROLLERS?.[this.lobbyId] || null;
        }

        async handleShopChatAction(button) {
            const action = button.dataset.shopChatAction;
            if (!action) return;
            if (action === 'open') {
                const controller = this.getShopController();
                if (controller?.refreshShopStatus) {
                    await controller.refreshShopStatus();
                }
                controller?.openShopOverlay?.();
                return;
            }
            if (action === 'close') {
                if (!this.isMaster) return;
                const controller = this.getShopController();
                await controller?.stopShop?.();
            }
        }

        startPolling() {
            this.pollTimer = window.setInterval(() => this.refresh(), this.pollInterval);
        }

        async refresh() {
            if (!this.lobbyId || !this.messages) return;
            try {
                const response = await fetch(`/api/lobby/${this.lobbyId}/chat?after_id=${this.latestId}`);
                if (!response.ok) return;
                const data = await response.json().catch(() => ({}));
                const newMessages = Array.isArray(data.messages) ? data.messages : [];
                if (!newMessages.length) return;
                if (this.latestId === 0) {
                    this.messages.innerHTML = '';
                }
                newMessages.forEach((message) => this.appendMessage(message));
                this.latestId = data.latest_id || this.latestId;
                this.scrollToBottom();
            } catch (error) {
                console.debug('Chat refresh failed', error);
            }
        }

        async submitMessage() {
            if (!this.lobbyId || !this.input) return;
            const text = this.input.value.trim();
            if (!text) return;
            this.input.value = '';
            try {
                const response = await fetch(`/api/lobby/${this.lobbyId}/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: text }),
                });
                if (!response.ok) return;
                const data = await response.json().catch(() => ({}));
                const message = data?.message;
                if (!message || !this.messages) return;
                if (this.latestId === 0) {
                    this.messages.innerHTML = '';
                }
                this.appendMessage(message);
                this.latestId = Math.max(this.latestId, message.id || 0);
                this.scrollToBottom();
            } catch (error) {
                console.debug('Chat send failed', error);
            }
        }

        appendMessage(message) {
            if (!this.messages) return;
            const wrapper = document.createElement('div');
            wrapper.className = 'lobby-chat__message';
            if (message.is_system) {
                wrapper.classList.add('is-system');
            }
            const timestamp = message.created_at
                ? new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '';
            wrapper.innerHTML = `
                <div class="lobby-chat__meta">
                    <span>${message.sender || 'System'}</span>
                    <span>${timestamp}</span>
                </div>
                <p class="lobby-chat__text">${message.message}</p>
            `;
            if (!this.isMaster) {
                wrapper.querySelectorAll('[data-shop-master-only]').forEach((button) => button.remove());
            }
            this.messages.appendChild(wrapper);
        }

        scrollToBottom() {
            if (!this.messages) return;
            this.messages.scrollTop = this.messages.scrollHeight;
        }

        updateShopControls(isActive) {
            if (!this.messages) return;
            this.messages.querySelectorAll('[data-shop-chat-controls]').forEach((controls) => {
                if (!(controls instanceof HTMLElement)) return;
                controls.style.display = isActive ? '' : 'none';
            });
        }
    }

    document.querySelectorAll('[data-lobby-chat]').forEach((root) => {
        if (root.dataset.lobbyId) {
            new LobbyChat(root);
        }
    });

    const setupSuitToolbars = () => {
        document.querySelectorAll('[data-suit-toolbar]').forEach((toolbar) => {
            const suitButtons = Array.from(toolbar.querySelectorAll('[data-suit-button]'));
            const resetButton = toolbar.querySelector('[data-suit-reset]');

            const setButtonState = (button, isEnabled) => {
                button.disabled = !isEnabled;
                button.classList.toggle('suit-disabled', !isEnabled);
                button.setAttribute('aria-pressed', isEnabled ? 'true' : 'false');
                button.setAttribute('aria-disabled', isEnabled ? 'false' : 'true');
            };

            suitButtons.forEach((button) => {
                button.addEventListener('click', () => {
                    if (button.disabled) return;
                    setButtonState(button, false);
                });
            });

            resetButton?.addEventListener('click', () => {
                suitButtons.forEach((button) => setButtonState(button, true));
            });
        });
    };

    const setupSkillsLink = () => {
        document.querySelectorAll('[data-skills-link]').forEach((link) => {
            const openSkills = () => {
                const win = window.open('/skills', '_blank', 'noopener');
                if (win) {
                    win.opener = null;
                }
            };

            link.addEventListener('click', (event) => {
                event.preventDefault();
                openSkills();
            });

            link.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openSkills();
                }
            });
        });
    };

    const setupCollapsiblePanels = () => {
        document.querySelectorAll('[data-collapsible-panel]').forEach((panel) => {
            const toggle = panel.querySelector('[data-panel-toggle]');
            const body = panel.querySelector('[data-panel-body]');
            const panelKey = panel.dataset.collapsiblePanel || panel.dataset.lobbyId || 'default';
            const storageKey = `dra_panel_collapsed_${panelKey}`;
            const setCollapsed = (collapsed) => {
                panel.classList.toggle('is-collapsed', collapsed);
                toggle?.setAttribute('aria-expanded', String(!collapsed));
                toggle?.setAttribute('aria-pressed', String(collapsed));
                toggle && (toggle.textContent = collapsed ? '▸' : '▾');
                body?.setAttribute('aria-hidden', String(collapsed));
                localStorage.setItem(storageKey, collapsed ? '1' : '0');
            };
            const stored = localStorage.getItem(storageKey);
            setCollapsed(stored === '1');

            toggle?.addEventListener('click', () => {
                const isCollapsed = panel.classList.contains('is-collapsed');
                setCollapsed(!isCollapsed);
            });
        });
    };

    document.addEventListener('DOMContentLoaded', () => {
        setupSuitToolbars();
        setupSkillsLink();
        setupCollapsiblePanels();
    });

    class SkillCheckController {
        constructor(root) {
            this.root = root;
            this.lobbyId = root.dataset.lobbyId;
            this.isMaster = root.dataset.isMaster === 'true';
            this.overlay = document.querySelector(`[data-skill-check-overlay][data-lobby-id="${this.lobbyId}"]`);
            this.pendingPanel = this.overlay?.querySelector('[data-skill-check-pending]');
            this.activePanel = this.overlay?.querySelector('[data-skill-check-active]');
            this.acceptButton = this.overlay?.querySelector('[data-skill-check-accept]');
            this.closeButton = this.overlay?.querySelector('[data-skill-check-close]');
            this.timerDisplay = this.overlay?.querySelector('[data-skill-check-timer]');
            this.marker = this.overlay?.querySelector('[data-skill-check-marker]');
            this.successZone = this.overlay?.querySelector('[data-skill-check-success-zone]');
            this.progress = this.overlay?.querySelector('[data-skill-check-progress]');
            this.difficultyLabels = this.overlay?.querySelectorAll('[data-skill-check-difficulty]');
            this.current = null;
            this.pollTimer = null;
            this.rafId = null;
            this.phase = 0;
            this.position = 50;
            this.baseSpeed = 1;
            this.lastFrameAt = 0;
            this.attemptCooldownMs = 180;
            this.lastAttemptAt = 0;
            if (!this.overlay) {
                this.menu = null;
                return;
            }
            this.bind();
            this.menu = new SkillCheckMenu(this);
            this.refreshStatus();
            this.pollTimer = window.setInterval(() => this.refreshStatus(), 1500);
        }

        bind() {
            this.acceptButton?.addEventListener('click', () => this.acceptCheck());
            this.closeButton?.addEventListener('click', () => this.cancelAsFailure());
            this.activePanel?.addEventListener('click', (event) => {
                if (event.target?.closest('button, a, input, textarea, select')) return;
                this.sendHit();
            });
            document.addEventListener('keydown', (event) => {
                if (!this.isOpen()) return;
                if (event.code === 'Escape') {
                    event.preventDefault();
                    this.cancelAsFailure();
                }
                if (event.code === 'Space') {
                    event.preventDefault();
                    if (event.repeat) return;
                    this.sendHit();
                }
            });
        }

        isOpen() {
            return this.overlay?.classList.contains('is-open');
        }

        async refreshStatus() {
            if (!this.lobbyId) return;
            try {
                const response = await fetch(`/api/lobby/${this.lobbyId}/skill-check/status`);
                if (!response.ok) return;
                const data = await response.json().catch(() => ({}));
                this.renderStatus(data?.check || null);
            } catch (error) {
                console.debug('Skill check status failed', error);
            }
        }

        renderStatus(check) {
            const isMine = Boolean(check && Number(check.target_user_id) === Number(window.CURRENT_USER_ID));
            if (!isMine) {
                this.stopRun();
                this.hideOverlay();
                this.current = null;
                return;
            }
            this.current = check;
            this.openOverlay();
            this.renderDifficulty(check.difficulty);
            this.renderProgress(check);
            if (check.status === 'pending') {
                this.pendingPanel?.classList.remove('is-hidden');
                this.activePanel?.classList.add('is-hidden');
                this.stopRun();
                this.renderTimer(check.pending_until);
                return;
            }
            if (check.status === 'active') {
                this.pendingPanel?.classList.add('is-hidden');
                this.activePanel?.classList.remove('is-hidden');
                this.renderTimer(check.expires_at);
                this.renderSuccessZone(check.difficulty);
                this.startRun(check.difficulty);
                return;
            }
            this.stopRun();
            this.hideOverlay();
        }

        openOverlay() {
            this.overlay?.classList.add('is-open');
            this.overlay?.setAttribute('aria-hidden', 'false');
            document.body.classList.add('skill-check-lock');
        }

        hideOverlay() {
            this.overlay?.classList.remove('is-open');
            this.overlay?.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('skill-check-lock');
        }

        renderDifficulty(difficulty) {
            this.difficultyLabels?.forEach((node) => {
                node.textContent = String(difficulty ?? '—');
            });
        }

        renderProgress(check) {
            if (!this.progress) return;
            const s = Number(check?.successes || 0);
            const f = Number(check?.failures || 0);
            const need = Number(check?.required_successes || 0);
            const maxf = Number(check?.max_failures || 0);
            this.progress.textContent = `${s}/${need} · ❌ ${f}/${maxf}`;
        }

        renderTimer(isoDeadline) {
            if (!this.timerDisplay) return;
            if (!isoDeadline) {
                this.timerDisplay.textContent = `${SKILL_CHECK_TIME_LIMIT}`;
                return;
            }
            const ms = new Date(isoDeadline).getTime() - Date.now();
            const sec = Math.max(0, Math.ceil(ms / 1000));
            this.timerDisplay.textContent = `${sec}`;
        }

        renderSuccessZone(difficulty) {
            if (!this.successZone) return;
            const normalized = Math.min(30, Math.max(5, Number(difficulty) || 10));
            const width = 26 - (normalized - 5) * 0.72;
            this.successZone.style.width = `${Math.max(8, Math.min(26, width)).toFixed(1)}%`;
        }

        startRun(difficulty) {
            if (this.rafId) return;
            this.baseSpeed = 1 + (Math.min(30, Math.max(5, Number(difficulty) || 10)) - 5) / 22;
            this.lastFrameAt = performance.now();
            const tick = (ts) => {
                if (!this.current || this.current.status !== 'active') {
                    this.stopRun();
                    return;
                }
                const delta = Math.min(0.1, (ts - this.lastFrameAt) / 1000);
                this.lastFrameAt = ts;
                this.phase += delta * this.baseSpeed * 2.4;
                const wave = (Math.sin(this.phase) + 1) / 2;
                this.position = wave * 100;
                if (this.marker) {
                    this.marker.style.left = `${this.position.toFixed(2)}%`;
                }
                this.renderTimer(this.current.expires_at);
                this.rafId = window.requestAnimationFrame(tick);
            };
            this.rafId = window.requestAnimationFrame(tick);
        }

        stopRun() {
            if (!this.rafId) return;
            window.cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        async acceptCheck() {
            if (!this.lobbyId) return;
            try {
                const response = await fetch(`/api/lobby/${this.lobbyId}/skill-check/accept`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                });
                if (!response.ok) return;
                const data = await response.json().catch(() => ({}));
                this.renderStatus(data?.check || null);
            } catch (error) {
                console.debug('Skill check accept failed', error);
            }
        }

        async sendHit() {
            if (!this.current || this.current.status !== 'active') return;
            const now = performance.now();
            if (now - this.lastAttemptAt < this.attemptCooldownMs) return;
            this.lastAttemptAt = now;
            const zoneWidth = parseFloat(this.successZone?.style.width || '0') || 0;
            const hit = this.position <= zoneWidth;
            try {
                const response = await fetch(`/api/lobby/${this.lobbyId}/skill-check/result`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hit }),
                });
                if (!response.ok) {
                    await this.refreshStatus();
                    return;
                }
                const data = await response.json().catch(() => ({}));
                if (data?.check) {
                    this.renderStatus(data.check);
                    return;
                }
                await this.refreshStatus();
            } catch (error) {
                console.debug('Skill check hit failed', error);
            }
        }

        async cancelAsFailure() {
            if (!this.current || this.current.status !== 'active') {
                this.hideOverlay();
                return;
            }
            try {
                await fetch(`/api/lobby/${this.lobbyId}/skill-check/result`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hit: false }),
                });
            } catch (error) {
                console.debug('Skill check cancel failed', error);
            }
            await this.refreshStatus();
        }

        async startSkillCheck(targetId, difficulty, onStatus) {
            if (!this.isMaster || !this.lobbyId) return;
            onStatus?.('Надсилаємо запит...');
            try {
                const response = await fetch(`/api/lobby/${this.lobbyId}/skill-check/start`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ target_user_id: targetId, difficulty }),
                });
                if (!response.ok) {
                    onStatus?.('Не вдалося запустити перевірку.');
                    return;
                }
                onStatus?.('Запит відправлено.');
            } catch (error) {
                console.debug('Skill check start failed', error);
                onStatus?.('Помилка запуску.');
            }
        }
    }

    class SkillCheckMenu {
        constructor(controller) {
            this.controller = controller;
            this.lobbyId = controller.lobbyId;
            this.isMaster = controller.isMaster;
            this.menu = document.querySelector(`[data-skill-check-menu][data-lobby-id="${this.lobbyId}"]`);
            this.rosterList = document.querySelector(`.lobby-roster__list[data-lobby-id="${this.lobbyId}"]`);
            this.targetLabel = this.menu?.querySelector('[data-skill-check-menu-target]');
            this.difficultyInput = this.menu?.querySelector('[data-skill-check-menu-difficulty]');
            this.startButton = this.menu?.querySelector('[data-skill-check-menu-start]');
            this.closeButton = this.menu?.querySelector('[data-skill-check-menu-close]');
            this.statusLabel = this.menu?.querySelector('[data-skill-check-menu-status]');
            this.targetUserId = null;
            if (this.menu && this.rosterList && this.isMaster) {
                this.bind();
            }
        }

        bind() {
            this.rosterList.addEventListener('contextmenu', (event) => {
                const card = event.target.closest('.roster-card');
                if (!card) return;
                event.preventDefault();
                this.targetUserId = card.dataset.playerId;
                this.targetLabel.textContent = card.dataset.playerName || '—';
                this.menu.style.left = `${event.clientX}px`;
                this.menu.style.top = `${event.clientY}px`;
                this.menu.classList.add('is-open');
                this.menu.setAttribute('aria-hidden', 'false');
                this.updateStatus('');
            });
            this.startButton?.addEventListener('click', () => this.start());
            this.closeButton?.addEventListener('click', () => this.close());
            document.addEventListener('mousedown', (event) => {
                if (!this.menu?.classList.contains('is-open')) return;
                if (!this.menu.contains(event.target)) this.close();
            });
            document.addEventListener('keydown', (event) => {
                if (event.code === 'Escape') this.close();
            });
        }

        close() {
            this.menu?.classList.remove('is-open');
            this.menu?.setAttribute('aria-hidden', 'true');
            this.updateStatus('');
            this.targetUserId = null;
        }

        updateStatus(text) {
            if (this.statusLabel) this.statusLabel.textContent = text;
        }

        async start() {
            if (!this.targetUserId) {
                this.updateStatus('Оберіть ціль.');
                return;
            }
            const difficulty = Math.max(5, Math.min(30, Number(this.difficultyInput?.value || 10)));
            if (this.difficultyInput) this.difficultyInput.value = String(difficulty);
            await this.controller.startSkillCheck(this.targetUserId, difficulty, (text) => this.updateStatus(text));
        }
    }

    const skillRoots = document.querySelectorAll('[data-inventory-root][data-lobby-id]');
    skillRoots.forEach((root) => {
        new SkillCheckController(root);
    });
})();
