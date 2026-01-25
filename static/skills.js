const LEVEL_ORDER = ['BR', '0', '1', '2', '3', '4', '5', '6', '7'];
const abilityTypeLabels = {
    Passive: 'Пасивна',
    Active: 'Активна',
};
const distanceLabels = {
    SELF: 'На себе',
    INT_METERS: 'м.',
};

const tabsEl = document.querySelector('[data-skill-tabs]');
const subclassesEl = document.querySelector('[data-skill-subclasses]');
const gridEl = document.querySelector('[data-skill-grid]');
const hintEl = document.querySelector('[data-skill-hint]');
const tooltipEl = document.getElementById('skill-tooltip');
const detailEl = document.querySelector('[data-skill-detail]');
const detailTitleEl = document.querySelector('[data-skill-detail-title]');
const detailStatusEl = document.querySelector('[data-skill-detail-status]');
const detailListEl = document.querySelector('[data-skill-detail-list]');
const detailRequirementsEl = document.querySelector('[data-skill-detail-requirements]');
const detailDescriptionEl = document.querySelector('[data-skill-detail-description]');

let treeData = null;
let activeSkillIds = new Set();
let currentCategoryIndex = 0;
let currentSubclassIndex = 0;
let hintTimeout = null;
let lastSelectedSkill = null;
const HOLD_DURATION_MS = 1500;

function showHint(message) {
    if (!hintEl) {
        return;
    }
    hintEl.textContent = message;
    hintEl.classList.toggle('is-visible', Boolean(message));
    if (hintTimeout) {
        clearTimeout(hintTimeout);
    }
    hintTimeout = setTimeout(() => {
        hintEl.textContent = '';
        hintEl.classList.remove('is-visible');
    }, 2400);
}

function formatDistance(skill) {
    if (skill.distance_type === 'SELF') {
        return 'На себе';
    }
    if (skill.distance_type === 'INT_METERS' && skill.distance_int !== null && skill.distance_int !== undefined) {
        return `${skill.distance_int} м.`;
    }
    return '-';
}

function formatOptionalSeconds(value) {
    if (value === null || value === undefined || value === '') {
        return '-';
    }
    return `${value} с.`;
}

function buildTooltipText(skill) {
    const lines = [
        skill.name || 'Навичка',
        `Рівень контролю Кі: ${skill.level_key}`,
        `Вартість: ${skill.cost_int !== null && skill.cost_int !== undefined ? skill.cost_int : '-'}`,
        `Тип: ${abilityTypeLabels[skill.ability_type] || 'Пасивна'}`,
        `Дистанція: ${formatDistance(skill)}`,
        `Компоненти: ${skill.components ? skill.components : '-'}`,
        `Час активації: ${formatOptionalSeconds(skill.cast_time_seconds)}`,
        `Тривалість: ${formatOptionalSeconds(skill.duration_seconds)}`,
    ];
    if (Array.isArray(skill.requirements) && skill.requirements.length) {
        skill.requirements.forEach((req) => {
            if (req.req_value) {
                lines.push(`Вимоги: ${req.req_value}`);
            }
        });
    }
    lines.push(skill.description ? skill.description : '-');
    return lines.join('\n');
}

function createDetailRow(label, value) {
    const wrapper = document.createElement('div');
    const term = document.createElement('dt');
    const desc = document.createElement('dd');
    term.textContent = label;
    desc.textContent = value;
    wrapper.appendChild(term);
    wrapper.appendChild(desc);
    return wrapper;
}

function resolveSkillStatus(skill) {
    if (!skill.id) {
        return 'Не створено';
    }
    if (activeSkillIds.has(skill.id)) {
        return 'Активна';
    }
    if (!skill.is_enabled) {
        return 'Заблокована';
    }
    return 'Доступна';
}

