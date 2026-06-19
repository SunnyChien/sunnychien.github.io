const defaultActivities = [
  { key: "math", label: "数学", score: 10, enabled: true },
  { key: "chinese", label: "语文", score: 10, enabled: true },
  { key: "english", label: "英语", score: 10, enabled: true },
  { key: "eye", label: "视力训练", score: 10, enabled: true },
  { key: "basketball", label: "篮球训练", score: 10, enabled: true },
];

const defaultRewards = [
  { key: "tv", label: "看电视", weeklyLimit: 3, enabled: true },
  { key: "snack", label: "吃零食", weeklyLimit: 3, enabled: true },
];

const defaultSettings = {
  weeklyGoal: 100,
  rewardThreshold: 30,
  activities: defaultActivities,
  rewards: defaultRewards,
  extraBonuses: [],
  requiredActivities: [],
  weeklyGrandRewards: [{ key: 'grand', label: '周大奖励', weeklyLimit: 1, enabled: false }],
};

const storageKey = "study-planner-data";
const SUPABASE_TABLE_NAME = window.SUPABASE_TABLE || "shared_plans";
const SUPABASE_STATE_ID = window.SHARED_PLAN_ID || "family_shared_plan";
const syncStatusElement = document.getElementById("sync-status");

function setSyncStatus(text, status = "pending") {
  if (!syncStatusElement) return;
  syncStatusElement.textContent = text;
  syncStatusElement.className = `sync-status ${status}`;
}

function initializeSyncStatus() {
  if (!syncStatusElement) return;
  if (!isSupabaseReady()) {
    setSyncStatus("Supabase 未配置或未连接，当前仅使用本地数据。", "error");
  } else {
    setSyncStatus("已连接 Supabase，正在检查同步状态…", "pending");
  }
}

function isSupabaseReady() {
  return (
    typeof isSupabaseConfigured === "function" &&
    isSupabaseConfigured() &&
    typeof window.supabaseClient !== "undefined" &&
    window.supabaseClient !== null
  );
}

function getPersistedData() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (error) {
    console.warn("读取本地存储失败", error);
  }
  return { settings: state.settings };
}

function persistData(data) {
  data.updatedAt = Date.now();
  localStorage.setItem(storageKey, JSON.stringify(data));
}

async function saveSettingsToRemote(data) {
  if (!isSupabaseReady()) return;

  const payload = {
    id: SUPABASE_STATE_ID,
    state: data,
    updated_at: new Date().toISOString(),
  };

  const { error } = await window.supabaseClient.from(SUPABASE_TABLE_NAME).upsert(payload, {
    onConflict: "id",
  });

  if (error) {
    console.warn("Supabase 保存失败", error);
    setSyncStatus("Supabase 保存失败，请稍后重试。", "error");
  } else {
    setSyncStatus("设置已同步到 Supabase。", "connected");
  }
}

async function syncSettingsFromRemote() {
  if (!isSupabaseReady()) return;
  setSyncStatus("正在从 Supabase 获取最新设置...", "pending");

  try {
    const localData = getPersistedData();
    const localUpdatedAt = Number(localData.updatedAt) || 0;

    const { data, error } = await supabaseClient
      .from(SUPABASE_TABLE_NAME)
      .select("state, updated_at")
      .eq("id", SUPABASE_STATE_ID)
      .single();

    if (error && error.code !== "PGRST116") {
      console.warn("Supabase 读取失败", error);
      return;
    }

    if (!data) {
      await saveSettingsToRemote(localData);
      return;
    }

    const remoteState = data.state || {};
    const remoteUpdatedAt = new Date(data.updated_at).getTime() || 0;

    if (remoteUpdatedAt > localUpdatedAt) {
      const merged = { ...remoteState, updatedAt: remoteUpdatedAt };
      persistData(merged);
      state.settings = merged.settings || defaultSettings;
      refresh();
      syncForm();
      buildActivityOptions();
      buildExtraBonusOptions();
      setSyncStatus("已从 Supabase 拉取最新设置。", "connected");
    } else if (localUpdatedAt > remoteUpdatedAt) {
      await saveSettingsToRemote(localData);
      setSyncStatus("本地设置较新，已同步到 Supabase。", "connected");
    } else {
      setSyncStatus("Supabase 与本地设置已同步。", "connected");
    }
  } catch (error) {
    console.warn("Supabase 同步失败", error);
  }
}

