const adminRoot = document.querySelector('[data-admin-skills-root]');
const adminContent = document.querySelector('[data-admin-skills-content]');
const addCategoryButton = document.querySelector('[data-add-category]');
const seedButton = document.querySelector('[data-seed-skills]');

let adminTree = null;

async function requestJson(url, options = {}) {
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
    });
    if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || 'request_failed');
    }
    return response.json().catch(() => ({}));
}

function levelLabel(skill) {
    return `${skill.level_key}`;
}

function skillRequirementsText(skill) {
    if (!Array.isArray(skill.requirements)) {
        return '';
    }
    return skill.requirements
        .map((req) => req.req_value)
        .filter(Boolean)
        .join('\n');
}

function renderAdminTree() {
    if (!adminContent) {
        return;
    }
    if (!adminTree) {
        adminContent.innerHTML = '<p class="muted">Немає даних.</p>';
        return;
    }
    const categoriesHtml = adminTree.categories.map((category) => {
        const subclassesHtml = category.subclasses.map((subclass) => {
            const branchesHtml = subclass.branches.map((branch) => {
                const nodesHtml = branch.skills.map((skill) => {
                    const disabledClass = skill.id ? '' : 'is-missing';
                    return `
                        <div class="admin-skill-node ${disabledClass}" data-skill-id="${skill.id || ''}" data-level-key="${skill.level_key}" data-branch-id="${branch.id}">
                            <div class="admin-skill-node__header">
                                <strong>Рівень: ${levelLabel(skill)}</strong>
                                <div class="admin-skill-node__actions">
                                    <button class="button ghost" type="button" data-action="save-skill">${skill.id ? 'Зберегти' : 'Створити'}</button>
                                    ${skill.id ? '<button class="button danger" type="button" data-action="delete-skill">Видалити</button>' : ''}
                                </div>
                            </div>
                            <div class="admin-skill-node__grid">
                                <label>Назва
                                    <input type="text" data-field="name" value="${skill.name || ''}">
                                </label>
                                <label>Вартість
                                    <input type="number" data-field="cost_int" value="${skill.cost_int ?? ''}">
                                </label>
                                <label>Тип
                                    <select data-field="ability_type">
                                        <option value="Passive" ${skill.ability_type === 'Passive' ? 'selected' : ''}>Пасивна</option>
                                        <option value="Active" ${skill.ability_type === 'Active' ? 'selected' : ''}>Активна</option>
                                    </select>
                                </label>
                                <label>Дистанція
                                    <select data-field="distance_type">
                                        <option value="SELF" ${skill.distance_type === 'SELF' ? 'selected' : ''}>На себе</option>
                                        <option value="INT_METERS" ${skill.distance_type === 'INT_METERS' ? 'selected' : ''}>Метри</option>
                                    </select>
                                </label>
                                <label>Дистанція (м)
                                    <input type="number" data-field="distance_int" value="${skill.distance_int ?? ''}">
                                </label>
                                <label>Компоненти
                                    <input type="text" data-field="components" value="${skill.components ?? ''}">
                                </label>
                                <label>Час активації (с)
                                    <input type="number" data-field="cast_time_seconds" value="${skill.cast_time_seconds ?? ''}">
                                </label>
                                <label>Тривалість (с)
                                    <input type="number" data-field="duration_seconds" value="${skill.duration_seconds ?? ''}">
                                </label>
                                <label class="admin-skill-node__span">Опис
                                    <textarea data-field="description" rows="2">${skill.description ?? ''}</textarea>
                                </label>
                                <label class="admin-skill-node__span">Вимоги (по одному в рядку)
                                    <textarea data-field="requirements" rows="2">${skillRequirementsText(skill)}</textarea>
                                </label>
                                <label class="admin-skill-node__toggle">
                                    <input type="checkbox" data-field="is_enabled" ${skill.is_enabled ? 'checked' : ''}>
                                    Активна
                                </label>
                            </div>
                        </div>
                    `;
                }).join('');

                return `
                    <div class="admin-skill-branch" data-branch-id="${branch.id}">
                        <div class="admin-skill-row">
                            <input type="text" data-field="branch-name" value="${branch.name}">
                            <label class="admin-skill-inline">Індекс
                                <select data-field="branch-index">
                                    <option value="0" ${branch.branch_index === 0 ? 'selected' : ''}>0</option>
                                    <option value="1" ${branch.branch_index === 1 ? 'selected' : ''}>1</option>
                                    <option value="2" ${branch.branch_index === 2 ? 'selected' : ''}>2</option>
                                </select>
                            </label>
                            <button class="button ghost" type="button" data-action="save-branch">Зберегти</button>
                            <button class="button ghost" type="button" data-action="move-branch" data-direction="up">↑</button>
                            <button class="button ghost" type="button" data-action="move-branch" data-direction="down">↓</button>
                            <button class="button danger" type="button" data-action="delete-branch">Видалити</button>
                        </div>
                        <div class="admin-skill-nodes">
                            ${nodesHtml}
                        </div>
                    </div>
                `;
            }).join('');

            return `
                <div class="admin-skill-subclass" data-subclass-id="${subclass.id}">
                    <div class="admin-skill-row">
                        <input type="text" data-field="subclass-name" value="${subclass.name}">
                        <button class="button ghost" type="button" data-action="save-subclass">Зберегти</button>
                        <button class="button ghost" type="button" data-action="move-subclass" data-direction="up">↑</button>
                        <button class="button ghost" type="button" data-action="move-subclass" data-direction="down">↓</button>
                        <button class="button danger" type="button" data-action="delete-subclass">Видалити</button>
                        <button class="button ghost" type="button" data-action="add-branch" data-max-branches="${subclass.max_branches}">+ Гілка</button>
                    </div>
                    <div class="admin-skill-branches">
                        ${branchesHtml || '<p class="muted">Гілки відсутні.</p>'}
                    </div>
                </div>
            `;
        }).join('');

        return `
            <section class="admin-skill-category" data-category-id="${category.id}">
                <div class="admin-skill-row admin-skill-row--category">
                    <input type="text" data-field="category-name" value="${category.name}">
                    <button class="button ghost" type="button" data-action="save-category">Зберегти</button>
                    <button class="button ghost" type="button" data-action="move-category" data-direction="up">↑</button>
                    <button class="button ghost" type="button" data-action="move-category" data-direction="down">↓</button>
                    <button class="button danger" type="button" data-action="delete-category">Видалити</button>
                    <button class="button ghost" type="button" data-action="add-subclass">+ Підклас</button>
                </div>
                <div class="admin-skill-subclasses">
                    ${subclassesHtml || '<p class="muted">Підкласи відсутні.</p>'}
                </div>
            </section>
        `;
    }).join('');

    adminContent.innerHTML = categoriesHtml || '<p class="muted">Структура поки порожня.</p>';
}