function renderSkillDetail(skill) {
    if (!detailEl) {
        return;
    }
    if (!skill) {
        if (detailTitleEl) {
            detailTitleEl.textContent = 'Оберіть навичку';
        }
        if (detailStatusEl) {
            detailStatusEl.textContent = 'Натисніть на вузол, щоб переглянути інформацію.';
        }
        if (detailListEl) {
            detailListEl.innerHTML = '';
        }
        if (detailRequirementsEl) {
            detailRequirementsEl.innerHTML = '';
        }
        if (detailDescriptionEl) {
            detailDescriptionEl.textContent = '';
        }
        return;
    }

    if (detailTitleEl) {
        detailTitleEl.textContent = skill.name || `Рівень ${skill.level_key}`;
    }
    if (detailStatusEl) {
        detailStatusEl.textContent = `Статус: ${resolveSkillStatus(skill)}`;
    }
    if (detailListEl) {
        detailListEl.innerHTML = '';
        detailListEl.appendChild(createDetailRow('Рівень', skill.level_key));
        detailListEl.appendChild(
            createDetailRow(
                'Вартість',
                skill.cost_int !== null && skill.cost_int !== undefined ? `${skill.cost_int}` : '-',
            ),
        );
        detailListEl.appendChild(
            createDetailRow('Тип', abilityTypeLabels[skill.ability_type] || 'Пасивна'),
        );
        detailListEl.appendChild(createDetailRow('Дистанція', formatDistance(skill)));
        detailListEl.appendChild(
            createDetailRow('Компоненти', skill.components ? skill.components : '-'),
        );
        detailListEl.appendChild(
            createDetailRow('Час активації', formatOptionalSeconds(skill.cast_time_seconds)),
        );
        detailListEl.appendChild(
            createDetailRow('Тривалість', formatOptionalSeconds(skill.duration_seconds)),
        );
    }
    if (detailRequirementsEl) {
        if (Array.isArray(skill.requirements) && skill.requirements.length) {
            const list = document.createElement('ul');
            skill.requirements.forEach((req) => {
                if (!req.req_value) {
                    return;
                }
                const item = document.createElement('li');
                item.textContent = req.req_value;
                list.appendChild(item);
            });
            detailRequirementsEl.innerHTML = '<strong>Вимоги:</strong>';
            detailRequirementsEl.appendChild(list);
        } else {
            detailRequirementsEl.innerHTML = '<strong>Вимоги:</strong> —';
        }
    }
    if (detailDescriptionEl) {
        detailDescriptionEl.textContent = skill.description ? skill.description : 'Опис відсутній.';
    }
}

function showTooltip(event, skill) {
    if (!tooltipEl) {
        return;
    }
    tooltipEl.textContent = buildTooltipText(skill);
    tooltipEl.style.opacity = '1';
    tooltipEl.setAttribute('aria-hidden', 'false');
    positionTooltip(event);
}

function positionTooltip(event) {
    if (!tooltipEl) {
        return;
    }
    const offset = 16;
    const { pageX, pageY } = event;
    tooltipEl.style.left = `${pageX + offset}px`;
    tooltipEl.style.top = `${pageY + offset}px`;
}

function hideTooltip() {
    if (!tooltipEl) {
        return;
    }
    tooltipEl.style.opacity = '0';
    tooltipEl.setAttribute('aria-hidden', 'true');
}

function renderTabs() {
    if (!treeData || !tabsEl) {
        return;
    }
    tabsEl.innerHTML = '';
    treeData.categories.forEach((category, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `skill-tab ${index === currentCategoryIndex ? 'is-active' : ''}`;
        button.textContent = category.name;
        button.addEventListener('click', () => {
            currentCategoryIndex = index;
            currentSubclassIndex = 0;
            renderAll();
        });
        tabsEl.appendChild(button);
    });
}

function renderSubclasses() {
    if (!treeData || !subclassesEl) {
        return;
    }
    subclassesEl.innerHTML = '';
    const category = treeData.categories[currentCategoryIndex];
    if (!category) {
        return;
    }
    category.subclasses.forEach((subclass, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `skill-subclass ${index === currentSubclassIndex ? 'is-active' : ''}`;
        button.textContent = subclass.name;
        button.addEventListener('click', () => {
            currentSubclassIndex = index;
            renderAll();
        });
        subclassesEl.appendChild(button);
    });
}

