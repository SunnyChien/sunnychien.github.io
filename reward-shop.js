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

const defaultWeeklyGrandRewards = [
  { key: 'grand', label: '周大奖励', weeklyLimit: 1, enabled: false },
];

const defaultSettings = {
  weeklyGoal: 100,
  rewardThreshold: 30,
  activities: defaultActivities,
  rewards: defaultRewards,
  extraBonuses: [],
  requiredActivities: [],
  weeklyGrandRewards: defaultWeeklyGrandRewards,
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
    if (raw) return JSON.parse(raw);
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
  const { error } = await window.supabaseClient.from(SUPABASE_TABLE_NAME).upsert(payload, { onConflict: "id" });
  if (error) {
    console.warn("Supabase 保存失败", error);
    setSyncStatus("Supabase 保存失败，请稍后重试。", "error");
  } else {
    setSyncStatus("奖励设置已同步到 Supabase。", "connected");
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
      loadStateFromStorage();
      refresh();
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

function migrateGrandReward(savedSettings) {
  if (Array.isArray(savedSettings.weeklyGrandRewards)) {
    return savedSettings.weeklyGrandRewards.map((item) => ({
      key: item.key || `grand-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: item.label || '周大奖励',
      weeklyLimit: Number(item.weeklyLimit) > 0 ? Number(item.weeklyLimit) : 1,
      enabled: item.enabled === true,
    }));
  }
  if (savedSettings.weeklyGrandReward && typeof savedSettings.weeklyGrandReward === 'object') {
    const old = savedSettings.weeklyGrandReward;
    return [{
      key: old.key || 'grand',
      label: old.label || '周大奖励',
      weeklyLimit: Number(old.weeklyLimit) > 0 ? Number(old.weeklyLimit) : 1,
      enabled: old.enabled === true,
    }];
  }
  return defaultWeeklyGrandRewards.map((item) => ({ ...item }));
}

const dailyRewardsGrid = document.getElementById("daily-rewards-grid");
const weeklyGrandGrid = document.getElementById("weekly-grand-grid");
const saveButton = document.getElementById("save-reward-shop");
const addDailyRewardButton = document.getElementById("add-daily-reward");
const addWeeklyGrandButton = document.getElementById("add-weekly-grand");
const messageBox = document.getElementById("reward-shop-message");

let state = {};

function loadStateFromStorage() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      const savedSettings = parsed.settings || {};
      const rewardsSource = savedSettings.rewards || defaultSettings.rewards;
      const rewards = rewardsSource.map((item) => ({
        key: item.key || `reward-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: item.label || item.key || "奖励",
        weeklyLimit: Number(item.weeklyLimit) > 0 ? Number(item.weeklyLimit) : 1,
        enabled: item.enabled !== false,
      }));
      const weeklyGrandRewards = migrateGrandReward(savedSettings);
      state = {
        settings: {
          ...defaultSettings,
          ...savedSettings,
          rewards,
          weeklyGrandRewards,
        },
      };
      return;
    }
  } catch (error) {
    console.warn("读取本地存储失败", error);
  }
  state = { settings: defaultSettings };
}

loadStateFromStorage();

const supabaseReadyPromise = window.supabaseConfigReady || Promise.resolve();
supabaseReadyPromise.finally(() => initializeSyncStatus());

function showMessage(text, isError = false) {
  messageBox.textContent = text;
  messageBox.style.background = isError ? "#fee2e2" : "#eef6ff";
  messageBox.style.color = isError ? "#991b1b" : "#1e3a8a";
}

function createRewardCard(reward, isGrand) {
  const card = document.createElement("div");
  card.className = "reward-card";
  if (isGrand) card.classList.add("reward-card-grand");
  card.dataset.key = reward.key;

  const enabledToggle = document.createElement("label");
  enabledToggle.className = "reward-card-toggle";
  enabledToggle.innerHTML = `<input type="checkbox" class="reward-enabled" ${reward.enabled ? "checked" : ""}/> 启用`;

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "reward-card-name";
  nameInput.value = reward.label;
  nameInput.placeholder = isGrand ? "大奖励名称" : "奖励名称";

  const countWrap = document.createElement("div");
  countWrap.className = "reward-card-count";
  const countInput = document.createElement("input");
  countInput.type = "number";
  countInput.min = "1";
  countInput.step = "1";
  countInput.value = reward.weeklyLimit || 1;
  countInput.title = "每周可用次数";
  const countLabel = document.createElement("span");
  countLabel.textContent = "次/周";
  countWrap.appendChild(countInput);
  countWrap.appendChild(countLabel);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "btn btn-delete";
  deleteButton.textContent = "删除";
  deleteButton.addEventListener("click", () => {
    if (confirm(`确认删除奖励「${nameInput.value}」？`)) {
      card.remove();
    }
  });

  card.appendChild(enabledToggle);
  card.appendChild(nameInput);
  card.appendChild(countWrap);
  card.appendChild(deleteButton);
  return card;
}

function buildDailyRewardCards() {
  dailyRewardsGrid.innerHTML = "";
  (state.settings.rewards || []).forEach((reward) => {
    dailyRewardsGrid.appendChild(createRewardCard(reward, false));
  });
}

function buildWeeklyGrandCards() {
  weeklyGrandGrid.innerHTML = "";
  (state.settings.weeklyGrandRewards || []).forEach((reward) => {
    weeklyGrandGrid.appendChild(createRewardCard(reward, true));
  });
}

function buildDailyRewardsFromCards() {
  const cards = Array.from(dailyRewardsGrid.querySelectorAll('.reward-card'));
  return cards.map((card, index) => {
    const key = card.dataset.key || `reward-${Date.now()}-${index}`;
    const enabled = card.querySelector('.reward-enabled').checked;
    const label = card.querySelector('.reward-card-name').value.trim() || `奖励 ${index + 1}`;
    const weeklyLimit = Number(card.querySelector('.reward-card-count input').value) || 1;
    return { key, label, weeklyLimit, enabled };
  });
}

function buildWeeklyGrandFromCards() {
  const cards = Array.from(weeklyGrandGrid.querySelectorAll('.reward-card'));
  return cards.map((card, index) => {
    const key = card.dataset.key || `grand-${Date.now()}-${index}`;
    const enabled = card.querySelector('.reward-enabled').checked;
    const label = card.querySelector('.reward-card-name').value.trim() || `大奖励 ${index + 1}`;
    const weeklyLimit = Number(card.querySelector('.reward-card-count input').value) || 1;
    return { key, label, weeklyLimit, enabled };
  });
}

function addDailyRewardCard() {
  const newReward = {
    key: `reward-${Date.now()}`,
    label: "新奖励",
    weeklyLimit: 1,
    enabled: true,
  };
  dailyRewardsGrid.appendChild(createRewardCard(newReward, false));
}

function addWeeklyGrandCard() {
  const newGrand = {
    key: `grand-${Date.now()}`,
    label: "新大奖励",
    weeklyLimit: 1,
    enabled: true,
  };
  weeklyGrandGrid.appendChild(createRewardCard(newGrand, true));
}

function refresh() {
  buildDailyRewardCards();
  buildWeeklyGrandCards();
  showMessage("编辑奖励名称和数量后，点击保存。");
}

saveButton.addEventListener("click", () => {
  const rewards = buildDailyRewardsFromCards();
  const activeRewardCount = rewards.filter((item) => item.enabled).length;
  if (activeRewardCount === 0) {
    showMessage("请至少启用一项每日奖励。", true);
    return;
  }

  const weeklyGrandRewards = buildWeeklyGrandFromCards();

  const raw = localStorage.getItem(storageKey);
  let parsed = { plan: null, settings: defaultSettings, history: [] };
  try {
    if (raw) parsed = JSON.parse(raw);
  } catch (error) {
    console.warn("读取本地存储失败", error);
  }

  parsed.settings.rewards = rewards;
  parsed.settings.weeklyGrandRewards = weeklyGrandRewards;
  delete parsed.settings.weeklyGrandReward;

  persistData(parsed);
  state.settings.rewards = rewards;
  state.settings.weeklyGrandRewards = weeklyGrandRewards;
  saveSettingsToRemote(parsed);
  showMessage("奖励设置已保存！");
});

addDailyRewardButton.addEventListener("click", addDailyRewardCard);
addWeeklyGrandButton.addEventListener("click", addWeeklyGrandCard);

refresh();

const rewardShopSupabaseReady = window.supabaseConfigReady || Promise.resolve();
rewardShopSupabaseReady
  .then(() => syncSettingsFromRemote())
  .then(() => refresh())
  .catch(() => {
    initializeSyncStatus();
  });
