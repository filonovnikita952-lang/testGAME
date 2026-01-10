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
            this.messages.appendChild(wrapper);
        }

        scrollToBottom() {
            if (!this.messages) return;
            this.messages.scrollTop = this.messages.scrollHeight;
        }
    }

    document.querySelectorAll('[data-lobby-chat]').forEach((root) => {
        if (root.dataset.lobbyId) {
            new LobbyChat(root);
        }
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
            this.pointer = this.overlay?.querySelector('[data-skill-check-pointer]');
            this.wheel = this.overlay?.querySelector('[data-skill-check-wheel]');
            this.progress = this.overlay?.querySelector('[data-skill-check-progress]');
            this.difficultyLabels = this.overlay?.querySelectorAll('[data-skill-check-difficulty]');
            this.pollInterval = 2000;
            this.pollTimer = null;
            this.animationFrame = null;
            this.isRunning = false;
            this.currentCheckId = null;
            this.state = 'idle';
            this.lastCheckSignature = null;
            this.isBound = false;
            this.successes = 0;
            this.failures = 0;
            this.speed = 0;
            this.angle = 0;
            this.direction = 1;
            this.reverseUntil = 0;
            this.lastFrameTime = 0;
            this.deadline = null;
            this.resultSent = false;
            this.currentDifficulty = null;
            this.attemptCooldown = 350;
            this.lastAttemptAt = 0;
            this.lastLoggedRemaining = null;
            this.wasReloaded = performance.getEntriesByType('navigation')[0]?.type === 'reload';
            if (this.overlay) {
                this.bind();
                this.refresh();
                this.startPolling();
            }
            this.menu = new SkillCheckMenu(this);
        }

        bind() {
            if (this.isBound) return;
            this.isBound = true;
            this.acceptButton?.addEventListener('click', () => this.accept());
            this.closeButton?.addEventListener('click', () => this.failAndClose(false));
            this.activePanel?.addEventListener('click', (event) => {
                if (this.state !== 'running') return;
                if (event.target?.closest('button, input, textarea, select, a')) return;
                this.handleAttempt();
            });
            document.addEventListener('keydown', (event) => this.handleKey(event));
            window.addEventListener('beforeunload', () => this.handleUnload());
        }

        startPolling() {
            if (this.pollTimer) return;
            this.pollTimer = window.setInterval(() => this.refresh(), this.pollInterval);
            this.debugLog('polling started', { interval: this.pollInterval });
        }

        async refresh() {
            if (!this.lobbyId) return;
            this.debugLog('poll', { lobbyId: this.lobbyId });
            try {
                const response = await fetch(`/api/lobby/${this.lobbyId}/skill-check/status`);
                if (!response.ok) return;
                const data = await response.json().catch(() => ({}));
                const check = data?.check;
                this.handleStatus(check || null);
            } catch (error) {
                console.debug('Skill check refresh failed', error);
            }
        }

        handleStatus(check) {
            const signature = check ? `${check.id}:${check.status}:${check.target_user_id}` : 'none';
            if (signature === this.lastCheckSignature) {
                return;
            }
            this.lastCheckSignature = signature;
            this.debugLog('status update', { signature, state: this.state });
            if (!check || check.target_user_id !== window.CURRENT_USER_ID) {
                if (this.state !== 'idle') {
                    this.closeOverlay('no-check');
                }
                return;
            }
            if (check.status === 'pending') {
                if (this.state === 'running') {
                    this.debugLog('ignoring pending while running', { checkId: check.id });
                    return;
                }
                if (this.state !== 'pending_accept' || this.currentCheckId !== check.id) {
                    this.showPending(check);
                }
                return;
            }
            if (check.status === 'active') {
                if (this.wasReloaded) {
                    this.wasReloaded = false;
                    this.handleReloadFailure();
                    return;
                }
                if (this.state !== 'running' || this.currentCheckId !== check.id) {
                    this.startGame(check);
                }
                return;
            }
            if (this.state !== 'idle') {
                this.closeOverlay('status-complete');
            }
        }

        openOverlay() {
            if (this.overlay?.classList.contains('is-open')) return;
            this.overlay?.classList.add('is-open');
            this.overlay?.setAttribute('aria-hidden', 'false');
            document.body.classList.add('skill-check-lock');
            this.debugLog('overlay open', { state: this.state });
        }

        closeOverlay(reason = 'close') {
            this.stopGameLoop();
            this.debugLog('overlay close', { state: this.state, reason });
            this.overlay?.classList.remove('is-open');
            this.overlay?.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('skill-check-lock');
            this.state = 'idle';
            this.currentCheckId = null;
            this.resultSent = false;
            this.currentDifficulty = null;
            this.lastCheckSignature = null;
        }

        updateDifficultyLabels(value) {
            this.difficultyLabels?.forEach((label) => {
                label.textContent = value;
            });
        }

        showPending(check) {
            this.setState('pending_accept', 'pending');
            this.currentCheckId = check.id;
            this.currentDifficulty = check.difficulty;
            this.openOverlay();
            this.pendingPanel?.classList.remove('is-hidden');
            this.activePanel?.classList.add('is-hidden');
            this.updateDifficultyLabels(check.difficulty);
            this.updateTimerDisplay(SKILL_CHECK_TIME_LIMIT);
            this.logState('pending', SKILL_CHECK_TIME_LIMIT);
        }

        async accept() {
            if (!this.lobbyId) return;
            this.debugLog('accept click', { state: this.state, checkId: this.currentCheckId });
            try {
                const response = await fetch(`/api/lobby/${this.lobbyId}/skill-check/accept`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                });
                if (!response.ok) return;
                const data = await response.json().catch(() => ({}));
                if (data?.check) {
                    this.startGame(data.check);
                }
            } catch (error) {
                console.debug('Skill check accept failed', error);
            }
        }

        startGame(check) {
            this.setState('running', 'start');
            this.currentCheckId = check.id;
            this.currentDifficulty = check.difficulty;
            this.openOverlay();
            this.pendingPanel?.classList.add('is-hidden');
            this.activePanel?.classList.remove('is-hidden');
            this.successes = 0;
            this.failures = 0;
            this.resultSent = false;
            this.speed = this.getBaseSpeed(check.difficulty);
            this.angle = 0;
            this.direction = 1;
            this.reverseUntil = 0;
            this.lastFrameTime = performance.now();
            this.deadline = check.expires_at
                ? new Date(check.expires_at).getTime()
                : Date.now() + SKILL_CHECK_TIME_LIMIT * 1000;
            this.lastLoggedRemaining = null;
            this.updateDifficultyLabels(check.difficulty);
            this.updateProgress();
            this.updateSuccessZone(check.difficulty);
            this.startGameLoop();
            this.logState('start', this.getRemainingSeconds());
        }

        startGameLoop() {
            if (this.isRunning) return;
            this.isRunning = true;
            const tick = (timestamp) => {
                if (!this.isRunning) return;
                const delta = (timestamp - this.lastFrameTime) / 1000;
                this.lastFrameTime = timestamp;
                this.updateWheel(delta);
                this.updateTimer();
                this.animationFrame = window.requestAnimationFrame(tick);
            };
            this.animationFrame = window.requestAnimationFrame(tick);
        }

        stopGameLoop() {
            this.isRunning = false;
            if (this.animationFrame) {
                window.cancelAnimationFrame(this.animationFrame);
                this.animationFrame = null;
            }
        }

        updateWheel(delta) {
            const now = performance.now();
            this.direction = now < this.reverseUntil ? -1 : 1;
            this.angle = (this.angle + this.direction * this.speed * delta) % 360;
            if (this.angle < 0) {
                this.angle += 360;
            }
            if (this.pointer) {
                this.pointer.style.transform = `translate(-50%, -100%) rotate(${this.angle}deg)`;
            }
        }

        updateTimer() {
            if (!this.deadline) return;
            const remaining = Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
            this.updateTimerDisplay(remaining);
            if (DEBUG_SKILL_CHECK && this.lastLoggedRemaining !== remaining) {
                this.lastLoggedRemaining = remaining;
                this.logState('tick', remaining);
            }
            if (remaining <= 0) {
                this.finish(false);
            }
        }

        updateTimerDisplay(value) {
            if (this.timerDisplay) {
                this.timerDisplay.textContent = `${value}`;
            }
        }

        updateProgress() {
            if (this.progress) {
                this.progress.textContent = `${this.successes}/3`;
            }
        }

        updateSuccessZone(difficulty) {
            if (!this.wheel) return;
            const fraction = this.getSuccessFraction(difficulty);
            const angle = Math.round(fraction * 360);
            this.wheel.style.setProperty('--success-angle', `${angle}deg`);
        }

        getSuccessFraction(difficulty) {
            if (difficulty <= 10) return 0.15;
            if (difficulty <= 15) return 0.1;
            if (difficulty <= 20) return 0.07;
            return 0.05;
        }

        getBaseSpeed(difficulty) {
            const base = 140 + (difficulty - 5) * 6;
            return Math.max(40, base);
        }

        handleKey(event) {
            if (!this.overlay?.classList.contains('is-open')) return;
            if (event.code === 'Escape') {
                event.preventDefault();
                this.failAndClose(false);
                return;
            }
            if (event.code === 'Space') {
                event.preventDefault();
                if (event.repeat) return;
                if (this.state !== 'running') return;
                this.handleAttempt();
            }
        }

        handleAttempt() {
            const now = performance.now();
            if (now - this.lastAttemptAt < this.attemptCooldown) return;
            this.lastAttemptAt = now;
            const successAngle = (this.getSuccessFraction(this.getCurrentDifficulty()) || 0) * 360;
            const isSuccess = this.angle <= successAngle;
            this.debugLog('attempt', { angle: Math.round(this.angle), insideZone: isSuccess });
            if (isSuccess) {
                this.successes += 1;
                this.speed = Math.max(10, this.speed * 1.1);
            } else {
                this.failures += 1;
            }
            this.reverseUntil = performance.now() + 200;
            this.updateProgress();
            if (this.successes >= 3) {
                this.finish(true);
            } else if (this.failures >= 3) {
                this.finish(false);
            }
        }

        getCurrentDifficulty() {
            return this.currentDifficulty || 10;
        }

        async finish(success) {
            if (this.resultSent) return;
            this.resultSent = true;
            this.stopGameLoop();
            await this.sendResult(success);
            this.closeOverlay(success ? 'success' : 'failure');
        }

        async handleReloadFailure() {
            if (this.resultSent) return;
            this.resultSent = true;
            this.debugLog('reload failure', { state: this.state });
            await this.sendResult(false);
            this.closeOverlay('reload-failure');
        }

        async sendResult(success) {
            if (!this.lobbyId) return;
            this.debugLog('sending result', { success, successes: this.successes, failures: this.failures });
            try {
                const response = await fetch(`/api/lobby/${this.lobbyId}/skill-check/result`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        success,
                        successes: this.successes,
                        failures: this.failures,
                    }),
                });
                this.debugLog('result response', { ok: response.ok, status: response.status });
            } catch (error) {
                this.debugLog('result error', { error });
                console.debug('Skill check result failed', error);
            }
        }

        async failAndClose(success) {
            if (this.state === 'idle') return;
            if (this.resultSent) return;
            this.resultSent = true;
            await this.sendResult(success);
            this.closeOverlay(success ? 'success' : 'failure');
        }

        handleUnload() {
            if (this.state !== 'running') return;
            const payload = JSON.stringify({
                success: false,
                successes: this.successes,
                failures: this.failures,
            });
            const url = `/api/lobby/${this.lobbyId}/skill-check/result`;
            if (navigator.sendBeacon) {
                navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
            } else {
                fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: payload,
                    keepalive: true,
                });
            }
        }

        getRemainingSeconds() {
            if (!this.deadline) return SKILL_CHECK_TIME_LIMIT;
            return Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
        }

        logState(context, remainingOverride) {
            if (!DEBUG_SKILL_CHECK) return;
            const remaining = remainingOverride ?? this.getRemainingSeconds();
            this.debugLog('state', {
                context,
                accepted: this.state === 'running',
                running: this.isRunning,
                successes: this.successes,
                failures: this.failures,
                timeLeft: remaining,
            });
        }

        setState(nextState, context) {
            if (this.state === nextState) return;
            this.state = nextState;
            this.debugLog('state change', { context, state: this.state });
        }

        debugLog(message, payload = {}) {
            if (!DEBUG_SKILL_CHECK) return;
            console.log('[SkillCheck]', message, payload);
        }

        async startSkillCheck(targetId, difficulty, onStatus) {
            if (!this.isMaster || !this.lobbyId) return;
            if (!targetId || Number.isNaN(difficulty)) {
                onStatus?.('Заповніть гравця та складність.');
                return;
            }
            onStatus?.('Надсилаємо запит...');
            try {
                const response = await fetch(`/api/lobby/${this.lobbyId}/skill-check/start`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ target_user_id: targetId, difficulty }),
                });
                if (!response.ok) {
                    if (response.status === 409) {
                        onStatus?.('Перевірка вже активна.');
                    } else if (response.status === 400) {
                        onStatus?.('Перевірте складність або гравця.');
                    } else {
                        onStatus?.('Не вдалося запустити.');
                    }
                    return;
                }
                onStatus?.('Очікуємо підтвердження гравця.');
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
            this.rosterList.addEventListener('contextmenu', (event) => this.handleContextMenu(event));
            this.startButton?.addEventListener('click', () => this.start());
            this.closeButton?.addEventListener('click', () => this.close());
            document.addEventListener('mousedown', (event) => this.handleDocumentClick(event));
            document.addEventListener('keydown', (event) => this.handleKey(event));
        }

        handleContextMenu(event) {
            const card = event.target.closest('.roster-card');
            if (!card) return;
            event.preventDefault();
            const targetId = card.dataset.playerId;
            const targetName = card.dataset.playerName || card.querySelector('summary span')?.textContent?.trim();
            this.open(targetId, targetName || '—', event.clientX, event.clientY);
        }

        open(targetId, targetName, x, y) {
            if (!this.menu) return;
            this.targetUserId = targetId;
            if (this.targetLabel) {
                this.targetLabel.textContent = targetName;
            }
            if (this.difficultyInput && !this.difficultyInput.value) {
                this.difficultyInput.value = '10';
            }
            this.menu.style.left = `${x}px`;
            this.menu.style.top = `${y}px`;
            this.menu.classList.add('is-open');
            this.menu.setAttribute('aria-hidden', 'false');
            this.updateStatus('');
            this.repositionWithinViewport();
        }

        repositionWithinViewport() {
            if (!this.menu) return;
            const rect = this.menu.getBoundingClientRect();
            const padding = 12;
            let nextLeft = rect.left;
            let nextTop = rect.top;
            if (rect.right > window.innerWidth - padding) {
                nextLeft = Math.max(padding, window.innerWidth - rect.width - padding);
            }
            if (rect.bottom > window.innerHeight - padding) {
                nextTop = Math.max(padding, window.innerHeight - rect.height - padding);
            }
            this.menu.style.left = `${nextLeft}px`;
            this.menu.style.top = `${nextTop}px`;
        }

        close() {
            if (!this.menu) return;
            this.menu.classList.remove('is-open');
            this.menu.setAttribute('aria-hidden', 'true');
            this.targetUserId = null;
            this.updateStatus('');
        }

        handleDocumentClick(event) {
            if (!this.menu?.classList.contains('is-open')) return;
            if (this.menu.contains(event.target)) return;
            this.close();
        }

        handleKey(event) {
            if (!this.menu?.classList.contains('is-open')) return;
            if (event.code === 'Escape') {
                event.preventDefault();
                this.close();
            }
        }

        updateStatus(text) {
            if (this.statusLabel) {
                this.statusLabel.textContent = text;
            }
        }

        async start() {
            if (!this.targetUserId) {
                this.updateStatus('Оберіть гравця.');
                return;
            }
            const difficultyRaw = Number(this.difficultyInput?.value || 0);
            if (Number.isNaN(difficultyRaw)) {
                this.updateStatus('Вкажіть складність.');
                return;
            }
            const difficulty = Math.min(30, Math.max(5, difficultyRaw));
            if (this.difficultyInput) {
                this.difficultyInput.value = `${difficulty}`;
            }
            await this.controller.startSkillCheck(this.targetUserId, difficulty, (text) => this.updateStatus(text));
            if (this.statusLabel?.textContent?.includes('Очікуємо')) {
                this.close();
            }
        }
    }

    const skillRoots = document.querySelectorAll('[data-inventory-root][data-lobby-id]');
    skillRoots.forEach((root) => {
        new SkillCheckController(root);
    });
})();