function renderGrid() {
    if (!treeData || !gridEl) {
        return;
    }
    gridEl.innerHTML = '';
    const category = treeData.categories[currentCategoryIndex];
    if (!category) {
        return;
    }
    const subclass = category.subclasses[currentSubclassIndex];
    if (!subclass) {
        return;
    }
    subclass.branches.forEach((branch) => {
        const column = document.createElement('div');
        column.className = 'skill-branch';

        const header = document.createElement('div');
        header.className = 'skill-branch__header';
        header.textContent = branch.name;
        column.appendChild(header);

        const list = document.createElement('div');
        list.className = 'skill-branch__nodes';

        branch.skills.forEach((skill) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'skill-node';
            if (!skill.id || !skill.is_enabled) {
                button.classList.add('skill-node--disabled');
            }
            if (!skill.id) {
                button.classList.add('skill-node--missing');
            }
            if (skill.id && activeSkillIds.has(skill.id)) {
                button.classList.add('skill-node--active');
            }
            button.dataset.skillId = skill.id || '';
            button.dataset.levelKey = skill.level_key;
            const label = skill.id && skill.name ? skill.name : skill.level_key;
            const holdIndicator = document.createElement('span');
            holdIndicator.className = 'skill-node__hold';
            const labelSpan = document.createElement('span');
            labelSpan.className = 'skill-node__label';
            labelSpan.textContent = label;
            button.appendChild(holdIndicator);
            button.appendChild(labelSpan);

            button.addEventListener('mouseenter', (event) => {
                showTooltip(event, skill);
            });
            button.addEventListener('mousemove', positionTooltip);
            button.addEventListener('mouseleave', hideTooltip);
            button.addEventListener('focus', (event) => showTooltip(event, skill));
            button.addEventListener('blur', hideTooltip);

            let holdTimer = null;
            let holdClass = null;
            const clearHold = () => {
                if (holdTimer) {
                    clearTimeout(holdTimer);
                    holdTimer = null;
                }
                button.classList.remove('is-holding');
                if (holdClass) {
                    button.classList.remove(holdClass);
                    holdClass = null;
                }
            };

            button.addEventListener('click', () => {
                lastSelectedSkill = skill;
                renderSkillDetail(skill);
            });

            button.addEventListener('pointerdown', (event) => {
                if (event.button !== 0) {
                    return;
                }
                if (!skill.id || !skill.is_enabled) {
                    return;
                }
                event.preventDefault();
                clearHold();
                const isActive = activeSkillIds.has(skill.id);
                holdClass = isActive ? 'hold-drain' : 'hold-fill';
                button.classList.add(holdClass);
                requestAnimationFrame(() => button.classList.add('is-holding'));
                holdTimer = setTimeout(async () => {
                    holdTimer = null;
                    await toggleSkill(skill.id, !isActive);
                    clearHold();
                }, HOLD_DURATION_MS);
            });

            button.addEventListener('pointerup', (event) => {
                if (event.button !== 0) {
                    return;
                }
                clearHold();
            });
            button.addEventListener('pointerleave', clearHold);
            button.addEventListener('pointercancel', clearHold);
            list.appendChild(button);
        });

        column.appendChild(list);
        gridEl.appendChild(column);
    });
}

function renderAll() {
    renderTabs();
    renderSubclasses();
    renderGrid();
    if (lastSelectedSkill) {
        renderSkillDetail(lastSelectedSkill);
    }
}

async function toggleSkill(skillId, isActive) {
    try {
        const response = await fetch('/api/skills/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                profile_id: window.SKILL_PROFILE_ID,
                skill_id: skillId,
                is_active: isActive,
            }),
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            if (payload.error === 'locked') {
                showHint('Locked: активуй попередні рівні.');
                return;
            }
            showHint('Не вдалося оновити навичку.');
            return;
        }
        const payload = await response.json();
        if (Array.isArray(payload.branch_skill_ids)) {
            payload.branch_skill_ids.forEach((id) => activeSkillIds.delete(id));
        }
        if (Array.isArray(payload.active_skill_ids)) {
            payload.active_skill_ids.forEach((id) => activeSkillIds.add(id));
        }
        renderGrid();
    } catch (error) {
        showHint('Помилка мережі.');
    }
}

async function loadSkills() {
    const [treeResponse, stateResponse] = await Promise.all([
        fetch('/api/skills/tree'),
        fetch(`/api/skills/state?profile_id=${window.SKILL_PROFILE_ID}`),
    ]);
    if (!treeResponse.ok || !stateResponse.ok) {
        showHint('Не вдалося завантажити дані.');
        return;
    }
    treeData = await treeResponse.json();
    const state = await stateResponse.json();
    activeSkillIds = new Set(state.active_skill_ids || []);
    renderAll();
}

if (tabsEl && subclassesEl && gridEl) {
    loadSkills();
}
