(() => {
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
})();
