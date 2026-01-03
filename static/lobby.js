(() => {
    const statGroups = document.querySelectorAll('[data-stat-group]');
    if (!statGroups.length) return;

    const lobbyId = statGroups[0]?.dataset.lobbyId || 'default';
    const storagePrefix = `dra_lobby_stats_${lobbyId}_`;
    const artStorageKey = `dra_lobby_character_art_${lobbyId}`;

    const statInputs = Array.from(document.querySelectorAll('[data-stat-key]'));

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
})();