const weeklyGoalInput = document.getElementById("weekly-goal");
const rewardThresholdInput = document.getElementById("reward-threshold");
const activitiesList = document.getElementById("activities-list");
const extraBonusesList = document.getElementById("extra-bonuses-list");
const requiredActivitiesList = document.getElementById("required-activities-list");
const saveSettingsButton = document.getElementById("save-settings");
const addActivityButton = document.getElementById("add-activity");
const settingsMessage = document.getElementById("settings-message");

let state = loadState();

const supabaseReadyPromise = window.supabaseConfigReady || Promise.resolve();
supabaseReadyPromise.finally(() => initializeSyncStatus());

function loadState() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      const savedSettings = parsed.settings || {};
      const activitiesSource = savedSettings.activities
        ? savedSettings.activities
        : defaultSettings.activities.map((item) => ({
            ...item,
            score: (savedSettings.score && savedSettings.score[item.key]) > 0 ? savedSettings.score[item.key] : item.score,
            enabled: Array.isArray(savedSettings.availableActivities)
              ? savedSettings.availableActivities.includes(item.key)
              : item.enabled,
          }));
      const rewardsSource = savedSettings.rewards
        ? savedSettings.rewards
        : defaultSettings.rewards;
      const activities = activitiesSource.map((item) => {
        // Migrate old bookKeys to new associations format
        let associations = item.associations || {};
        if (!associations.books && Array.isArray(item.bookKeys) && item.bookKeys.length > 0) {
          associations = { ...associations, books: item.bookKeys };
        }
        return {
          key: item.key || `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          label: item.label || item.key || "新活动",
          score: item.score > 0 ? item.score : 10,
          enabled: item.enabled !== false,
          associations,
        };
      });
      const rewards = rewardsSource.map((item) => ({
        key: item.key || `reward-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: item.label || item.key || "奖励",
        weeklyLimit: Number(item.weeklyLimit) > 0 ? Number(item.weeklyLimit) : 1,
        enabled: item.enabled !== false,
      }));
      const extraBonusesSource = savedSettings.extraBonuses || [];
      const extraBonuses = extraBonusesSource.map((item, idx) => ({
        key: item.key || `extra-${Date.now()}-${idx}`,
        activityKey: item.activityKey || (defaultSettings.activities[0] && defaultSettings.activities[0].key),
        requiredCount: Number(item.requiredCount) > 0 ? Number(item.requiredCount) : 1,
        bonusPoints: Number(item.bonusPoints) || 1,
        enabled: item.enabled !== false,
      }));
      const requiredActivitiesSource = savedSettings.requiredActivities || [];
      const requiredActivities = requiredActivitiesSource.map((item, idx) => ({
        key: item.key || `required-${Date.now()}-${idx}`,
        activityKey: item.activityKey || (defaultSettings.activities[0] && defaultSettings.activities[0].key),
        requiredCount: Number(item.requiredCount) > 0 ? Number(item.requiredCount) : 1,
        enabled: item.enabled !== false,
      }));
      let weeklyGrandRewards;
      if (Array.isArray(savedSettings.weeklyGrandRewards)) {
        weeklyGrandRewards = savedSettings.weeklyGrandRewards.map((item) => ({
          key: item.key || `grand-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          label: item.label || '周大奖励',
          weeklyLimit: Number(item.weeklyLimit) > 0 ? Number(item.weeklyLimit) : 1,
          enabled: item.enabled === true,
        }));
      } else if (savedSettings.weeklyGrandReward && typeof savedSettings.weeklyGrandReward === 'object') {
        const old = savedSettings.weeklyGrandReward;
        weeklyGrandRewards = [{
          key: old.key || 'grand',
          label: old.label || '周大奖励',
          weeklyLimit: Number(old.weeklyLimit) > 0 ? Number(old.weeklyLimit) : 1,
          enabled: old.enabled === true,
        }];
      } else {
        weeklyGrandRewards = defaultSettings.weeklyGrandRewards.map((item) => ({ ...item }));
      }
      return {
        settings: {
          ...defaultSettings,
          ...savedSettings,
          rewardThreshold:
            Number(savedSettings.rewardThreshold) > 0
              ? Number(savedSettings.rewardThreshold)
              : defaultSettings.rewardThreshold,
          activities,
          rewards,
          extraBonuses,
          requiredActivities,
          weeklyGrandRewards,
        },
        history: parsed.history || [],
      };
    }
  } catch (error) {
    console.warn("读取本地存储失败", error);
  }
  return { settings: defaultSettings, history: [] };
}

function saveState() {
  const raw = localStorage.getItem(storageKey);
  let parsed = { plan: null, settings: defaultSettings, history: [] };
  try {
    if (raw) {
      parsed = JSON.parse(raw);
    }
  } catch (error) {
    console.warn("读取本地存储失败", error);
  }
  parsed.settings = state.settings;
  parsed.history = state.history;
  parsed.updatedAt = Date.now();
  localStorage.setItem(storageKey, JSON.stringify(parsed));
  saveSettingsToRemote(parsed).catch((error) => console.warn("Supabase 保存失败", error));
}

function createActivityRow(activity) {
  const row = document.createElement("tr");
  row.className = "settings-table-row";
  row.dataset.key = activity.key;

  const enabledCell = document.createElement("td");
  enabledCell.style.textAlign = "center";
  const enabledLabel = document.createElement("label");
  enabledLabel.className = "activity-toggle";
  enabledLabel.innerHTML = `<input type="checkbox" class="activity-enabled" ${activity.enabled ? "checked" : ""}/>`;
  enabledCell.appendChild(enabledLabel);

  const nameCell = document.createElement("td");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "activity-label";
  nameInput.value = activity.label;
  nameInput.placeholder = "活动名称";
  nameCell.appendChild(nameInput);

  const scoreCell = document.createElement("td");
  const scoreInput = document.createElement("input");
  scoreInput.type = "number";
  scoreInput.min = "1";
  scoreInput.step = "1";
  scoreInput.className = "activity-score";
  scoreInput.value = activity.score;
  scoreCell.appendChild(scoreInput);

  const assocCell = document.createElement("td");
  const assocBtn = document.createElement("button");
  assocBtn.type = "button";
  assocBtn.className = "btn btn-secondary";
  const associations = activity.associations || {};
  const assocCount = Object.values(associations).flat().length;
  const hasCategories = (state.settings.books || []).length > 0;
  if (!hasCategories) {
    assocBtn.textContent = "暂无关联";
    assocBtn.disabled = true;
  } else {
    assocBtn.textContent = assocCount > 0 ? "已关联" : "关联";
  }
  assocBtn.style.fontSize = "13px";
  assocBtn.style.padding = "6px 12px";
  assocBtn.addEventListener("click", () => {
    openAssocModal(activity.associations || {}, (newAssociations) => {
      activity.associations = newAssociations;
      const newCount = Object.values(newAssociations).flat().length;
      assocBtn.textContent = newCount > 0 ? "已关联" : "关联";
      row.dataset.associations = JSON.stringify(newAssociations);
    });
  });
  assocCell.appendChild(assocBtn);

  const deleteCell = document.createElement("td");
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "btn btn-delete";
  deleteButton.textContent = "×";
  deleteButton.addEventListener("click", () => {
    if (confirm(`确认删除活动“${activity.label}”？`)) {
      row.remove();
    }
  });
  deleteCell.appendChild(deleteButton);

  row.appendChild(enabledCell);
  row.appendChild(nameCell);
  row.appendChild(scoreCell);
  row.appendChild(assocCell);
  row.appendChild(deleteCell);
  return row;
}

function buildActivityOptions() {
  activitiesList.innerHTML = "";
  state.settings.activities.forEach((activity) => {
    activitiesList.appendChild(createActivityRow(activity));
  });
}

function createExtraBonusRow(item) {
  const row = document.createElement("tr");
  row.className = "settings-table-row";
  row.dataset.key = item.key;

  const enabledCell = document.createElement("td");
  enabledCell.style.textAlign = "center";
  const enabledLabel = document.createElement("label");
  enabledLabel.className = "activity-toggle";
  enabledLabel.innerHTML = `<input type="checkbox" class="extra-enabled" ${item.enabled ? "checked" : ""}/>`;
  enabledCell.appendChild(enabledLabel);

  const activityCell = document.createElement("td");
  const activitySelect = document.createElement("select");
  activitySelect.className = "activity-label";
  (state.settings.activities || []).forEach((act) => {
    const opt = document.createElement("option");
    opt.value = act.key;
    opt.textContent = act.label;
    if (act.key === item.activityKey) opt.selected = true;
    activitySelect.appendChild(opt);
  });
  activityCell.appendChild(activitySelect);

  const requiredCell = document.createElement("td");
  const requiredInput = document.createElement("input");
  requiredInput.type = "number";
  requiredInput.min = "1";
  requiredInput.step = "1";
  requiredInput.className = "activity-score";
  requiredInput.value = item.requiredCount;
  requiredInput.title = "完成次数";
  requiredCell.appendChild(requiredInput);

  const bonusCell = document.createElement("td");
  const bonusInput = document.createElement("input");
  bonusInput.type = "number";
  bonusInput.min = "0";
  bonusInput.step = "1";
  bonusInput.className = "activity-score";
  bonusInput.value = item.bonusPoints;
  bonusInput.title = "加分值";
  bonusCell.appendChild(bonusInput);

  const deleteCell = document.createElement("td");
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "btn btn-delete";
  deleteButton.textContent = "×";
  deleteButton.addEventListener("click", () => {
    if (confirm(`确认删除规则？`)) {
      row.remove();
    }
  });
  deleteCell.appendChild(deleteButton);

  row.appendChild(enabledCell);
  row.appendChild(activityCell);
  row.appendChild(requiredCell);
  row.appendChild(bonusCell);
  row.appendChild(deleteCell);
  return row;
}

function buildExtraBonusOptions() {
  extraBonusesList.innerHTML = "";
  (state.settings.extraBonuses || []).forEach((item) => {
    extraBonusesList.appendChild(createExtraBonusRow(item));
  });
}

function buildActivitiesForSelect() {
  // rebuilds extra bonus rows' activity selects when activities change
  const selects = Array.from(document.querySelectorAll('#extra-bonuses-list select'));
  selects.forEach((sel) => {
    const current = sel.value;
    sel.innerHTML = "";
    (state.settings.activities || []).forEach((act) => {
      const opt = document.createElement('option');
      opt.value = act.key;
      opt.textContent = act.label;
      sel.appendChild(opt);
    });
    sel.value = current;
  });
}

function syncForm() {
  weeklyGoalInput.value = state.settings.weeklyGoal;
  rewardThresholdInput.value = state.settings.rewardThreshold;
}

function buildExtraBonusesFromRows() {
  const rows = Array.from(extraBonusesList.querySelectorAll('.settings-table-row'));
  return rows.map((row, index) => {
    const key = row.dataset.key || `extra-${Date.now()}-${index}`;
    const enabled = row.querySelector('.extra-enabled').checked;
    const activityKey = row.querySelector('select').value;
    const requiredCount = Number(row.querySelectorAll('.activity-score')[0].value) || 1;
    const bonusPoints = Number(row.querySelectorAll('.activity-score')[1].value) || 0;
    return { key, activityKey, requiredCount, bonusPoints, enabled };
  });
}

function showMessage(text, isError = false) {
  settingsMessage.textContent = text;
  settingsMessage.style.background = isError ? "#fee2e2" : "#eef6ff";
  settingsMessage.style.color = isError ? "#991b1b" : "#1e3a8a";
}

function buildActivitiesFromRows() {
  const rows = Array.from(activitiesList.querySelectorAll(".settings-table-row"));
  return rows.map((row, index) => {
    const key = row.dataset.key || `activity-${Date.now()}-${index}`;
    const enabled = row.querySelector(".activity-enabled").checked;
    const label = row.querySelector(".activity-label").value.trim() || `活动 ${index + 1}`;
    const score = Number(row.querySelector(".activity-score").value) || 10;
    let associations = {};
    try {
      associations = JSON.parse(row.dataset.associations || '{}');
    } catch (e) {
      associations = {};
    }
    return { key, label, score, enabled, associations };
  });
}

function addActivityRow() {
  const newActivity = {
    key: `activity-${Date.now()}`,
    label: "新活动",
    score: 10,
    enabled: true,
    associations: {},
  };
  activitiesList.appendChild(createActivityRow(newActivity));
}

function addExtraBonusRow() {
  const newItem = {
    key: `extra-${Date.now()}`,
    activityKey: state.settings.activities[0] ? state.settings.activities[0].key : "",
    requiredCount: 1,
    bonusPoints: 1,
    enabled: true,
  };
  extraBonusesList.appendChild(createExtraBonusRow(newItem));
}

function refresh() {
  syncForm();
  buildActivityOptions();
  buildExtraBonusOptions();
  buildRequiredActivityOptions();
  showMessage("请设置每周目标、每项活动分值以及可用活动。若达到奖励阈值，可在首页领取奖励。");
}

saveSettingsButton.addEventListener("click", () => {
  const activities = buildActivitiesFromRows();
  const activeCount = activities.filter((item) => item.enabled).length;
  if (activeCount === 0) {
    showMessage("请至少开启一项可用活动。", true);
    return;
  }

  const extraBonuses = buildExtraBonusesFromRows();

  const weeklyGoalValue = Number(weeklyGoalInput.value);
  if (weeklyGoalValue > 0) {
    state.settings.weeklyGoal = weeklyGoalValue;
  }
  const thresholdValue = Number(rewardThresholdInput.value);
  if (thresholdValue > 0) {
    state.settings.rewardThreshold = thresholdValue;
  }
  state.settings.activities = activities;
  state.settings.extraBonuses = extraBonuses;
  state.settings.requiredActivities = buildRequiredActivitiesFromRows();
  saveState();
  showMessage("设置已保存，返回计划页查看每日活动与奖励。");
});

addActivityButton.addEventListener("click", addActivityRow);
const addExtraBonusButton = document.getElementById('add-extra-bonus');
addExtraBonusButton.addEventListener('click', addExtraBonusRow);

function createRequiredActivityRow(item) {
  const row = document.createElement("tr");
  row.className = "settings-table-row";
  row.dataset.key = item.key;

  const enabledCell = document.createElement("td");
  enabledCell.style.textAlign = "center";
  const enabledLabel = document.createElement("label");
  enabledLabel.className = "activity-toggle";
  enabledLabel.innerHTML = `<input type="checkbox" class="required-enabled" ${item.enabled ? "checked" : ""}/>`;
  enabledCell.appendChild(enabledLabel);

  const activityCell = document.createElement("td");
  const activitySelect = document.createElement("select");
  activitySelect.className = "activity-label";
  (state.settings.activities || []).forEach((act) => {
    const opt = document.createElement("option");
    opt.value = act.key;
    opt.textContent = act.label;
    if (act.key === item.activityKey) opt.selected = true;
    activitySelect.appendChild(opt);
  });
  activityCell.appendChild(activitySelect);

  const countCell = document.createElement("td");
  const countInput = document.createElement("input");
  countInput.type = "number";
  countInput.min = "1";
  countInput.step = "1";
  countInput.className = "activity-score";
  countInput.value = item.requiredCount;
  countInput.title = "完成次数";
  countCell.appendChild(countInput);

  const deleteCell = document.createElement("td");
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "btn btn-delete";
  deleteButton.textContent = "×";
  deleteButton.addEventListener("click", () => {
    if (confirm('确认删除该必选活动？')) {
      row.remove();
    }
  });
  deleteCell.appendChild(deleteButton);

  row.appendChild(enabledCell);
  row.appendChild(activityCell);
  row.appendChild(countCell);
  row.appendChild(deleteCell);
  return row;
}

function buildRequiredActivitiesFromRows() {
  const rows = Array.from(requiredActivitiesList.querySelectorAll('.settings-table-row'));
  return rows.map((row, index) => {
    const key = row.dataset.key || `required-${Date.now()}-${index}`;
    const enabled = row.querySelector('.required-enabled').checked;
    const activityKey = row.querySelector('select').value;
    const requiredCount = Number(row.querySelector('.activity-score').value) || 1;
    return { key, activityKey, requiredCount, enabled };
  });
}

function buildRequiredActivityOptions() {
  requiredActivitiesList.innerHTML = "";
  (state.settings.requiredActivities || []).forEach((item) => {
    requiredActivitiesList.appendChild(createRequiredActivityRow(item));
  });
}

function addRequiredActivityRow() {
  const newItem = {
    key: `required-${Date.now()}`,
    activityKey: state.settings.activities[0] ? state.settings.activities[0].key : "",
    requiredCount: 1,
    enabled: true,
  };
  requiredActivitiesList.appendChild(createRequiredActivityRow(newItem));
}

const addRequiredActivityButton = document.getElementById('add-required-activity');
addRequiredActivityButton.addEventListener('click', addRequiredActivityRow);

// Association modal
const assocModal = document.getElementById('book-select-modal');
const assocList = document.getElementById('book-select-list');
const assocCountLabel = document.getElementById('book-select-count');
const assocConfirm = document.getElementById('book-select-confirm');
const assocCancel = document.getElementById('book-select-cancel');
const assocModalClose = document.getElementById('book-select-modal-close');

let currentAssocCallback = null;
let currentAssociations = {};

// Category definitions — easily extensible
const ASSOC_CATEGORIES = [
  { key: 'books', label: '图书', getItems: () => state.settings.books || [], itemKey: 'key', itemLabel: 'name' },
];

function openAssocModal(initialAssociations, callback) {
  currentAssociations = JSON.parse(JSON.stringify(initialAssociations || {}));
  currentAssocCallback = callback;
  renderAssocList();
  assocModal.classList.remove('hidden');
}

function closeAssocModal() {
  assocModal.classList.add('hidden');
  currentAssocCallback = null;
  currentAssociations = {};
}

function renderAssocList() {
  let html = '';
  let hasAny = false;

  ASSOC_CATEGORIES.forEach(cat => {
    const items = cat.getItems();
    if (items.length === 0) return;
    hasAny = true;
    const selectedKeys = currentAssociations[cat.key] || [];

    html += `<div style="margin-bottom: 16px;">`;
    html += `<div style="font-size: 13px; font-weight: 600; color: #4b5563; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb;">${cat.label}</div>`;

    items.forEach(item => {
      const checked = selectedKeys.includes(item[cat.itemKey]) ? 'checked' : '';
      html += `
        <label style="display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; cursor: pointer; margin-bottom: 2px; transition: background 0.15s;" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='transparent'">
          <input type="checkbox" class="assoc-checkbox" data-cat="${cat.key}" data-item-key="${item[cat.itemKey]}" ${checked} style="width: 18px; height: 18px; accent-color: #3b82f6;">
          <span style="font-size: 14px; color: #374151;">${item[cat.itemLabel]}</span>
        </label>
      `;
    });
    html += `</div>`;
  });

  if (!hasAny) {
    html = '<div style="color: #94a3b8; font-size: 14px;">暂无可用关联类别。请先在图书馆页面添加书本。</div>';
  }

  assocList.innerHTML = html;
  assocList.querySelectorAll('.assoc-checkbox').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const catKey = e.target.dataset.cat;
      const itemKey = e.target.dataset.itemKey;
      if (!currentAssociations[catKey]) currentAssociations[catKey] = [];
      if (e.target.checked) {
        if (!currentAssociations[catKey].includes(itemKey)) currentAssociations[catKey].push(itemKey);
      } else {
        currentAssociations[catKey] = currentAssociations[catKey].filter(k => k !== itemKey);
      }
      updateAssocCount();
    });
  });
  updateAssocCount();
}

function updateAssocCount() {
  const count = Object.values(currentAssociations).flat().length;
  assocCountLabel.textContent = `已选择 ${count} 项`;
}

assocConfirm.addEventListener('click', () => {
  if (currentAssocCallback) {
    currentAssocCallback(JSON.parse(JSON.stringify(currentAssociations)));
  }
  closeAssocModal();
});

assocCancel.addEventListener('click', closeAssocModal);
assocModalClose.addEventListener('click', closeAssocModal);
assocModal.addEventListener('click', (e) => {
  if (e.target === assocModal) closeAssocModal();
});

refresh();

const settingsSupabaseReady = window.supabaseConfigReady || Promise.resolve();
settingsSupabaseReady
  .then(() => syncSettingsFromRemote())
  .then(() => refresh())
  .catch(() => {
    initializeSyncStatus();
  });

