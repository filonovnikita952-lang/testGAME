(() => {
    const rawData = window.RULES_DATA || {};
    const isAdmin = window.RULES_IS_ADMIN === true || window.RULES_IS_ADMIN === 'true';
    const categoryListEl = document.getElementById('rules-category-list');
    const cardsEl = document.getElementById('rules-cards');
    const categoryTitleEl = document.getElementById('rules-category-title');
    const searchInput = document.getElementById('rules-search');
    const searchButton = document.getElementById('rules-search-button');
    const searchResultsEl = document.getElementById('rules-search-results');
    const categoryAddButton = document.getElementById('rules-category-add');
    const categoryForm = document.getElementById('rules-category-form');
    const categoryCancel = document.getElementById('rules-category-cancel');
    const cardAddButton = document.getElementById('rules-card-add');
    const cardForm = document.getElementById('rules-card-form');
    const cardCancel = document.getElementById('rules-card-cancel');

    if (!categoryListEl || !cardsEl || !searchInput || !searchResultsEl) {
        return;
    }

    const state = {
        categories: Array.isArray(rawData.categories)
            ? rawData.categories.map((category) => ({
                  ...category,
                  cards: Array.isArray(category.cards)
                      ? category.cards.map((card) => ({
                            ...card,
                        }))
                      : [],
              }))
            : [],
        selectedCategoryId: null,
        expandedCardId: null,
        editingCardId: null,
        searchQuery: '',
        highlightTokens: [],
        highlightCardId: null,
        highlightMode: null,
    };

    const escapeHtml = (value) =>
        String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

    const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const allowedColors = new Set(['red', 'green', 'blue', 'orange', 'purple', 'gray']);

    const tokenizeQuery = (value) =>
        String(value)
            .toLowerCase()
            .split(/\s+/)
            .map((token) => token.trim())
            .filter(Boolean);

    const highlightText = (text, tokens) => {
        if (!tokens.length) {
            return escapeHtml(text);
        }
        let result = escapeHtml(text);
        tokens.forEach((token) => {
            const regex = new RegExp(escapeRegExp(token), 'gi');
            result = result.replace(regex, (match) => `<mark class="rules-highlight">${match}</mark>`);
        });
        return result;
    };

    const findInternalTarget = (rawUrl) => {
        if (!rawUrl) {
            return null;
        }
        if (rawUrl.startsWith('card:')) {
            const cardId = Number(rawUrl.replace('card:', '').trim());
            return cardId ? { cardId } : null;
        }
        if (rawUrl.startsWith('category:')) {
            const categoryId = Number(rawUrl.replace('category:', '').trim());
            return categoryId ? { categoryId } : null;
        }
        let url;
        try {
            url = new URL(rawUrl, window.location.origin);
        } catch (error) {
            return null;
        }
        if (url.pathname !== window.location.pathname) {
            return null;
        }
        const categoryId = Number(url.searchParams.get('category'));
        const cardId = Number(url.searchParams.get('card'));
        if (categoryId || cardId) {
            return {
                categoryId: categoryId || null,
                cardId: cardId || null,
                hash: url.hash,
            };
        }
        return null;
    };

    const applyHighlight = (escapedText, tokens) => {
        if (!tokens?.length) {
            return escapedText;
        }
        let result = escapedText;
        tokens.forEach((token) => {
            const regex = new RegExp(escapeRegExp(token), 'gi');
            result = result.replace(regex, (match) => `<mark class="rules-highlight">${match}</mark>`);
        });
        return result;
    };

    const applyInlineFormatting = (text, tokens, enableHighlight) => {
        let result = escapeHtml(text);
        if (enableHighlight) {
            result = applyHighlight(result, tokens);
        }
        result = result.replace(
            /\{color:(red|green|blue|orange|purple|gray)\}([\s\S]*?)\{\/color\}/g,
            (match, color, content) => {
                if (!allowedColors.has(color)) {
                    return match;
                }
                return `<span class="txt-${color}">${content}</span>`;
            }
        );
        result = result.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
        result = result.replace(/\*([\s\S]+?)\*/g, '<em>$1</em>');
        return result;
    };

    const buildInternalHref = (target) => {
        const url = new URL(window.location.href);
        if (target.categoryId) {
            url.searchParams.set('category', target.categoryId);
        } else {
            url.searchParams.delete('category');
        }
        if (target.cardId) {
            url.searchParams.set('card', target.cardId);
        } else {
            url.searchParams.delete('card');
        }
        if (target.hash) {
            url.hash = target.hash;
        }
        return url.toString();
    };

    const getSafeLink = (rawUrl) => {
        const trimmed = String(rawUrl || '').trim();
        if (!trimmed) {
            return null;
        }
        const internalTarget = findInternalTarget(trimmed);
        if (internalTarget) {
            return { href: buildInternalHref(internalTarget), internalTarget };
        }
        let url;
        try {
            url = new URL(trimmed, window.location.origin);
        } catch (error) {
            return null;
        }
        if (!['http:', 'https:'].includes(url.protocol)) {
            return null;
        }
        return { href: url.toString(), internalTarget: null };
    };

    const formatRulesText = (text, tokens, enableHighlight) => {
        const pattern = /\[([^\]]+)]\(([^)]+)\)/g;
        let result = '';
        let lastIndex = 0;
        let match;
        const source = String(text || '');
        while ((match = pattern.exec(source))) {
            const before = source.slice(lastIndex, match.index);
            result += applyInlineFormatting(before, tokens, enableHighlight);
            const label = match[1];
            const rawUrl = match[2];
            const linkInfo = getSafeLink(rawUrl);
            if (!linkInfo) {
                result += applyInlineFormatting(match[0], tokens, enableHighlight);
            } else {
                const internalTarget = linkInfo.internalTarget;
                const dataAttrs = internalTarget
                    ? ` data-card-id="${internalTarget.cardId || ''}" data-category-id="${
                          internalTarget.categoryId || ''
                      }"`
                    : '';
                result += `<a href="${escapeHtml(linkInfo.href)}" class="rules-link"${dataAttrs} target="_blank" rel="noopener noreferrer">`;
                result += applyInlineFormatting(label, tokens, enableHighlight);
                result += '</a>';
            }
            lastIndex = pattern.lastIndex;
        }
        result += applyInlineFormatting(source.slice(lastIndex), tokens, enableHighlight);
        return result;
    };

    const getCategoryById = (id) => state.categories.find((category) => Number(category.id) === Number(id));

    const getCardById = (id) => {
        for (const category of state.categories) {
            const card = category.cards.find((item) => Number(item.id) === Number(id));
            if (card) return card;
        }
        return null;
    };

    const getCardCategory = (cardId) =>
        state.categories.find((category) => category.cards.some((item) => Number(item.id) === Number(cardId)));

    const setSelectedCategory = (categoryId) => {
        state.selectedCategoryId = categoryId;
        if (categoryTitleEl) {
            const category = getCategoryById(categoryId);
            categoryTitleEl.textContent = category ? category.name : 'Cards';
        }
        renderCategories();
        renderCards();
    };

    const resetHighlight = () => {
        state.highlightTokens = [];
        state.highlightCardId = null;
        state.highlightMode = null;
    };

    const focusCard = (cardId, options = {}) => {
        const card = getCardById(cardId);
        if (!card) return;
        const category = getCardCategory(cardId);
        if (category) {
            state.selectedCategoryId = category.id;
        }
        state.expandedCardId = cardId;
        state.highlightTokens = options.tokens || [];
        state.highlightCardId = cardId;
        state.highlightMode = options.mode || null;
        renderCategories();
        renderCards();
        requestAnimationFrame(() => {
            const cardEl = cardsEl.querySelector(`[data-card-id="${cardId}"]`);
            if (cardEl) {
                cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                if (options.mode === 'search') {
                    const mark = cardEl.querySelector('mark');
                    mark?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        });
    };

    const renderCategories = () => {
        categoryListEl.innerHTML = '';
        if (!state.categories.length) {
            const empty = document.createElement('div');
            empty.className = 'rules-empty';
            empty.textContent = 'No categories yet.';
            categoryListEl.appendChild(empty);
            return;
        }
        state.categories.forEach((category) => {
            const item = document.createElement('div');
            item.className = 'rules-category';
            if (Number(category.id) === Number(state.selectedCategoryId)) {
                item.classList.add('is-active');
            }
            item.dataset.categoryId = category.id;
            const title = document.createElement('div');
            title.className = 'rules-category__title';
            const name = document.createElement('span');
            name.className = 'rules-category__name';
            name.textContent = category.name;
            const meta = document.createElement('span');
            meta.className = 'rules-category__meta';
            meta.textContent = `${category.cards.length} cards`;
            title.append(name, meta);
            item.appendChild(title);
            if (isAdmin) {
                const actions = document.createElement('div');
                actions.className = 'rules-category__actions';
                actions.innerHTML = `
                    <button type="button" data-action="move-category-up">↑</button>
                    <button type="button" data-action="move-category-down">↓</button>
                    <button type="button" data-action="delete-category">✕</button>
                `;
                item.appendChild(actions);
            }
            categoryListEl.appendChild(item);
        });
    };

    const renderCards = () => {
        cardsEl.innerHTML = '';
        const category = getCategoryById(state.selectedCategoryId);
        if (categoryTitleEl) {
            categoryTitleEl.textContent = category ? category.name : 'Cards';
        }
        if (!category) {
            const empty = document.createElement('div');
            empty.className = 'rules-empty';
            empty.textContent = 'Select a category to see cards.';
            cardsEl.appendChild(empty);
            return;
        }
        if (!category.cards.length) {
            const empty = document.createElement('div');
            empty.className = 'rules-empty';
            empty.textContent = 'No cards in this category.';
            cardsEl.appendChild(empty);
            return;
        }

        category.cards.forEach((card, index) => {
            const isExpanded = Number(state.expandedCardId) === Number(card.id);
            const isEditing = Number(state.editingCardId) === Number(card.id);
            const highlightEnabled =
                Number(state.highlightCardId) === Number(card.id) && state.highlightMode === 'search';
            const cardEl = document.createElement('article');
            cardEl.className = `rules-card rules-card--${card.style}`;
            cardEl.dataset.cardId = card.id;
            if (isExpanded) {
                cardEl.classList.add('is-expanded');
            }
            if (Number(state.highlightCardId) === Number(card.id) && state.highlightMode === 'reference') {
                cardEl.classList.add('is-referenced');
            }

            const header = document.createElement('div');
            header.className = 'rules-card__header';

            const titleWrap = document.createElement('div');
            titleWrap.className = 'rules-card__title-wrap';

            if (isEditing) {
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
                titleButton.dataset.action = 'toggle-card';
                titleButton.innerHTML = highlightEnabled
                    ? highlightText(card.title, state.highlightTokens)
                    : escapeHtml(card.title);
                titleWrap.appendChild(titleButton);
            }

            const shortDesc = document.createElement('p');
            shortDesc.className = 'rules-card__short';
            if (isEditing) {
                const shortInput = document.createElement('input');
                shortInput.type = 'text';
                shortInput.value = card.short_desc;
                shortInput.className = 'rules-input';
                shortInput.dataset.field = 'short_desc';
                shortDesc.appendChild(shortInput);
            } else {
                shortDesc.innerHTML = formatRulesText(card.short_desc, state.highlightTokens, highlightEnabled);
            }
            const indexTag = document.createElement('span');
            indexTag.className = 'rules-card__index';
            indexTag.textContent = `#${index + 1}`;
            titleWrap.appendChild(shortDesc);
            titleWrap.appendChild(indexTag);
            header.appendChild(titleWrap);

            const actions = document.createElement('div');
            actions.className = 'rules-card__actions';
            if (!isEditing) {
                const copyButton = document.createElement('button');
                copyButton.type = 'button';
                copyButton.className = 'rules-card__action is-icon';
                copyButton.textContent = '📎';
                copyButton.dataset.action = 'copy-link';
                actions.appendChild(copyButton);
            }

            if (isAdmin) {
                if (isEditing) {
                    const saveButton = document.createElement('button');
                    saveButton.type = 'button';
                    saveButton.className = 'rules-card__action';
                    saveButton.textContent = 'Save';
                    saveButton.dataset.action = 'save-card';
                    const cancelButton = document.createElement('button');
                    cancelButton.type = 'button';
                    cancelButton.className = 'rules-card__action';
                    cancelButton.textContent = 'Cancel';
                    cancelButton.dataset.action = 'cancel-edit';
                    actions.append(saveButton, cancelButton);
                } else {
                    const moveUp = document.createElement('button');
                    moveUp.type = 'button';
                    moveUp.className = 'rules-card__action';
                    moveUp.textContent = '↑';
                    moveUp.dataset.action = 'move-card-up';
                    const moveDown = document.createElement('button');
                    moveDown.type = 'button';
                    moveDown.className = 'rules-card__action';
                    moveDown.textContent = '↓';
                    moveDown.dataset.action = 'move-card-down';
                    const editButton = document.createElement('button');
                    editButton.type = 'button';
                    editButton.className = 'rules-card__action';
                    editButton.textContent = 'Edit';
                    editButton.dataset.action = 'edit-card';
                    const deleteButton = document.createElement('button');
                    deleteButton.type = 'button';
                    deleteButton.className = 'rules-card__action';
                    deleteButton.textContent = 'Delete';
                    deleteButton.dataset.action = 'delete-card';
                    actions.append(moveUp, moveDown, editButton, deleteButton);
                }
            }

            header.appendChild(actions);
            cardEl.appendChild(header);

            const body = document.createElement('div');
            body.className = 'rules-card__body';
            if (isEditing) {
                const categorySelect = document.createElement('select');
                categorySelect.className = 'rules-input';
                categorySelect.dataset.field = 'category_id';
                state.categories.forEach((cat) => {
                    const option = document.createElement('option');
                    option.value = cat.id;
                    option.textContent = cat.name;
                    if (Number(cat.id) === Number(category.id)) {
                        option.selected = true;
                    }
                    categorySelect.appendChild(option);
                });

                const styleSelect = document.createElement('select');
                styleSelect.className = 'rules-input';
                styleSelect.dataset.field = 'style';
                ['terminal', 'parchment', 'stone'].forEach((style) => {
                    const option = document.createElement('option');
                    option.value = style;
                    option.textContent = style.charAt(0).toUpperCase() + style.slice(1);
                    if (card.style === style) {
                        option.selected = true;
                    }
                    styleSelect.appendChild(option);
                });

                const bodyInput = document.createElement('textarea');
                bodyInput.rows = 6;
                bodyInput.className = 'rules-textarea';
                bodyInput.value = card.body;
                bodyInput.dataset.field = 'body';

                const editGrid = document.createElement('div');
                editGrid.className = 'rules-form';
                editGrid.innerHTML = `
                    <label class="rules-form__field">
                        <span>Category</span>
                    </label>
                    <label class="rules-form__field">
                        <span>Style</span>
                    </label>
                `;
                editGrid.children[0].appendChild(categorySelect);
                editGrid.children[1].appendChild(styleSelect);
                body.appendChild(editGrid);
                body.appendChild(bodyInput);
            } else {
                body.innerHTML = formatRulesText(card.body, state.highlightTokens, highlightEnabled);
            }
            cardEl.appendChild(body);
            cardsEl.appendChild(cardEl);
        });
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

    const createCard = async (payload) => {
        const response = await fetch('/api/rules', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error('Failed to create');
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

    const moveCard = async (cardId, direction) => {
        const response = await fetch(`/api/rules/${cardId}/move`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ direction }),
        });
        if (!response.ok) {
            throw new Error('Failed to move');
        }
        return response.json();
    };

    const createCategory = async (payload) => {
        const response = await fetch('/api/rules/categories', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            throw new Error('Failed to create');
        }
        return response.json();
    };

    const deleteCategory = async (categoryId) => {
        const response = await fetch(`/api/rules/categories/${categoryId}`, {
            method: 'DELETE',
        });
        if (!response.ok) {
            throw new Error('Failed to delete');
        }
        return response.json();
    };

    const moveCategory = async (categoryId, direction) => {
        const response = await fetch(`/api/rules/categories/${categoryId}/move`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ direction }),
        });
        if (!response.ok) {
            throw new Error('Failed to move');
        }
        return response.json();
    };

    const copyToClipboard = async (text) => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }
        const temp = document.createElement('textarea');
        temp.value = text;
        temp.style.position = 'fixed';
        temp.style.opacity = '0';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
    };

    const buildCardLink = (categoryId, cardId) => {
        const url = new URL(window.location.href);
        url.searchParams.set('category', categoryId);
        url.searchParams.set('card', cardId);
        return url.toString();
    };

    const buildSearchResults = (query) => {
        const tokens = tokenizeQuery(query);
        if (!tokens.length) {
            return [];
        }
        const results = [];
        state.categories.forEach((category) => {
            category.cards.forEach((card, index) => {
                const haystack = `${card.title} ${card.short_desc} ${card.body}`.toLowerCase();
                if (tokens.every((token) => haystack.includes(token))) {
                    const bodyLower = card.body.toLowerCase();
                    const matchIndex = tokens
                        .map((token) => bodyLower.indexOf(token))
                        .find((position) => position >= 0);
                    const snippetStart = matchIndex >= 0 ? Math.max(0, matchIndex - 30) : 0;
                    const snippet = card.body.slice(snippetStart, snippetStart + 90);
                    results.push({
                        card,
                        category,
                        index: index + 1,
                        snippet,
                    });
                }
            });
        });
        return results.slice(0, 10);
    };

    const renderSearchResults = () => {
        searchResultsEl.innerHTML = '';
        const tokens = tokenizeQuery(state.searchQuery);
        const results = buildSearchResults(state.searchQuery);
        if (!results.length) {
            searchResultsEl.classList.add('is-hidden');
            return;
        }
        results.forEach((result) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'rules-search__result';
            button.dataset.cardId = result.card.id;
            button.dataset.categoryId = result.category.id;
            button.dataset.query = state.searchQuery;
            button.innerHTML = `
                <strong>[${escapeHtml(result.category.name)}] #${result.index}</strong>
                <span>…${highlightText(result.snippet, tokens)}…</span>
            `;
            searchResultsEl.appendChild(button);
        });
        searchResultsEl.classList.remove('is-hidden');
    };

    const syncCategorySelectOptions = () => {
        if (!cardForm) return;
        const select = cardForm.querySelector('select[name="category_id"]');
        if (!select) return;
        select.innerHTML = '';
        state.categories.forEach((category) => {
            const option = document.createElement('option');
            option.value = category.id;
            option.textContent = category.name;
            if (Number(category.id) === Number(state.selectedCategoryId)) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    };

    categoryListEl.addEventListener('click', async (event) => {
        const actionButton = event.target.closest('[data-action]');
        const item = event.target.closest('.rules-category');
        if (!item) return;
        const categoryId = Number(item.dataset.categoryId);
        if (actionButton && isAdmin) {
            if (actionButton.dataset.action === 'delete-category') {
                if (!confirm('Delete this category and all its cards?')) return;
                try {
                    await deleteCategory(categoryId);
                    state.categories = state.categories.filter((cat) => Number(cat.id) !== categoryId);
                    if (Number(state.selectedCategoryId) === categoryId) {
                        state.selectedCategoryId = state.categories[0]?.id || null;
                    }
                    renderCategories();
                    renderCards();
                    syncCategorySelectOptions();
                } catch (error) {
                    alert('Failed to delete category.');
                }
                return;
            }
            if (actionButton.dataset.action === 'move-category-up') {
                try {
                    const updated = await moveCategory(categoryId, 'up');
                    state.categories = updated.map((category) => ({
                        ...category,
                        cards: getCategoryById(category.id)?.cards || [],
                    }));
                    renderCategories();
                } catch (error) {
                    alert('Failed to move category.');
                }
                return;
            }
            if (actionButton.dataset.action === 'move-category-down') {
                try {
                    const updated = await moveCategory(categoryId, 'down');
                    state.categories = updated.map((category) => ({
                        ...category,
                        cards: getCategoryById(category.id)?.cards || [],
                    }));
                    renderCategories();
                } catch (error) {
                    alert('Failed to move category.');
                }
                return;
            }
        }
        resetHighlight();
        state.expandedCardId = null;
        state.editingCardId = null;
        setSelectedCategory(categoryId);
    });

    cardsEl.addEventListener('click', async (event) => {
        const link = event.target.closest('.rules-link');
        if (link) {
            const cardId = Number(link.dataset.cardId) || null;
            const categoryId = Number(link.dataset.categoryId) || null;
            if (cardId || categoryId) {
                event.preventDefault();
                resetHighlight();
                state.highlightMode = 'reference';
                if (cardId) {
                    focusCard(cardId, { mode: 'reference' });
                } else if (categoryId) {
                    setSelectedCategory(categoryId);
                }
            }
            return;
        }

        const actionButton = event.target.closest('[data-action]');
        if (!actionButton) return;
        const cardEl = actionButton.closest('.rules-card');
        if (!cardEl) return;
        const cardId = Number(cardEl.dataset.cardId);
        const category = getCategoryById(state.selectedCategoryId);
        const card = getCardById(cardId);
        if (!card || !category) return;

        switch (actionButton.dataset.action) {
            case 'toggle-card':
                resetHighlight();
                state.expandedCardId = state.expandedCardId === cardId ? null : cardId;
                if (state.expandedCardId) {
                    state.editingCardId = null;
                }
                renderCards();
                break;
            case 'copy-link': {
                const linkUrl = buildCardLink(category.id, cardId);
                try {
                    await copyToClipboard(linkUrl);
                } catch (error) {
                    alert('Failed to copy link.');
                }
                break;
            }
            case 'edit-card':
                state.editingCardId = cardId;
                state.expandedCardId = cardId;
                renderCards();
                break;
            case 'cancel-edit':
                state.editingCardId = null;
                renderCards();
                break;
            case 'save-card': {
                const titleInput = cardEl.querySelector('[data-field="title"]');
                const shortInput = cardEl.querySelector('[data-field="short_desc"]');
                const bodyInput = cardEl.querySelector('[data-field="body"]');
                const styleSelect = cardEl.querySelector('[data-field="style"]');
                const categorySelect = cardEl.querySelector('[data-field="category_id"]');
                const title = titleInput?.value.trim() || '';
                const shortDesc = shortInput?.value.trim() || '';
                const body = bodyInput?.value.trim() || '';
                const style = styleSelect?.value || '';
                const categoryId = categorySelect?.value || '';
                if (!title || !shortDesc || !body) {
                    alert('Fill out all fields before saving.');
                    return;
                }
                try {
                    const updated = await updateCard(cardId, {
                        title,
                        short_desc: shortDesc,
                        body,
                        style,
                        category_id: categoryId,
                    });
                    const currentCategory = getCardCategory(cardId);
                    if (currentCategory) {
                        currentCategory.cards = currentCategory.cards.filter(
                            (item) => Number(item.id) !== cardId
                        );
                    }
                    const newCategory = getCategoryById(updated.category_id);
                    if (newCategory) {
                        newCategory.cards.push(updated);
                        newCategory.cards.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
                    }
                    state.editingCardId = null;
                    state.expandedCardId = cardId;
                    renderCategories();
                    renderCards();
                } catch (error) {
                    alert('Failed to save card.');
                }
                break;
            }
            case 'delete-card':
                if (!confirm('Delete this card?')) return;
                try {
                    await deleteCard(cardId);
                    category.cards = category.cards.filter((item) => Number(item.id) !== cardId);
                    renderCategories();
                    renderCards();
                } catch (error) {
                    alert('Failed to delete card.');
                }
                break;
            case 'move-card-up':
                try {
                    const updatedCards = await moveCard(cardId, 'up');
                    category.cards = updatedCards;
                    renderCards();
                } catch (error) {
                    alert('Failed to move card.');
                }
                break;
            case 'move-card-down':
                try {
                    const updatedCards = await moveCard(cardId, 'down');
                    category.cards = updatedCards;
                    renderCards();
                } catch (error) {
                    alert('Failed to move card.');
                }
                break;
            default:
                break;
        }
    });

    searchInput.addEventListener('input', (event) => {
        state.searchQuery = event.target.value;
        renderSearchResults();
    });

    searchButton?.addEventListener('click', () => {
        searchInput.focus();
        renderSearchResults();
    });

    searchResultsEl.addEventListener('click', (event) => {
        const button = event.target.closest('.rules-search__result');
        if (!button) return;
        const cardId = Number(button.dataset.cardId);
        const tokens = tokenizeQuery(button.dataset.query || '');
        state.searchQuery = '';
        searchInput.value = '';
        searchResultsEl.classList.add('is-hidden');
        focusCard(cardId, { mode: 'search', tokens });
    });

    document.addEventListener('click', (event) => {
        if (!searchResultsEl.contains(event.target) && event.target !== searchInput) {
            searchResultsEl.classList.add('is-hidden');
        }
    });

    if (categoryAddButton && categoryForm && categoryCancel) {
        categoryAddButton.addEventListener('click', () => {
            categoryForm.classList.remove('is-hidden');
            categoryForm.querySelector('input[name="name"]')?.focus();
        });

        categoryCancel.addEventListener('click', () => {
            categoryForm.reset();
            categoryForm.classList.add('is-hidden');
        });

        categoryForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const formData = new FormData(categoryForm);
            const payload = {
                name: String(formData.get('name') || '').trim(),
            };
            if (!payload.name) {
                alert('Enter a category name.');
                return;
            }
            try {
                const created = await createCategory(payload);
                state.categories.push({ ...created, cards: [] });
                categoryForm.reset();
                categoryForm.classList.add('is-hidden');
                renderCategories();
                syncCategorySelectOptions();
            } catch (error) {
                alert('Failed to create category.');
            }
        });
    }

    if (cardAddButton && cardForm && cardCancel) {
        cardAddButton.addEventListener('click', () => {
            cardForm.classList.remove('is-hidden');
            syncCategorySelectOptions();
            cardForm.querySelector('input[name="title"]')?.focus();
        });

        cardCancel.addEventListener('click', () => {
            cardForm.reset();
            cardForm.classList.add('is-hidden');
        });

        cardForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const formData = new FormData(cardForm);
            const payload = {
                category_id: String(formData.get('category_id') || '').trim(),
                title: String(formData.get('title') || '').trim(),
                short_desc: String(formData.get('short_desc') || '').trim(),
                body: String(formData.get('body') || '').trim(),
                style: String(formData.get('style') || '').trim(),
            };
            if (!payload.category_id || !payload.title || !payload.short_desc || !payload.body) {
                alert('Fill out all fields before creating.');
                return;
            }
            try {
                const created = await createCard(payload);
                const category = getCategoryById(created.category_id);
                if (category) {
                    category.cards.push(created);
                    category.cards.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
                }
                cardForm.reset();
                cardForm.classList.add('is-hidden');
                state.selectedCategoryId = created.category_id;
                state.expandedCardId = created.id;
                renderCategories();
                renderCards();
            } catch (error) {
                alert('Failed to create card.');
            }
        });
    }

    const initializeFromUrl = () => {
        const params = new URLSearchParams(window.location.search);
        const categoryId = Number(params.get('category'));
        const cardId = Number(params.get('card'));
        if (cardId) {
            focusCard(cardId, { mode: 'reference' });
            return;
        }
        if (categoryId) {
            setSelectedCategory(categoryId);
            return;
        }
        if (state.categories.length) {
            setSelectedCategory(state.categories[0].id);
        }
    };

    renderCategories();
    renderCards();
    syncCategorySelectOptions();
    initializeFromUrl();
})();
