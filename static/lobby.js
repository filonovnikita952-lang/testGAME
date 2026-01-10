(() => {
    const SKILL_CHECK_TIME_LIMIT = 30;
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
            this.form = document.querySelector(`[data-skill-check-form][data-lobby-id="${this.lobbyId}"]`);
            this.statusLabel = this.form?.querySelector('[data-skill-check-status]');
            this.targetInput = this.form?.querySelector('[data-skill-check-target]');
            this.difficultyInput = this.form?.querySelector('[data-skill-check-difficulty]');
            this.pollInterval = 2000;
            this.pollTimer = null;
            this.animationFrame = null;
            this.isRunning = false;
            this.currentCheckId = null;
            this.state = 'idle';
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
            if (this.overlay) {
                this.bind();
                this.refresh();
                this.startPolling();
            }
        }

        bind() {
            this.acceptButton?.addEventListener('click', () => this.accept());
            this.closeButton?.addEventListener('click', () => this.failAndClose('failure'));
            if (this.form) {
                this.form.addEventListener('submit', (event) => {
                    event.preventDefault();
                    this.startFromMaster();
                });
            }
            document.addEventListener('keydown', (event) => this.handleKey(event));
            window.addEventListener('beforeunload', () => this.handleUnload());
        }

        startPolling() {
            this.pollTimer = window.setInterval(() => this.refresh(), this.pollInterval);
        }

        async refresh() {
            if (!this.lobbyId) return;
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
            if (!check || check.target_user_id !== window.CURRENT_USER_ID) {
                if (this.state !== 'idle') {
                    this.closeOverlay();
                }
                return;
            }
            if (check.status === 'pending') {
                if (this.state !== 'pending' || this.currentCheckId !== check.id) {
                    this.showPending(check);
                }
                return;
            }
            if (check.status === 'active') {
                if (this.state !== 'active' || this.currentCheckId !== check.id) {
                    this.startGame(check);
                }
                return;
            }
            if (this.state !== 'idle') {
                this.closeOverlay();
            }
        }

        openOverlay() {
            this.overlay?.classList.add('is-open');
            this.overlay?.setAttribute('aria-hidden', 'false');
            document.body.classList.add('skill-check-lock');
        }

        closeOverlay() {
            this.stopGameLoop();
            this.overlay?.classList.remove('is-open');
            this.overlay?.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('skill-check-lock');
            this.state = 'idle';
            this.currentCheckId = null;
            this.resultSent = false;
            this.currentDifficulty = null;
        }

        updateDifficultyLabels(value) {
            this.difficultyLabels?.forEach((label) => {
                label.textContent = value;
            });
        }

        showPending(check) {
            this.state = 'pending';
            this.currentCheckId = check.id;
            this.currentDifficulty = check.difficulty;
            this.openOverlay();
            this.pendingPanel?.classList.remove('is-hidden');
            this.activePanel?.classList.add('is-hidden');
            this.updateDifficultyLabels(check.difficulty);
            this.updateTimerDisplay(SKILL_CHECK_TIME_LIMIT);
        }

        async accept() {
            if (!this.lobbyId) return;
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
            this.state = 'active';
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
            this.updateDifficultyLabels(check.difficulty);
            this.updateProgress();
            this.updateSuccessZone(check.difficulty);
            this.startGameLoop();
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
                this.failAndClose('failure');
                return;
            }
            if (event.code === 'Space') {
                event.preventDefault();
                if (event.repeat) return;
                if (this.state !== 'active') return;
                this.handleAttempt();
            }
        }

        handleAttempt() {
            const successAngle = (this.getSuccessFraction(this.getCurrentDifficulty()) || 0) * 360;
            const isSuccess = this.angle <= successAngle;
            if (isSuccess) {
                this.successes += 1;
                this.speed = Math.max(10, this.speed * 1.1);
            } else {
                this.failures += 1;
            }
            this.reverseUntil = performance.now() + 180;
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
            await this.sendResult(success ? 'success' : 'failure');
            this.closeOverlay();
        }

        async sendResult(result) {
            if (!this.lobbyId) return;
            try {
                await fetch(`/api/lobby/${this.lobbyId}/skill-check/result`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ result }),
                });
            } catch (error) {
                console.debug('Skill check result failed', error);
            }
        }

        async failAndClose(result) {
            if (this.state === 'idle') return;
            if (this.resultSent) return;
            this.resultSent = true;
            await this.sendResult(result);
            this.closeOverlay();
        }

        handleUnload() {
            if (this.state === 'idle') return;
            const payload = JSON.stringify({ result: 'failure' });
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

        async startFromMaster() {
            if (!this.isMaster || !this.lobbyId || !this.form) return;
            const targetId = this.targetInput?.value;
            const difficulty = Number(this.difficultyInput?.value || 0);
            if (!targetId || Number.isNaN(difficulty)) {
                this.updateStatus('Заповніть гравця та складність.');
                return;
            }
            this.updateStatus('Надсилаємо запит...');
            try {
                const response = await fetch(`/api/lobby/${this.lobbyId}/skill-check/start`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ target_user_id: targetId, difficulty }),
                });
                if (!response.ok) {
                    if (response.status === 409) {
                        this.updateStatus('Перевірка вже активна.');
                    } else if (response.status === 400) {
                        this.updateStatus('Перевірте складність або гравця.');
                    } else {
                        this.updateStatus('Не вдалося запустити.');
                    }
                    return;
                }
                this.updateStatus('Очікуємо підтвердження гравця.');
            } catch (error) {
                console.debug('Skill check start failed', error);
                this.updateStatus('Помилка запуску.');
            }
        }

        updateStatus(text) {
            if (this.statusLabel) {
                this.statusLabel.textContent = text;
            }
        }
    }

    const skillRoots = document.querySelectorAll('[data-inventory-root][data-lobby-id]');
    skillRoots.forEach((root) => {
        new SkillCheckController(root);
    });
})();