async function refreshTree() {
    adminTree = await requestJson('/api/skills/tree');
    renderAdminTree();
}

function collectSkillPayload(skillNode) {
    const payload = {
        name: skillNode.querySelector('[data-field="name"]').value.trim(),
        cost_int: skillNode.querySelector('[data-field="cost_int"]').value,
        ability_type: skillNode.querySelector('[data-field="ability_type"]').value,
        distance_type: skillNode.querySelector('[data-field="distance_type"]').value,
        distance_int: skillNode.querySelector('[data-field="distance_int"]').value,
        components: skillNode.querySelector('[data-field="components"]').value.trim(),
        cast_time_seconds: skillNode.querySelector('[data-field="cast_time_seconds"]').value,
        duration_seconds: skillNode.querySelector('[data-field="duration_seconds"]').value,
        description: skillNode.querySelector('[data-field="description"]').value,
        is_enabled: skillNode.querySelector('[data-field="is_enabled"]').checked,
        requirements: skillNode
            .querySelector('[data-field="requirements"]')
            .value
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
    };
    return payload;
}

async function handleSkillSave(button) {
    const skillNode = button.closest('.admin-skill-node');
    if (!skillNode) {
        return;
    }
    const skillId = skillNode.dataset.skillId;
    const branchId = skillNode.dataset.branchId;
    const levelKey = skillNode.dataset.levelKey;
    const payload = collectSkillPayload(skillNode);
    if (!payload.name) {
        alert('Вкажіть назву навички.');
        return;
    }
    if (skillId) {
        await requestJson(`/admin/skills/skills/${skillId}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
        });
    } else {
        await requestJson('/admin/skills/skills', {
            method: 'POST',
            body: JSON.stringify({
                branch_id: branchId,
                level_key: levelKey,
                ...payload,
            }),
        });
    }
    await refreshTree();
}

async function handleSkillDelete(button) {
    const skillNode = button.closest('.admin-skill-node');
    if (!skillNode) {
        return;
    }
    const skillId = skillNode.dataset.skillId;
    if (!skillId) {
        return;
    }
    if (!confirm('Видалити навичку?')) {
        return;
    }
    await requestJson(`/admin/skills/skills/${skillId}`, { method: 'DELETE' });
    await refreshTree();
}

async function handleCategorySave(button) {
    const categoryEl = button.closest('.admin-skill-category');
    if (!categoryEl) {
        return;
    }
    const categoryId = categoryEl.dataset.categoryId;
    const nameInput = categoryEl.querySelector('[data-field="category-name"]');
    const name = nameInput.value.trim();
    if (!name) {
        alert('Вкажіть назву класу.');
        return;
    }
    await requestJson(`/admin/skills/categories/${categoryId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
    });
    await refreshTree();
}

async function handleSubclassSave(button) {
    const subclassEl = button.closest('.admin-skill-subclass');
    if (!subclassEl) {
        return;
    }
    const subclassId = subclassEl.dataset.subclassId;
    const nameInput = subclassEl.querySelector('[data-field="subclass-name"]');
    const name = nameInput.value.trim();
    if (!name) {
        alert('Вкажіть назву підкласу.');
        return;
    }
    await requestJson(`/admin/skills/subclasses/${subclassId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
    });
    await refreshTree();
}

async function handleBranchSave(button) {
    const branchEl = button.closest('.admin-skill-branch');
    if (!branchEl) {
        return;
    }
    const branchId = branchEl.dataset.branchId;
    const name = branchEl.querySelector('[data-field="branch-name"]').value.trim();
    const branchIndex = branchEl.querySelector('[data-field="branch-index"]').value;
    if (!name) {
        alert('Вкажіть назву гілки.');
        return;
    }
    await requestJson(`/admin/skills/branches/${branchId}`, {
        method: 'PATCH',
        body: JSON.stringify({
            name,
            branch_index: branchIndex,
        }),
    });
    await refreshTree();
}

async function handleCategoryMove(button) {
    const categoryEl = button.closest('.admin-skill-category');
    if (!categoryEl) {
        return;
    }
    const categoryId = categoryEl.dataset.categoryId;
    await requestJson(`/admin/skills/categories/${categoryId}/move`, {
        method: 'POST',
        body: JSON.stringify({ direction: button.dataset.direction }),
    });
    await refreshTree();
}

async function handleSubclassMove(button) {
    const subclassEl = button.closest('.admin-skill-subclass');
    if (!subclassEl) {
        return;
    }
    const subclassId = subclassEl.dataset.subclassId;
    await requestJson(`/admin/skills/subclasses/${subclassId}/move`, {
        method: 'POST',
        body: JSON.stringify({ direction: button.dataset.direction }),
    });
    await refreshTree();
}

async function handleBranchMove(button) {
    const branchEl = button.closest('.admin-skill-branch');
    if (!branchEl) {
        return;
    }
    const branchId = branchEl.dataset.branchId;
    await requestJson(`/admin/skills/branches/${branchId}/move`, {
        method: 'POST',
        body: JSON.stringify({ direction: button.dataset.direction }),
    });
    await refreshTree();
}

async function handleCategoryDelete(button) {
    const categoryEl = button.closest('.admin-skill-category');
    if (!categoryEl) {
        return;
    }
    if (!confirm('Видалити клас і всі підкласи?')) {
        return;
    }
    const categoryId = categoryEl.dataset.categoryId;
    await requestJson(`/admin/skills/categories/${categoryId}`, { method: 'DELETE' });
    await refreshTree();
}

async function handleSubclassDelete(button) {
    const subclassEl = button.closest('.admin-skill-subclass');
    if (!subclassEl) {
        return;
    }
    if (!confirm('Видалити підклас і всі гілки?')) {
        return;
    }
    const subclassId = subclassEl.dataset.subclassId;
    await requestJson(`/admin/skills/subclasses/${subclassId}`, { method: 'DELETE' });
    await refreshTree();
}

async function handleBranchDelete(button) {
    const branchEl = button.closest('.admin-skill-branch');
    if (!branchEl) {
        return;
    }
    if (!confirm('Видалити гілку та всі навички?')) {
        return;
    }
    const branchId = branchEl.dataset.branchId;
    await requestJson(`/admin/skills/branches/${branchId}`, { method: 'DELETE' });
    await refreshTree();
}

async function handleAddCategory() {
    const name = prompt('Назва класу:');
    if (!name) {
        return;
    }
    await requestJson('/admin/skills/categories', {
        method: 'POST',
        body: JSON.stringify({ name }),
    });
    await refreshTree();
}

async function handleAddSubclass(button) {
    const categoryEl = button.closest('.admin-skill-category');
    if (!categoryEl) {
        return;
    }
    const categoryId = categoryEl.dataset.categoryId;
    const name = prompt('Назва підкласу:');
    if (!name) {
        return;
    }
    await requestJson('/admin/skills/subclasses', {
        method: 'POST',
        body: JSON.stringify({ category_id: categoryId, name }),
    });
    await refreshTree();
}

async function handleAddBranch(button) {
    const subclassEl = button.closest('.admin-skill-subclass');
    if (!subclassEl) {
        return;
    }
    const subclassId = subclassEl.dataset.subclassId;
    const name = prompt('Назва гілки:');
    if (!name) {
        return;
    }
    await requestJson('/admin/skills/branches', {
        method: 'POST',
        body: JSON.stringify({ subclass_id: subclassId, name }),
    });
    await refreshTree();
}

async function handleSeed() {
    await requestJson('/admin/skills/seed', { method: 'POST' });
    await refreshTree();
}

if (adminRoot && adminContent) {
    refreshTree().catch(() => {
        adminContent.innerHTML = '<p class="muted">Не вдалося завантажити дані.</p>';
    });

    adminContent.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) {
            return;
        }
        event.preventDefault();
        try {
            switch (button.dataset.action) {
                case 'save-skill':
                    await handleSkillSave(button);
                    break;
                case 'delete-skill':
                    await handleSkillDelete(button);
                    break;
                case 'save-category':
                    await handleCategorySave(button);
                    break;
                case 'save-subclass':
                    await handleSubclassSave(button);
                    break;
                case 'save-branch':
                    await handleBranchSave(button);
                    break;
                case 'move-category':
                    await handleCategoryMove(button);
                    break;
                case 'move-subclass':
                    await handleSubclassMove(button);
                    break;
                case 'move-branch':
                    await handleBranchMove(button);
                    break;
                case 'delete-category':
                    await handleCategoryDelete(button);
                    break;
                case 'delete-subclass':
                    await handleSubclassDelete(button);
                    break;
                case 'delete-branch':
                    await handleBranchDelete(button);
                    break;
                case 'add-subclass':
                    await handleAddSubclass(button);
                    break;
                case 'add-branch':
                    await handleAddBranch(button);
                    break;
                default:
                    break;
            }
        } catch (error) {
            alert('Помилка збереження.');
        }
    });
}

if (addCategoryButton) {
    addCategoryButton.addEventListener('click', () => {
        handleAddCategory().catch(() => alert('Не вдалося створити клас.'));
    });
}

if (seedButton) {
    seedButton.addEventListener('click', () => {
        handleSeed().catch(() => alert('Не вдалося виконати seed.'));
    });
}
