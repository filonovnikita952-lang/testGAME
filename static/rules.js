(() => {
    const rawCards = Array.isArray(window.RULES_DATA) ? window.RULES_DATA : [];
    const isAdmin = window.RULES_IS_ADMIN === true || window.RULES_IS_ADMIN === 'true';
    const listEl = document.getElementById('rules-list');
    const searchInput = document.getElementById('rules-search');
    const newButton = document.getElementById('rules-new-button');
    const newCardSection = document.getElementById('rules-new-card');
    const newForm = document.getElementById('rules-new-form');
    const newCancel = document.getElementById('rules-new-cancel');

    if (!listEl || !searchInput) {
        return;
    }

    const state = {
        cards: rawCards.map((card) => ({
            ...card,
            isExpanded: false,
            isEditing: false,
        })),
        query: '',
    };

    const escapeHtml = (value) =>
        String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

    const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const tokenizeQuery = (value) =>
        value
            .toLowerCase()
            .split(/\s+/)
            .map((token) => token.trim())
            .filter(Boolean);

    const highlightEscaped = (text, tokens) => {
        let result = escapeHtml(text);
        if (!tokens.length) {
            return result;
        }
        tokens.forEach((token) => {
            const regex = new RegExp(escapeRegExp(token), 'gi');
            result = result.replace(
                regex,
                (match) => `<mark class="rules-highlight">${match}</mark>`
            );
        });
        return result;
    };

    const buildBodyHtml = (text, tokens, cardIndex) => {
        const pattern = /\[\[card_id:(\d+)]]/gi;
        let result = '';
        let lastIndex = 0;
        let match;
        while ((match = pattern.exec(text))) {
            const before = text.slice(lastIndex, match.index);
            result += highlightEscaped(before, tokens);
            const linkId = Number(match[1]);
            const linkedCard = cardIndex.get(linkId);
            const label = linkedCard ? linkedCard.title : `Card #${linkId}`;
            result += `<a href="#" class="rules-link" data-link-card-id="${linkId}">`;
            result += highlightEscaped(label, tokens);
            result += '</a>';
            lastIndex = pattern.lastIndex;
        }
        result += highlightEscaped(text.slice(lastIndex), tokens);
        return result;
    };

    const normalizeSearchText = (card) =>
        `${card.title} ${card.short_desc} ${card.body}`.toLowerCase();

    const renderCards = () => {
        const tokens = tokenizeQuery(state.query);
        const cardIndex = new Map(state.cards.map((card) => [Number(card.id), card]));
        listEl.innerHTML = '';

        const filtered = state.cards.filter((card) => {
            if (!tokens.length) {
                return true;
            }
            const haystack = normalizeSearchText(card);
            return tokens.every((token) => haystack.includes(token));
        });

        if (!filtered.length) {
            const empty = document.createElement('div');
            empty.className = 'rules-empty';
            empty.textContent = 'Нічого не знайдено.';
            listEl.appendChild(empty);
            return;
        }

        filtered.forEach((card) => {
            if (card.isEditing) {
                card.isExpanded = true;
            }
            const cardEl = document.createElement('article');
            cardEl.className = `rules-card rules-card--${card.style}`;
            if (card.isExpanded) {
                cardEl.classList.add('is-expanded');
            }
            cardEl.dataset.cardId = card.id;

            const header = document.createElement('div');
            header.className = 'rules-card__header';

            const titleWrap = document.createElement('div');
            titleWrap.className = 'rules-card__title-wrap';

            if (card.isEditing) {
                const titleInput = document.createElement('input');
                titleInput.type = 'text';
                titleInput.value = card.title;
                titleInput.className = 'rules-input';
                titleInput.dataset.field = 'title';
                titleWrap.appendChild(titleInput);
            } else {
                const titleButton = document.createElement('button');
                titleButton.type = 'button';
                titleButton.className = 'rules-card__title';
                titleButton.dataset.action = 'toggle';
                titleButton.innerHTML = highlightEscaped(card.title, tokens);
                titleWrap.appendChild(titleButton);
            }

            const shortDesc = document.createElement('p');
            shortDesc.className = 'rules-card__short';
            if (card.isEditing) {
                const shortInput = document.createElement('input');
                shortInput.type = 'text';
                shortInput.value = card.short_desc;
                shortInput.className = 'rules-input';
                shortInput.dataset.field = 'short_desc';
                shortDesc.appendChild(shortInput);
            } else {
                shortDesc.innerHTML = highlightEscaped(card.short_desc, tokens);
            }
            titleWrap.appendChild(shortDesc);
            header.appendChild(titleWrap);

            const actions = document.createElement('div');
            actions.className = 'rules-card__actions';
            if (isAdmin) {
                if (card.isEditing) {
                    const saveButton = document.createElement('button');
                    saveButton.type = 'button';
                    saveButton.className = 'button small';
                    saveButton.textContent = 'Save';
                    saveButton.dataset.action = 'save';
                    const cancelButton = document.createElement('button');
                    cancelButton.type = 'button';
                    cancelButton.className = 'button ghost small';
                    cancelButton.textContent = 'Cancel';
                    cancelButton.dataset.action = 'cancel';
                    actions.append(saveButton, cancelButton);
                } else {
                    const editButton = document.createElement('button');
                    editButton.type = 'button';
                    editButton.className = 'button ghost small';
                    editButton.textContent = 'Edit';
                    editButton.dataset.action = 'edit';
                    const deleteButton = document.createElement('button');
                    deleteButton.type = 'button';
                    deleteButton.className = 'button danger small';
                    deleteButton.textContent = 'Delete';
                    deleteButton.dataset.action = 'delete';
                    actions.append(editButton, deleteButton);
                }
            }
            header.appendChild(actions);
            cardEl.appendChild(header);

            const body = document.createElement('div');
            body.className = 'rules-card__body';
            if (card.isEditing) {
                const bodyInput = document.createElement('textarea');
                bodyInput.rows = 6;
                bodyInput.className = 'rules-textarea';
                bodyInput.value = card.body;
                bodyInput.dataset.field = 'body';
                body.appendChild(bodyInput);
            } else {
                body.innerHTML = buildBodyHtml(card.body, tokens, cardIndex);
            }
            cardEl.appendChild(body);

            listEl.appendChild(cardEl);
        });
    };

    const setEditing = (cardId, isEditing) => {
        const card = state.cards.find((item) => Number(item.id) === Number(cardId));
        if (!card) return;
        card.isEditing = isEditing;
        renderCards();
    };

    const updateCard = async (cardId, updates) => {
        const response = await fetch(`/api/rules/${cardId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(updates),
        });
        if (!response.ok) {
            throw new Error('Failed to update');
        }
        return response.json();
    };

    const deleteCard = async (cardId) => {
        const response = await fetch(`/api/rules/${cardId}`, {
            method: 'DELETE',
        });
        if (!response.ok) {
            throw new Error('Failed to delete');
        }
        return response.json();
    };

    listEl.addEventListener('click', async (event) => {
        const link = event.target.closest('.rules-link');
        if (link) {
            event.preventDefault();
            const targetId = Number(link.dataset.linkCardId);
            if (!targetId) return;
            state.query = '';
            searchInput.value = '';
            const targetCard = state.cards.find((card) => Number(card.id) === targetId);
            if (targetCard) {
                targetCard.isExpanded = true;
                renderCards();
                const targetEl = listEl.querySelector(`[data-card-id="${targetId}"]`);
                targetEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            return;
        }

        const actionButton = event.target.closest('[data-action]');
        if (!actionButton) return;
        const cardEl = actionButton.closest('.rules-card');
        if (!cardEl) return;
        const cardId = Number(cardEl.dataset.cardId);
        const card = state.cards.find((item) => Number(item.id) === cardId);
        if (!card) return;

        switch (actionButton.dataset.action) {
            case 'toggle':
                card.isExpanded = !card.isExpanded;
                renderCards();
                break;
            case 'edit':
                setEditing(cardId, true);
                break;
            case 'cancel':
                setEditing(cardId, false);
                break;
            case 'save': {
                const titleInput = cardEl.querySelector('[data-field="title"]');
                const shortInput = cardEl.querySelector('[data-field="short_desc"]');
                const bodyInput = cardEl.querySelector('[data-field="body"]');
                const title = titleInput?.value.trim() || '';
                const shortDesc = shortInput?.value.trim() || '';
                const body = bodyInput?.value.trim() || '';
                if (!title || !shortDesc || !body) {
                    alert('Заповніть усі поля перед збереженням.');
                    return;
                }
                try {
                    const updated = await updateCard(cardId, {
                        title,
                        short_desc: shortDesc,
                        body,
                    });
                    Object.assign(card, updated, { isEditing: false });
                    renderCards();
                } catch (error) {
                    alert('Не вдалося зберегти зміни.');
                }
                break;
            }
            case 'delete': {
                if (!confirm('Видалити цю картку?')) {
                    return;
                }
                try {
                    await deleteCard(cardId);
                    state.cards = state.cards.filter((item) => Number(item.id) !== cardId);
                    renderCards();
                } catch (error) {
                    alert('Не вдалося видалити картку.');
                }
                break;
            }
            default:
                break;
        }
    });

    listEl.addEventListener('dblclick', (event) => {
        if (!isAdmin) return;
        const cardEl = event.target.closest('.rules-card');
        if (!cardEl) return;
        const cardId = Number(cardEl.dataset.cardId);
        const card = state.cards.find((item) => Number(item.id) === cardId);
        if (!card || card.isEditing) return;
        setEditing(cardId, true);
    });

    searchInput.addEventListener('input', (event) => {
        state.query = event.target.value;
        renderCards();
    });

    if (newButton && newCardSection && newForm && newCancel) {
        newButton.addEventListener('click', () => {
            newCardSection.classList.remove('is-hidden');
            newForm.querySelector('input[name="title"]')?.focus();
        });

        newCancel.addEventListener('click', () => {
            newForm.reset();
            newCardSection.classList.add('is-hidden');
        });

        newForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const formData = new FormData(newForm);
            const payload = {
                title: String(formData.get('title') || '').trim(),
                short_desc: String(formData.get('short_desc') || '').trim(),
                body: String(formData.get('body') || '').trim(),
                style: String(formData.get('style') || '').trim(),
            };
            if (!payload.title || !payload.short_desc || !payload.body) {
                alert('Заповніть усі поля перед створенням.');
                return;
            }
            try {
                const response = await fetch('/api/rules', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                });
                if (!response.ok) {
                    throw new Error('Failed');
                }
                const created = await response.json();
                state.cards.unshift({
                    ...created,
                    isExpanded: true,
                    isEditing: false,
                });
                newForm.reset();
                newCardSection.classList.add('is-hidden');
                renderCards();
            } catch (error) {
                alert('Не вдалося створити картку.');
            }
        });
    }

    renderCards();
})();
