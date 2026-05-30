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
  weeklyGrandReward: { key: 'grand', label: '周大奖励', weeklyLimit: 1, enabled: false },
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

const dailyRewardsGrid = document.getElementById("daily-rewards-grid");
const weeklyGrandGrid = document.getElementById("weekly-grand-grid");
const saveButton = document.getElementById("save-reward-shop");
const addDailyRewardButton = document.getElementById("add-daily-reward");
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
      const weeklyGrand = savedSettings.weeklyGrandReward
        ? {
            key: savedSettings.weeklyGrandReward.key || 'grand',
            label: savedSettings.weeklyGrandReward.label || '周大奖励',
            weeklyLimit: Number(savedSettings.weeklyGrandReward.weeklyLimit) > 0 ? Number(savedSettings.weeklyGrandReward.weeklyLimit) : 1,
            enabled: savedSettings.weeklyGrandReward.enabled === true,
          }
        : { ...defaultSettings.weeklyGrandReward };
      state = {
        settings: {
          ...defaultSettings,
          ...savedSettings,
          rewards,
          weeklyGrandReward: weeklyGrand,
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

  if (!isGrand) {
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
  } else {
    card.appendChild(enabledToggle);
    card.appendChild(nameInput);
    card.appendChild(countWrap);
  }

  return card;
}

function buildDailyRewardCards() {
  dailyRewardsGrid.innerHTML = "";
  (state.settings.rewards || []).forEach((reward) => {
    dailyRewardsGrid.appendChild(createRewardCard(reward, false));
  });
}

function buildWeeklyGrandCard() {
  weeklyGrandGrid.innerHTML = "";
  const grand = state.settings.weeklyGrandReward || defaultSettings.weeklyGrandReward;
  weeklyGrandGrid.appendChild(createRewardCard(grand, true));
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

function buildWeeklyGrandFromCard() {
  const card = weeklyGrandGrid.querySelector('.reward-card');
  if (!card) return state.settings.weeklyGrandReward || defaultSettings.weeklyGrandReward;
  const enabled = card.querySelector('.reward-enabled').checked;
  const label = card.querySelector('.reward-card-name').value.trim() || '周大奖励';
  const weeklyLimit = Number(card.querySelector('.reward-card-count input').value) || 1;
  return {
    key: card.dataset.key || 'grand',
    label,
    weeklyLimit,
    enabled,
  };
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

function refresh() {
  buildDailyRewardCards();
  buildWeeklyGrandCard();
  showMessage("编辑奖励名称和数量后，点击保存。");
}

saveButton.addEventListener("click", () => {
  const rewards = buildDailyRewardsFromCards();
  const activeRewardCount = rewards.filter((item) => item.enabled).length;
  if (activeRewardCount === 0) {
    showMessage("请至少启用一项每日奖励。", true);
    return;
  }

  const weeklyGrandReward = buildWeeklyGrandFromCard();

  const raw = localStorage.getItem(storageKey);
  let parsed = { plan: null, settings: defaultSettings, history: [] };
  try {
    if (raw) parsed = JSON.parse(raw);
  } catch (error) {
    console.warn("读取本地存储失败", error);
  }

  parsed.settings.rewards = rewards;
  parsed.settings.weeklyGrandReward = weeklyGrandReward;

  persistData(parsed);
  state.settings.rewards = rewards;
  state.settings.weeklyGrandReward = weeklyGrandReward;
  saveSettingsToRemote(parsed);
  showMessage("奖励设置已保存！");
});

addDailyRewardButton.addEventListener("click", addDailyRewardCard);

refresh();

const rewardShopSupabaseReady = window.supabaseConfigReady || Promise.resolve();
rewardShopSupabaseReady
  .then(() => syncSettingsFromRemote())
  .then(() => refresh())
  .catch(() => {
    initializeSyncStatus();
  });
