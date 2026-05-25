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
  weeklyGrandReward: { key: 'grand', label: '周大奖励', enabled: false },
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
      buildRewardOptions();
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
const rewardsList = document.getElementById("rewards-list");
const extraBonusesList = document.getElementById("extra-bonuses-list");
const weeklyGrandLabelInput = document.getElementById('weekly-grand-label');
const weeklyGrandEnabledInput = document.getElementById('weekly-grand-enabled');
const saveSettingsButton = document.getElementById("save-settings");
const addActivityButton = document.getElementById("add-activity");
const addRewardButton = document.getElementById("add-reward");
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
      const activities = activitiesSource.map((item) => ({
        key: item.key || `activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: item.label || item.key || "新活动",
        score: item.score > 0 ? item.score : 10,
        enabled: item.enabled !== false,
      }));
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
      const weeklyGrand = savedSettings.weeklyGrandReward
        ? {
            key: savedSettings.weeklyGrandReward.key || 'grand',
            label: savedSettings.weeklyGrandReward.label || '周大奖励',
            enabled: savedSettings.weeklyGrandReward.enabled === true,
          }
        : defaultSettings.weeklyGrandReward;
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
          weeklyGrandReward: weeklyGrand,
        },
      };
    }
  } catch (error) {
    console.warn("读取本地存储失败", error);
  }
  return { settings: defaultSettings };
}

function saveState() {
  const raw = localStorage.getItem(storageKey);
  let parsed = { plan: null, settings: defaultSettings };
  try {
    if (raw) {
      parsed = JSON.parse(raw);
    }
  } catch (error) {
    console.warn("读取本地存储失败", error);
  }
  parsed.settings = state.settings;
  parsed.updatedAt = Date.now();
  localStorage.setItem(storageKey, JSON.stringify(parsed));
  saveSettingsToRemote(parsed).catch((error) => console.warn("Supabase 保存失败", error));
}

function createActivityRow(activity) {
  const row = document.createElement("div");
  row.className = "activity-row";
  row.dataset.key = activity.key;

  const enabledLabel = document.createElement("label");
  enabledLabel.className = "activity-toggle";
  enabledLabel.innerHTML = `<input type="checkbox" class="activity-enabled" ${activity.enabled ? "checked" : ""}/> 可用`;

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "activity-label";
  nameInput.value = activity.label;
  nameInput.placeholder = "活动名称";

  const scoreInput = document.createElement("input");
  scoreInput.type = "number";
  scoreInput.min = "1";
  scoreInput.step = "1";
  scoreInput.className = "activity-score";
  scoreInput.value = activity.score;

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "btn btn-delete";
  deleteButton.textContent = "删除";
  deleteButton.addEventListener("click", () => {
    if (confirm(`确认删除活动“${activity.label}”？`)) {
      row.remove();
    }
  });

  row.appendChild(enabledLabel);
  row.appendChild(nameInput);
  row.appendChild(scoreInput);
  row.appendChild(deleteButton);
  return row;
}

function buildActivityOptions() {
  activitiesList.innerHTML = "";
  state.settings.activities.forEach((activity) => {
    activitiesList.appendChild(createActivityRow(activity));
  });
}

function createRewardRow(reward) {
  const row = document.createElement("div");
  row.className = "activity-row";
  row.dataset.key = reward.key;

  const enabledLabel = document.createElement("label");
  enabledLabel.className = "activity-toggle";
  enabledLabel.innerHTML = `<input type="checkbox" class="reward-enabled" ${reward.enabled ? "checked" : ""}/> 启用`;

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "activity-label";
  nameInput.value = reward.label;
  nameInput.placeholder = "奖励名称";

  const limitInput = document.createElement("input");
  limitInput.type = "number";
  limitInput.min = "1";
  limitInput.step = "1";
  limitInput.className = "activity-score";
  limitInput.value = reward.weeklyLimit;

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "btn btn-delete";
  deleteButton.textContent = "删除";
  deleteButton.addEventListener("click", () => {
    if (confirm(`确认删除奖励“${reward.label}”？`)) {
      row.remove();
    }
  });

  row.appendChild(enabledLabel);
  row.appendChild(nameInput);
  row.appendChild(limitInput);
  row.appendChild(deleteButton);
  return row;
}

function createExtraBonusRow(item) {
  const row = document.createElement("div");
  row.className = "activity-row";
  row.dataset.key = item.key;

  const enabledLabel = document.createElement("label");
  enabledLabel.className = "activity-toggle";
  enabledLabel.innerHTML = `<input type="checkbox" class="extra-enabled" ${item.enabled ? "checked" : ""}/> 启用`;

  const activitySelect = document.createElement("select");
  activitySelect.className = "activity-label";
  (state.settings.activities || []).forEach((act) => {
    const opt = document.createElement("option");
    opt.value = act.key;
    opt.textContent = act.label;
    if (act.key === item.activityKey) opt.selected = true;
    activitySelect.appendChild(opt);
  });

  const requiredInput = document.createElement("input");
  requiredInput.type = "number";
  requiredInput.min = "1";
  requiredInput.step = "1";
  requiredInput.className = "activity-score";
  requiredInput.value = item.requiredCount;
  requiredInput.title = "完成次数";

  const bonusInput = document.createElement("input");
  bonusInput.type = "number";
  bonusInput.min = "0";
  bonusInput.step = "1";
  bonusInput.className = "activity-score";
  bonusInput.value = item.bonusPoints;
  bonusInput.title = "加分值";

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "btn btn-delete";
  deleteButton.textContent = "删除";
  deleteButton.addEventListener("click", () => {
    if (confirm(`确认删除规则？`)) {
      row.remove();
    }
  });

  row.appendChild(enabledLabel);
  row.appendChild(activitySelect);
  row.appendChild(requiredInput);
  row.appendChild(bonusInput);
  row.appendChild(deleteButton);
  return row;
}

function buildExtraBonusOptions() {
  extraBonusesList.innerHTML = "";
  (state.settings.extraBonuses || []).forEach((item) => {
    extraBonusesList.appendChild(createExtraBonusRow(item));
  });
}

function buildRewardOptions() {
  rewardsList.innerHTML = "";
  state.settings.rewards.forEach((reward) => {
    rewardsList.appendChild(createRewardRow(reward));
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
  if (weeklyGrandLabelInput) weeklyGrandLabelInput.value = (state.settings.weeklyGrandReward && state.settings.weeklyGrandReward.label) || '';
  if (weeklyGrandEnabledInput) weeklyGrandEnabledInput.checked = !!(state.settings.weeklyGrandReward && state.settings.weeklyGrandReward.enabled);
}

function buildExtraBonusesFromRows() {
  const rows = Array.from(extraBonusesList.querySelectorAll('.activity-row'));
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
  const rows = Array.from(activitiesList.querySelectorAll(".activity-row"));
  return rows.map((row, index) => {
    const key = row.dataset.key || `activity-${Date.now()}-${index}`;
    const enabled = row.querySelector(".activity-enabled").checked;
    const label = row.querySelector(".activity-label").value.trim() || `活动 ${index + 1}`;
    const score = Number(row.querySelector(".activity-score").value) || 10;
    return { key, label, score, enabled };
  });
}

function buildRewardsFromRows() {
  const rows = Array.from(rewardsList.querySelectorAll(".activity-row"));
  return rows.map((row, index) => {
    const key = row.dataset.key || `reward-${Date.now()}-${index}`;
    const enabled = row.querySelector(".reward-enabled").checked;
    const label = row.querySelector(".activity-label").value.trim() || `奖励 ${index + 1}`;
    const weeklyLimit = Number(row.querySelector(".activity-score").value) || 1;
    return { key, label, weeklyLimit, enabled };
  });
}

function addActivityRow() {
  const newActivity = {
    key: `activity-${Date.now()}`,
    label: "新活动",
    score: 10,
    enabled: true,
  };
  activitiesList.appendChild(createActivityRow(newActivity));
}

function addRewardRow() {
  const newReward = {
    key: `reward-${Date.now()}`,
    label: "新奖励",
    weeklyLimit: 1,
    enabled: true,
  };
  rewardsList.appendChild(createRewardRow(newReward));
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
  buildRewardOptions();
  buildExtraBonusOptions();
  showMessage("请设置每周目标、每项活动分值以及可用活动。若达到奖励阈值，可在首页领取奖励。");
}

saveSettingsButton.addEventListener("click", () => {
  const activities = buildActivitiesFromRows();
  const activeCount = activities.filter((item) => item.enabled).length;
  if (activeCount === 0) {
    showMessage("请至少开启一项可用活动。", true);
    return;
  }

  const rewards = buildRewardsFromRows();
  const activeRewardCount = rewards.filter((item) => item.enabled).length;
  if (activeRewardCount === 0) {
    showMessage("请至少启用一项奖励。", true);
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
  state.settings.rewards = rewards;
  state.settings.extraBonuses = extraBonuses;
  // weekly grand reward
  state.settings.weeklyGrandReward = {
    key: (state.settings.weeklyGrandReward && state.settings.weeklyGrandReward.key) || `grand`,
    label: weeklyGrandLabelInput.value.trim() || '周大奖励',
    enabled: !!weeklyGrandEnabledInput.checked,
  };
  saveState();
  showMessage("设置已保存，返回计划页查看每日活动与奖励。");
});

addActivityButton.addEventListener("click", addActivityRow);
addRewardButton.addEventListener("click", addRewardRow);
addExtraBonusButton = document.getElementById('add-extra-bonus');
addExtraBonusButton.addEventListener('click', addExtraBonusRow);

refresh();

const settingsSupabaseReady = window.supabaseConfigReady || Promise.resolve();
settingsSupabaseReady
  .then(() => syncSettingsFromRemote())
  .then(() => refresh())
  .catch(() => {
    initializeSyncStatus();
  });

