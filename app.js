const days = [
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
  "星期日",
];

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

const BACKUP_TABLE_NAME = "shared_plans_backup";
const MAX_BACKUPS = 20;

async function saveBackupSnapshot() {
  if (!isSupabaseReady()) return;
  try {
    // Fetch current remote state before overwriting
    const { data: remote } = await window.supabaseClient
      .from(SUPABASE_TABLE_NAME)
      .select("state, updated_at")
      .eq("id", SUPABASE_STATE_ID)
      .single();

    if (remote && remote.state) {
      const backupPayload = {
        plan_id: SUPABASE_STATE_ID,
        state: remote.state,
        updated_at: remote.updated_at,
        archived_at: new Date().toISOString(),
      };
      await window.supabaseClient.from(BACKUP_TABLE_NAME).insert(backupPayload);

      // Cleanup old backups
      const { data: oldBackups } = await window.supabaseClient
        .from(BACKUP_TABLE_NAME)
        .select("id, archived_at")
        .eq("plan_id", SUPABASE_STATE_ID)
        .order("archived_at", { ascending: false });

      if (oldBackups && oldBackups.length > MAX_BACKUPS) {
        const toDelete = oldBackups.slice(MAX_BACKUPS);
        for (const b of toDelete) {
          await window.supabaseClient.from(BACKUP_TABLE_NAME).delete().eq("id", b.id);
        }
      }
    }
  } catch (e) {
    console.warn("备份快照失败（不影响主流程）", e);
  }
}

async function saveStateToRemote() {
  if (!isSupabaseReady()) return;

  // Always backup before overwriting
  await saveBackupSnapshot();

  const now = Date.now();
  const payload = {
    id: SUPABASE_STATE_ID,
    state,
    updated_at: new Date(now).toISOString(),
  };
  setSyncStatus("正在将数据保存到 Supabase...", "pending");

  const { error } = await window.supabaseClient.from(SUPABASE_TABLE_NAME).upsert(payload, {
    onConflict: "id",
  });

  if (error) {
    console.warn("Supabase 远程保存失败", error);
    setSyncStatus("Supabase 远程保存失败，请稍后重试。", "error");
  } else {
    setSyncStatus("已同步到 Supabase。", "connected");
  }
}

function migrateRemoteState(remoteState, remoteUpdatedAt) {
  const settings = remoteState.settings || {};
  if (!Array.isArray(settings.weeklyGrandRewards) || settings.weeklyGrandRewards.length === 0) {
    if (settings.weeklyGrandReward && typeof settings.weeklyGrandReward === 'object') {
      const old = settings.weeklyGrandReward;
      settings.weeklyGrandRewards = [{
        key: old.key || 'grand',
        label: old.label || '周大奖励',
        weeklyLimit: Number(old.weeklyLimit) > 0 ? Number(old.weeklyLimit) : 1,
        enabled: old.enabled === true,
      }];
    } else if (!Array.isArray(settings.weeklyGrandRewards)) {
      settings.weeklyGrandRewards = defaultSettings.weeklyGrandRewards.map((item) => ({ ...item }));
    }
    delete settings.weeklyGrandReward;
  }
  if (!remoteState.weeklyGrandRewardsClaimed || typeof remoteState.weeklyGrandRewardsClaimed !== 'object' || Array.isArray(remoteState.weeklyGrandRewardsClaimed) || Object.keys(remoteState.weeklyGrandRewardsClaimed).length === 0) {
    if (remoteState.weeklyGrandRewardClaimed && remoteState.weeklyGrandRewardClaimed.claimed) {
      const key = remoteState.weeklyGrandRewardClaimed.rewardKey || 'grand';
      remoteState.weeklyGrandRewardsClaimed = { [key]: { claimed: true, timestamp: remoteState.weeklyGrandRewardClaimed.timestamp } };
    } else if (!remoteState.weeklyGrandRewardsClaimed || !Array.isArray(remoteState.weeklyGrandRewardsClaimed)) {
      remoteState.weeklyGrandRewardsClaimed = {};
    }
    delete remoteState.weeklyGrandRewardClaimed;
  }
  return { ...remoteState, settings, updatedAt: remoteUpdatedAt };
}

async function syncStateFromRemote() {
  if (!isSupabaseReady()) return;
  setSyncStatus("正在从 Supabase 获取最新数据...", "pending");

  try {
    const { data, error } = await window.supabaseClient
      .from(SUPABASE_TABLE_NAME)
      .select("state, updated_at")
      .eq("id", SUPABASE_STATE_ID)
      .single();

    if (error && error.code !== "PGRST116") {
      console.warn("Supabase 读取失败", error);
      setSyncStatus(`Supabase 读取失败: ${error.message || error.code}`, "error");
      return;
    }

    if (!data) {
      await saveStateToRemote();
      return;
    }

    const remoteState = data.state || {};
    const remoteUpdatedAt = new Date(data.updated_at).getTime() || 0;
    const localUpdatedAt = Number(state.updatedAt) || 0;

    const localJson = JSON.stringify(state);
    const remoteJson = JSON.stringify(remoteState);
    const contentDiffers = localJson !== remoteJson;

    if (remoteUpdatedAt > localUpdatedAt) {
      state = migrateRemoteState(remoteState, remoteUpdatedAt);
      window.state = state;
      saveState(false);
      refresh();
      setSyncStatus("已从 Supabase 拉取最新数据。", "connected");
    } else if (localUpdatedAt > remoteUpdatedAt) {
      await saveStateToRemote();
      setSyncStatus("本地数据较新，已同步到 Supabase。", "connected");
    } else if (contentDiffers) {
      // Timestamps equal but content differs: remote wins to prevent accidental overwrite
      state = migrateRemoteState(remoteState, remoteUpdatedAt);
      window.state = state;
      saveState(false);
      refresh();
      setSyncStatus("检测到数据冲突，已采用远程最新版本。", "connected");
    } else {
      setSyncStatus("Supabase 与本地数据已同步。", "connected");
    }
  } catch (error) {
    console.warn("Supabase 同步失败", error);
    setSyncStatus(`Supabase 同步失败: ${error.message || error}`, "error");
  }
}

function syncStateToRemote() {
  saveStateToRemote().catch((error) => console.warn("Supabase 同步失败", error));
}

const planHead = document.getElementById("plan-head");
const planBody = document.getElementById("plan-body");
const weeklyScore = document.getElementById("weekly-score");
const totalPointsLabel = document.getElementById("total-points");
const targetPointsLabel = document.getElementById("target-points");
const makeupNote = document.getElementById("makeup-note");
const reviewList = document.getElementById("review-list");

let state = loadState();
window.state = state;

const supabaseReadyPromise = window.supabaseConfigReady || Promise.resolve();
supabaseReadyPromise.finally(() => initializeSyncStatus());

function getActivityList() {
  return state.settings.activities || defaultSettings.activities;
}

function createDefaultPlan(activities = defaultSettings.activities) {
  return days.map((day) => ({
    day,
    tasks: activities.reduce((obj, activity) => {
      obj[activity.key] = false;
      return obj;
    }, {}),
    taskDetails: {},
    reward: null,
  }));
}

function ensurePlanTasks(plan, activities) {
  plan.forEach((day) => {
    if (!day.tasks) {
      day.tasks = {};
    }
    activities.forEach((activity) => {
      if (!(activity.key in day.tasks)) {
        day.tasks[activity.key] = false;
      }
    });
    if (!day.taskDetails) {
      day.taskDetails = {};
    }
    if (!Object.prototype.hasOwnProperty.call(day, "reward")) {
      day.reward = null;
    }
  });
  return plan;
}

function migrateGrandClaimed(parsed) {
  if (parsed.weeklyGrandRewardsClaimed && typeof parsed.weeklyGrandRewardsClaimed === 'object' && !Array.isArray(parsed.weeklyGrandRewardsClaimed) && Object.keys(parsed.weeklyGrandRewardsClaimed).length > 0) {
    return parsed.weeklyGrandRewardsClaimed;
  }
  if (parsed.weeklyGrandRewardClaimed && parsed.weeklyGrandRewardClaimed.claimed) {
    const key = parsed.weeklyGrandRewardClaimed.rewardKey || 'grand';
    return { [key]: { claimed: true, timestamp: parsed.weeklyGrandRewardClaimed.timestamp } };
  }
  return {};
}

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
      const extraBonusesSource = savedSettings.extraBonuses || [];
      const requiredActivitiesSource = savedSettings.requiredActivities || [];
      const rewards = rewardsSource.map((item) => ({
        key: item.key || `reward-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        label: item.label || item.key || "奖励",
        weeklyLimit: Number(item.weeklyLimit) > 0 ? Number(item.weeklyLimit) : 1,
        enabled: item.enabled !== false,
      }));
      const extraBonuses = extraBonusesSource.map((item, idx) => ({
        key: item.key || `extra-${Date.now()}-${idx}`,
        activityKey: item.activityKey || (defaultSettings.activities[0] && defaultSettings.activities[0].key),
        requiredCount: Number(item.requiredCount) > 0 ? Number(item.requiredCount) : 1,
        bonusPoints: Number(item.bonusPoints) || 0,
        enabled: item.enabled !== false,
      }));
      const requiredActivities = requiredActivitiesSource.map((item, idx) => ({
        key: item.key || `required-${Date.now()}-${idx}`,
        activityKey: item.activityKey || (defaultSettings.activities[0] && defaultSettings.activities[0].key),
        requiredCount: Number(item.requiredCount) > 0 ? Number(item.requiredCount) : 1,
        enabled: item.enabled !== false,
      }));
      let weeklyGrandRewards;
      if (Array.isArray(savedSettings.weeklyGrandRewards) && savedSettings.weeklyGrandRewards.length > 0) {
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
      } else if (Array.isArray(savedSettings.weeklyGrandRewards)) {
        weeklyGrandRewards = [];
      } else {
        weeklyGrandRewards = defaultSettings.weeklyGrandRewards.map((item) => ({ ...item }));
      }
      const activities = activitiesSource.map((item) => {
        let associations = item.associations || {};
        if (!associations.books && Array.isArray(item.bookKeys) && item.bookKeys.length > 0) {
          associations = { ...associations, books: item.bookKeys };
        }
        return {
          key: item.key,
          label: item.label || item.key,
          score: item.score > 0 ? item.score : 10,
          enabled: item.enabled !== false,
          associations,
        };
      });
      let plan = parsed.plan ? ensurePlanTasks(parsed.plan, activities) : createDefaultPlan(activities);
      // normalize day labels like "周一" -> "星期一"
      plan = plan.map((d) => ({ ...d, day: (d.day || '').replace(/^周/, '星期') }));
      return {
        plan,
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
          books: savedSettings.books || [],
        },
        weeklyGrandRewardsClaimed: migrateGrandClaimed(parsed),
        history: parsed.history || [],
        updatedAt: parsed.updatedAt || null,
        lastArchivedWeekId: parsed.lastArchivedWeekId || null,
      };
    }
  } catch (error) {
    console.warn("读取本地存储失败", error);
  }
  return {
    plan: createDefaultPlan(),
    settings: defaultSettings,
    history: [],
  };
}

function saveState(syncRemote = true) {
  state.updatedAt = Date.now();
  window.state = state;
  localStorage.setItem(storageKey, JSON.stringify(state));
  if (syncRemote) {
    syncStateToRemote();
  }
}
window.saveStateToRemote = saveStateToRemote;

function getActiveActivities() {
  return getActivityList().filter((activity) => activity.enabled);
}

function getRewardList() {
  return state.settings.rewards || defaultSettings.rewards;
}

function getRewardByKey(key) {
  return getRewardList().find((reward) => reward.key === key) || null;
}

function getExtraBonuses() {
  return state.settings.extraBonuses || [];
}

function computeExtraBonusForRule(rule) {
  if (!rule || !rule.enabled) return 0;
  const count = state.plan.reduce((c, day) => (day.tasks[rule.activityKey] ? c + 1 : c), 0);
  if (rule.requiredCount <= 0) return 0;
  const times = Math.floor(count / rule.requiredCount);
  return times * (Number(rule.bonusPoints) || 0);
}

function getExtraBonusTotal() {
  return getExtraBonuses().reduce((sum, rule) => sum + computeExtraBonusForRule(rule), 0);
}

function isWeeklyGoalReached() {
  const total = getTotalPoints();
  const goal = state.settings.weeklyGoal || defaultSettings.weeklyGoal;
  return total >= goal;
}

function isWeeklyGrandClaimed(rewardKey) {
  if (!state.weeklyGrandRewardsClaimed) return false;
  if (rewardKey) return !!(state.weeklyGrandRewardsClaimed[rewardKey] && state.weeklyGrandRewardsClaimed[rewardKey].claimed);
  return Object.values(state.weeklyGrandRewardsClaimed).some(c => c && c.claimed);
}

function getGrandRewardRemaining(grand) {
  if (!state.weeklyGrandRewardsClaimed) return grand.weeklyLimit || 1;
  const claimed = state.weeklyGrandRewardsClaimed[grand.key];
  if (!claimed || !claimed.claimed) return grand.weeklyLimit || 1;
  return (grand.weeklyLimit || 1) - 1;
}

function openGrandRewardModal() {
  const modal = document.getElementById("grand-reward-modal");
  const options = document.getElementById("grand-reward-options");
  options.innerHTML = "";

  const grands = (state.settings.weeklyGrandRewards || []).filter(g => g.enabled);
  const { allCompleted } = getRequiredActivitiesCompletion();

  if (!allCompleted) {
    const { details } = getRequiredActivitiesCompletion();
    const incompleteList = details.filter(d => !d.completed).map(d => `${d.activityLabel}（${d.completedCount}/${d.requiredCount}次）`).join('、');
    const msg = document.createElement("p");
    msg.textContent = `还有必选活动未完成：${incompleteList}\n完成所有必选活动后才能领取本周大奖励！`;
    options.appendChild(msg);
    modal.classList.remove("hidden");
    return;
  }

  const claimedGrands = grands.filter(g => isWeeklyGrandClaimed(g.key));
  const unclaimedGrands = grands.filter(g => !isWeeklyGrandClaimed(g.key));

  if (claimedGrands.length === 0 && unclaimedGrands.length === 0) {
    const msg = document.createElement("p");
    msg.textContent = "暂无可用的大奖励。";
    options.appendChild(msg);
    modal.classList.remove("hidden");
    return;
  }

  claimedGrands.forEach((grand) => {
    const item = document.createElement("div");
    item.className = "reward-item";
    const text = document.createElement("span");
    text.textContent = `已领取：${grand.label}`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "取消领取";
    button.addEventListener("click", () => {
      if (!state.weeklyGrandRewardsClaimed) state.weeklyGrandRewardsClaimed = {};
      state.weeklyGrandRewardsClaimed[grand.key] = { claimed: false };
      saveState();
      closeGrandRewardModal();
      openGrandRewardModal();
    });
    item.appendChild(text);
    item.appendChild(button);
    options.appendChild(item);
  });

  if (unclaimedGrands.length > 0) {
    unclaimedGrands.forEach((grand) => {
      const item = document.createElement("div");
      item.className = "reward-item";
      const text = document.createElement("span");
      text.textContent = grand.label;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "选择";
      button.addEventListener("click", () => {
        if (!state.weeklyGrandRewardsClaimed) state.weeklyGrandRewardsClaimed = {};
        state.weeklyGrandRewardsClaimed[grand.key] = { claimed: true, timestamp: Date.now() };
        saveState();
        closeGrandRewardModal();
        refresh();
      });
      item.appendChild(text);
      item.appendChild(button);
      options.appendChild(item);
    });
  } else if (claimedGrands.length > 0) {
    const hint = document.createElement("p");
    hint.style.marginTop = "12px";
    hint.style.color = "#64748b";
    hint.textContent = "所有大奖励已领取，可取消后重新选择。";
    options.appendChild(hint);
  }

  modal.classList.remove("hidden");
}

function closeGrandRewardModal() {
  document.getElementById("grand-reward-modal").classList.add("hidden");
}

function renderWeeklyScoreBadge(totalPoints, weeklyGoal) {
  if (!weeklyScore) return;
  const { allCompleted } = getRequiredActivitiesCompletion();
  weeklyScore.classList.toggle('reached', totalPoints >= weeklyGoal && allCompleted);
  weeklyScore.innerHTML = `<div class="badge-text">${totalPoints} / ${weeklyGoal} 分</div>`;
  const grands = state.settings.weeklyGrandRewards || [];
  const enabledGrands = grands.filter(g => g.enabled);
  if (totalPoints >= weeklyGoal && enabledGrands.length > 0) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-save';
    btn.style.marginTop = '8px';
    const claimedCount = enabledGrands.filter(g => isWeeklyGrandClaimed(g.key)).length;
    if (claimedCount === enabledGrands.length) {
      btn.textContent = '大奖励已领取';
    } else if (!allCompleted) {
      btn.textContent = '🏆 大奖励（必选活动未完成）';
      btn.disabled = true;
      btn.style.opacity = '0.6';
      btn.style.cursor = 'not-allowed';
    } else {
      btn.textContent = '🏆 领取本周大奖励';
    }
    btn.addEventListener('click', () => openGrandRewardModal());
    weeklyScore.appendChild(btn);
  }
}

function getWeeklyRewardUsage() {
  return state.plan.reduce((usage, day) => {
    if (day.reward) {
      usage[day.reward] = (usage[day.reward] || 0) + 1;
    }
    return usage;
  }, {});
}

function getRewardRemaining(reward) {
  const usage = getWeeklyRewardUsage();
  return reward.weeklyLimit - (usage[reward.key] || 0);
}

let rewardSelectionDay = null;

function getAvailableRewards(day = null) {
  const rewards = getRewardList().filter((reward) => reward.enabled && getRewardRemaining(reward) > 0);
  if (day && day.reward) {
    const current = getRewardByKey(day.reward);
    if (current && !rewards.some((item) => item.key === current.key)) {
      rewards.push(current);
    }
  }
  return rewards;
}

function openRewardModal(day) {
  rewardSelectionDay = day;
  const modal = document.getElementById("reward-modal");
  const options = document.getElementById("reward-options");
  const selectedReward = getRewardByKey(day.reward);
  const availableRewards = getAvailableRewards(day);
  options.innerHTML = "";

  if (selectedReward) {
    const currentRow = document.createElement("div");
    currentRow.className = "reward-item";
    const currentText = document.createElement("span");
    currentText.textContent = `当前已选：${selectedReward.label}`;
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.textContent = "取消奖励";
    clearButton.addEventListener("click", () => {
      day.reward = null;
      saveState();
      closeRewardModal();
      refresh();
    });
    currentRow.appendChild(currentText);
    currentRow.appendChild(clearButton);
    options.appendChild(currentRow);
  }

  const otherRewards = selectedReward
    ? availableRewards.filter((reward) => reward.key !== selectedReward.key)
    : availableRewards;

  if (otherRewards.length === 0) {
    const message = document.createElement("p");
    message.textContent = selectedReward
      ? "当前已选择奖励，暂无其他可选奖励。"
      : "本周奖励次数已用完，无法再领取。";
    options.appendChild(message);
  } else {
    otherRewards.forEach((reward) => {
      const item = document.createElement("div");
      item.className = "reward-item";
      const remainingCount = getRewardRemaining(reward);
      const text = document.createElement("span");
      text.textContent = `${reward.label}（剩余 ${remainingCount} 次）`;
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "选择";
      button.addEventListener("click", () => selectReward(reward));
      item.appendChild(text);
      item.appendChild(button);
      options.appendChild(item);
    });
  }

  modal.classList.remove("hidden");
}

function closeRewardModal() {
  document.getElementById("reward-modal").classList.add("hidden");
  rewardSelectionDay = null;
}

function selectReward(reward) {
  if (!rewardSelectionDay) {
    return;
  }
  rewardSelectionDay.reward = reward.key;
  saveState();
  closeRewardModal();
  refresh();
}

function getDayPoints(day) {
  return getActiveActivities().reduce((sum, activity) => {
    if (!day.tasks[activity.key]) return sum;
    const detail = day.taskDetails && day.taskDetails[activity.key] || {};
    const quantity = detail.quantity || 1;
    return sum + (activity.score * quantity);
  }, 0);
}

function getFormattedDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const weekMap = ["日", "一", "二", "三", "四", "五", "六"];
  const w = weekMap[now.getDay()];
  return `今天是${y}年${m}月${d}日 星期${w}`;
}

function renderDateHeader() {
  const el = document.getElementById("date-heading");
  if (el) {
    el.textContent = getFormattedDate();
  }
}

function getTodayColumnIndex() {
  // JS getDay(): 0=Sun,1=Mon,... map to plan index Monday=0...Sunday=6
  const g = new Date().getDay();
  return (g + 6) % 7;
}

function computeDailyExtraBonuses() {
  const extras = getExtraBonuses().filter((r) => r.enabled && Number(r.requiredCount) > 0 && Number(r.bonusPoints) > 0);
  const daily = state.plan.map(() => 0);
  if (extras.length === 0) return daily;
  extras.forEach((rule) => {
    let count = 0;
    state.plan.forEach((day, idx) => {
      if (day.tasks && day.tasks[rule.activityKey]) {
        count += 1;
        if (count % Number(rule.requiredCount) === 0) {
          daily[idx] += Number(rule.bonusPoints) || 0;
        }
      }
    });
  });
  return daily;
}

function getTotalPoints() {
  const base = state.plan.reduce((sum, day) => sum + getDayPoints(day), 0);
  const extra = getExtraBonusTotal();
  return base + extra;
}

function getCompletedTasks(day) {
  return getActiveActivities().filter((activity) => day.tasks[activity.key]).length;
}

function createHeaderCell(text) {
  const th = document.createElement("th");
  th.textContent = text;
  return th;
}
function buildTable() {
  const activeActivities = getActiveActivities();
  planHead.innerHTML = "";

  // Header: first cell labels activities, then day columns
  const headerRow = document.createElement("tr");
  headerRow.appendChild(createHeaderCell("活动"));
  const todayIndex = getTodayColumnIndex();
  state.plan.forEach((day, dayIndex) => {
    const th = createHeaderCell(day.day);
    if (dayIndex === todayIndex) th.classList.add('today-column');
    headerRow.appendChild(th);
  });
  planHead.appendChild(headerRow);

  // Body: one row per activity, with checkbox per day
  planBody.innerHTML = "";
  activeActivities.forEach((activity) => {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    nameCell.textContent = activity.label;
    nameCell.className = "day-name";
    row.appendChild(nameCell);

    state.plan.forEach((day, dayIndex) => {
      const cell = document.createElement("td");
      if (dayIndex === todayIndex) cell.classList.add('today-column');

      const isCompleted = !!day.tasks[activity.key];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = isCompleted ? "task-btn task-btn-done" : "task-btn task-btn-todo";
      btn.textContent = isCompleted ? "✓" : "+";
      btn.title = isCompleted ? "已完成，点击查看详情" : "点击完成";
      btn.addEventListener("click", () => {
        openTaskDetailModal(day, activity, dayIndex);
      });
      cell.appendChild(btn);
      row.appendChild(cell);
    });

    // no trailing cell for each activity row; day totals are shown in footer
    planBody.appendChild(row);
  });

  // Footer row: per-day points and reward buttons
  const footer = document.createElement("tr");
  const footerLabel = document.createElement("td");
  footerLabel.textContent = "当日积分";
  footerLabel.className = "day-name";
  footer.appendChild(footerLabel);

  const dailyExtras = computeDailyExtraBonuses();
  state.plan.forEach((day, dayIndex) => {
    const cell = document.createElement("td");
    if (dayIndex === todayIndex) cell.classList.add('today-column');
    const points = getDayPoints(day);
    const badge = document.createElement("span");
    badge.className = "points-badge";
    badge.textContent = `${points} 分`;
    cell.appendChild(badge);

    const rewardButton = document.createElement("button");
    rewardButton.type = "button";
    rewardButton.className = "btn btn-reward";
    const selectedReward = getRewardByKey(day.reward);
    const threshold = Number(state.settings.rewardThreshold) || defaultSettings.rewardThreshold;
    if (selectedReward) {
      rewardButton.textContent = `已领取：${selectedReward.label}`;
      rewardButton.disabled = false;
      rewardButton.addEventListener("click", () => openRewardModal(day));
    } else if (points >= threshold) {
      const availableRewards = getAvailableRewards(day);
      if (availableRewards.length > 0) {
        rewardButton.textContent = "领取奖励";
        rewardButton.disabled = false;
        rewardButton.addEventListener("click", () => openRewardModal(day));
      } else {
        rewardButton.textContent = "奖励次数已用完";
        rewardButton.disabled = true;
      }
    } else {
      rewardButton.textContent = `未达标 ${threshold} 分`;
      rewardButton.disabled = true;
    }
    cell.appendChild(rewardButton);
    if (dailyExtras[dayIndex] && dailyExtras[dayIndex] > 0) {
      const note = document.createElement('div');
      note.className = 'extra-bonus-note';
      note.textContent = `额外加${dailyExtras[dayIndex]}分`;
      cell.appendChild(note);
    }
    footer.appendChild(cell);
  });

  planBody.appendChild(footer);
}

function buildSummary() {
  const activeActivities = getActiveActivities();
  const totalPoints = getTotalPoints();
  const weeklyGoal = state.settings.weeklyGoal;

  renderWeeklyScoreBadge(totalPoints, weeklyGoal);
  totalPointsLabel.textContent = `${totalPoints}`;
  targetPointsLabel.textContent = `${weeklyGoal}`;

  if (activeActivities.length === 0) {
    makeupNote.textContent = "当前没有设置可选活动，请前往设置页面添加。";
    reviewList.innerHTML = "<p>请先设置每日可进行的活动，再开始打卡。</p>";
    return;
  }

  if (totalPoints >= weeklyGoal) {
    makeupNote.textContent = "已完成目标，继续保持！";
    reviewList.innerHTML = "<p>本周积分已达标，可进行下周新计划。</p>";
  } else {
    const missing = weeklyGoal - totalPoints;
    makeupNote.textContent = `还差 ${missing} 分`;

    const incompleteDays = state.plan
      .map((day) => ({
        day: day.day,
        count: getCompletedTasks(day),
      }))
      .filter((item) => item.count < 2);

    const lines = [
      `<p>建议补全：还差 ${missing} 分，周末可补做以下活动。</p>`,
    ];

    if (incompleteDays.length > 0) {
      lines.push("<ul>");
      incompleteDays.forEach((item) => {
        lines.push(`<li>${item.day} 已完成 ${item.count} 项，建议至少完成 2 项。</li>`);
      });
      lines.push("</ul>");
    }

    reviewList.innerHTML = lines.join("");
  }

  // Extra bonus breakdown
  const extras = getExtraBonuses();
  if (extras.length > 0) {
    const applied = extras
      .map((rule) => {
        const points = computeExtraBonusForRule(rule);
        const act = (state.settings.activities || []).find((a) => a.key === rule.activityKey);
        const name = act ? act.label : rule.activityKey;
        return `${name}: 完成 ${rule.requiredCount} 次得 ${rule.bonusPoints} 分 — 本周获得 ${points} 分`;
      })
      .filter((s) => s.includes('本周获得 0') === false);
    if (applied.length > 0) {
      const extraHtml = [`<h4>额外加分</h4>`, '<ul>'];
      applied.forEach((line) => extraHtml.push(`<li>${line}</li>`));
      extraHtml.push('</ul>');
      reviewList.insertAdjacentHTML('beforeend', extraHtml.join(''));
    }
  }
}

function getRequiredActivitiesCompletion() {
  const required = (state.settings.requiredActivities || []).filter(r => r.enabled);
  if (required.length === 0) return { allCompleted: true, details: [] };
  
  const details = required.map(req => {
    const activity = state.settings.activities.find(a => a.key === req.activityKey);
    const activityLabel = activity ? activity.label : req.activityKey;
    let completedCount = 0;
    state.plan.forEach(day => {
      if (day.tasks[req.activityKey]) completedCount++;
    });
    return {
      key: req.key,
      activityLabel,
      requiredCount: req.requiredCount,
      completedCount,
      completed: completedCount >= req.requiredCount,
    };
  });
  
  const allCompleted = details.every(d => d.completed);
  return { allCompleted, details };
}

function renderProgressTracker() {
  const container = document.getElementById('progress-tracker');
  if (!container) return;

  const weeklyGoal = state.settings.weeklyGoal || defaultSettings.weeklyGoal;
  const todayIndex = getTodayColumnIndex();
  const dayOfWeek = todayIndex + 1;
  const totalDays = 7;

  const avgPercent = Math.round((dayOfWeek / totalDays) * 100);

  let lastWeekPercent = 0;
  let lastWeekLabel = '0%';
  if (state.history && state.history.length > 0) {
    const lastWeek = state.history[0];
    const lastWeekGoal = lastWeek.weeklyGoal || weeklyGoal;
    let lastWeekPointsByToday = 0;
    if (lastWeek.plan) {
      for (let i = 0; i <= todayIndex && i < lastWeek.plan.length; i++) {
        const day = lastWeek.plan[i];
        const activities = (lastWeek.settings && lastWeek.settings.activities) || [];
        const activeActs = activities.filter(a => a.enabled);
        const dayPts = activeActs.reduce((sum, a) => sum + (day.tasks && day.tasks[a.key] ? a.score : 0), 0);
        lastWeekPointsByToday += dayPts;
      }
      const lastWeekExtras = (lastWeek.settings && lastWeek.settings.extraBonuses) || [];
      lastWeekExtras.forEach(rule => {
        if (!rule.enabled || Number(rule.requiredCount) <= 0 || Number(rule.bonusPoints) <= 0) return;
        let count = 0;
        for (let i = 0; i <= todayIndex && i < lastWeek.plan.length; i++) {
          if (lastWeek.plan[i].tasks && lastWeek.plan[i].tasks[rule.activityKey]) count += 1;
        }
        const times = Math.floor(count / Number(rule.requiredCount));
        lastWeekPointsByToday += times * (Number(rule.bonusPoints) || 0);
      });
    }
    lastWeekPercent = lastWeekGoal > 0 ? Math.min(Math.round((lastWeekPointsByToday / lastWeekGoal) * 100), 100) : 0;
    lastWeekLabel = `${lastWeekPointsByToday}/${lastWeekGoal}`;
  } else {
    lastWeekLabel = '暂无数据';
  }

  const thisWeekPoints = getTotalPoints();
  const thisWeekPercent = weeklyGoal > 0 ? Math.min(Math.round((thisWeekPoints / weeklyGoal) * 100), 100) : 0;
  const thisWeekLabel = `${thisWeekPoints}/${weeklyGoal}`;

  const bars = [
    { label: '平均进度', percent: avgPercent, display: `${dayOfWeek}/${totalDays}`, cls: 'avg', runner: '🏃' },
    { label: '上周同期', percent: lastWeekPercent, display: lastWeekLabel, cls: 'last-week', runner: '🏃‍♀️' },
    { label: '本周进度', percent: thisWeekPercent, display: thisWeekLabel, cls: 'this-week', runner: '🏃‍♂️' },
  ];

  let html = '<div class="progress-tracker">';
  bars.forEach(bar => {
    const fillWidth = Math.max(bar.percent, 0);
    const runnerClass = fillWidth === 0 ? 'progress-runner at-start' : 'progress-runner';
    html += `
      <div class="progress-row">
        <span class="progress-label">${bar.label}</span>
        <div class="progress-bar-wrap">
          <div class="progress-bar-fill ${bar.cls}" style="width: ${fillWidth}%;">
            <span class="${runnerClass}">${bar.runner}</span>
          </div>
          <span class="progress-goal-mark">🚩</span>
        </div>
        <span class="progress-percent">${bar.display}</span>
      </div>`;
  });
  html += '</div>';
  container.innerHTML = html;
}

function renderRequiredActivitiesStatus() {
  const container = document.getElementById('required-activities-status');
  if (!container) return;
  
  const { allCompleted, details } = getRequiredActivitiesCompletion();
  
  if (details.length === 0) {
    container.innerHTML = '';
    return;
  }
  
  let html = `<div style="border: 1px solid rgba(99, 102, 241, 0.14); border-radius: 16px; padding: 16px; background: #f8fafc;">
    <h3 style="margin: 0 0 12px; font-size: 1rem; color: #1e293b;">📋 本周必选活动</h3>
    <div style="display: flex; flex-wrap: wrap; gap: 12px;">`;
  
  details.forEach(d => {
    const statusColor = d.completed ? '#10b981' : '#f59e0b';
    const statusIcon = d.completed ? '✅' : '⏳';
    html += `<div style="background: #fff; border-radius: 12px; padding: 10px 16px; border: 1px solid #e5e7eb; display: flex; align-items: center; gap: 8px;">
      <span>${statusIcon}</span>
      <span style="font-weight: 600; color: #1e293b;">${d.activityLabel}</span>
      <span style="color: ${statusColor}; font-weight: 500;">${d.completedCount} / ${d.requiredCount} 次</span>
    </div>`;
  });
  
  html += `</div>`;
  
  if (allCompleted) {
    html += `<div style="margin-top: 10px; color: #10b981; font-size: 0.9rem; font-weight: 500;">✅ 所有必选活动已完成，满足大奖励领取条件！</div>`;
  } else {
    html += `<div style="margin-top: 10px; color: #f59e0b; font-size: 0.9rem; font-weight: 500;">⏳ 完成所有必选活动后才能领取本周大奖励</div>`;
  }
  
  html += `</div>`;
  container.innerHTML = html;
}

function refresh() {
  buildTable();
  buildSummary();
  renderProgressTracker();
  renderRequiredActivitiesStatus();
}

function getBooks() {
  return state.settings.books || [];
}

let currentTaskDetail = null;

function openTaskDetailModal(day, activity, dayIndex) {
  currentTaskDetail = { day, activity, dayIndex };
  const modal = document.getElementById("task-detail-modal");
  const title = document.getElementById("task-detail-title");
  const recorderOptions = document.getElementById("recorder-options");
  const assocContainer = document.getElementById("assoc-select-container");
  const quantityInput = document.getElementById("task-quantity");
  const infoDiv = document.getElementById("task-current-info");
  const infoText = infoDiv.querySelector("p");
  const clearBtn = document.getElementById("task-detail-clear");
  const saveBtn = document.getElementById("task-detail-save");

  title.textContent = `${day.day} · ${activity.label}`;

  // Recorder selection - clone to remove old listeners
  const detail = day.taskDetails && day.taskDetails[activity.key] || {};
  const currentRecorder = detail.recorder || "";
  recorderOptions.querySelectorAll(".recorder-btn").forEach(btn => {
    const clone = btn.cloneNode(true);
    clone.classList.toggle("selected", clone.dataset.value === currentRecorder);
    clone.addEventListener("click", () => {
      recorderOptions.querySelectorAll(".recorder-btn").forEach(b => b.classList.remove("selected"));
      clone.classList.add("selected");
    });
    btn.replaceWith(clone);
  });

  // Association selections - dynamically generate for each category
  assocContainer.innerHTML = "";
  const activityAssociations = activity.associations || {};
  const detailAssociations = detail.associations || {};

  const categories = [
    { key: 'books', label: '图书', getItems: () => state.settings.books || [], itemKey: 'key', itemLabel: 'name' },
  ];

  categories.forEach(cat => {
    const items = cat.getItems();
    const linkedKeys = activityAssociations[cat.key] || [];
    if (linkedKeys.length === 0 || items.length === 0) return;

    const group = document.createElement("div");
    group.className = "form-group";
    group.style.display = "flex";
    group.style.flexDirection = "column";

    const label = document.createElement("label");
    label.textContent = `选择${cat.label}`;
    group.appendChild(label);

    const select = document.createElement("select");
    select.className = "form-select task-assoc-select";
    select.dataset.catKey = cat.key;

    const emptyOpt = document.createElement("option");
    emptyOpt.value = "";
    emptyOpt.textContent = `不选择${cat.label}`;
    select.appendChild(emptyOpt);

    items.forEach(item => {
      if (linkedKeys.includes(item[cat.itemKey])) {
        const opt = document.createElement("option");
        opt.value = item[cat.itemKey];
        opt.textContent = item[cat.itemLabel];
        select.appendChild(opt);
      }
    });

    select.value = detailAssociations[cat.key] || "";
    group.appendChild(select);
    assocContainer.appendChild(group);
  });

  // Quantity
  quantityInput.value = detail.quantity || 1;

  // Current info
  const isCompleted = !!day.tasks[activity.key];
  if (isCompleted) {
    infoDiv.style.display = "block";
    clearBtn.style.display = "inline-block";
    const parts = [];
    if (detail.recorder) parts.push(`录入人：${detail.recorder}`);
    const qty = detail.quantity || 1;
    if (qty > 1) parts.push(`数量：${qty}`);

    // Show all association selections
    categories.forEach(cat => {
      const items = cat.getItems();
      const selectedKey = detailAssociations[cat.key];
      if (selectedKey) {
        const item = items.find(i => i[cat.itemKey] === selectedKey);
        parts.push(`${cat.label}：${item ? item[cat.itemLabel] : selectedKey}`);
      }
    });
    // Backward compat for old bookKey
    if (detail.bookKey && !detailAssociations.books) {
      const book = getBooks().find(b => b.key === detail.bookKey);
      parts.push(`图书：${book ? book.name : detail.bookKey}`);
    }

    infoText.textContent = parts.length > 0 ? `当前记录：${parts.join("，")}` : "当前状态：已完成";
    saveBtn.textContent = "更新";
  } else {
    infoDiv.style.display = "none";
    clearBtn.style.display = "none";
    saveBtn.textContent = "确认完成";
  }

  modal.classList.remove("hidden");
}

function closeTaskDetailModal() {
  document.getElementById("task-detail-modal").classList.add("hidden");
  currentTaskDetail = null;
}

function saveTaskDetail() {
  if (!currentTaskDetail) return;
  const { day, activity } = currentTaskDetail;

  const selectedRecorder = document.querySelector(".recorder-btn.selected");
  const recorder = selectedRecorder ? selectedRecorder.dataset.value : "";

  if (!recorder) {
    alert("请选择录入人");
    return;
  }

  const quantity = Math.max(1, parseInt(document.getElementById("task-quantity").value, 10) || 1);

  // Collect association selections from dynamically generated selects
  const associations = {};
  let bookKey = "";
  document.querySelectorAll(".task-assoc-select").forEach(select => {
    const catKey = select.dataset.catKey;
    const value = select.value;
    if (value) {
      associations[catKey] = value;
      if (catKey === 'books') bookKey = value;
    }
  });

  if (!day.taskDetails) day.taskDetails = {};
  day.taskDetails[activity.key] = {
    recorder,
    quantity: quantity > 1 ? quantity : undefined,
    associations: Object.keys(associations).length > 0 ? associations : undefined,
    bookKey: bookKey || undefined,
  };
  day.tasks[activity.key] = true;

  saveState();
  closeTaskDetailModal();
  refresh();
}

function clearTaskDetail() {
  if (!currentTaskDetail) return;
  const { day, activity } = currentTaskDetail;

  day.tasks[activity.key] = false;
  if (day.taskDetails && day.taskDetails[activity.key]) {
    delete day.taskDetails[activity.key];
  }

  saveState();
  closeTaskDetailModal();
  refresh();
}

function attachTaskDetailModalHandlers() {
  const modal = document.getElementById("task-detail-modal");
  document.getElementById("task-detail-modal-close").addEventListener("click", closeTaskDetailModal);
  document.getElementById("task-detail-modal-cancel").addEventListener("click", closeTaskDetailModal);
  document.getElementById("task-detail-save").addEventListener("click", saveTaskDetail);
  document.getElementById("task-detail-clear").addEventListener("click", clearTaskDetail);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeTaskDetailModal();
    }
  });
}

function attachRewardModalHandlers() {
  const modal = document.getElementById("reward-modal");
  document.getElementById("reward-modal-close").addEventListener("click", closeRewardModal);
  document.getElementById("reward-modal-cancel").addEventListener("click", closeRewardModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeRewardModal();
    }
  });

  const grandModal = document.getElementById("grand-reward-modal");
  document.getElementById("grand-reward-modal-close").addEventListener("click", closeGrandRewardModal);
  document.getElementById("grand-reward-modal-cancel").addEventListener("click", closeGrandRewardModal);
  grandModal.addEventListener("click", (event) => {
    if (event.target === grandModal) {
      closeGrandRewardModal();
    }
  });
}

renderDateHeader();
attachRewardModalHandlers();
attachTaskDetailModalHandlers();
refresh();

const appSupabaseReady = window.supabaseConfigReady || Promise.resolve();
appSupabaseReady
  .then(() => syncStateFromRemote())
  .then(() => refresh())
  .catch(() => {
    initializeSyncStatus();
  });

function getCurrentWeekId() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const weekNumber = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${weekNumber}`;
}

function getCurrentWeekDateRange() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.setDate(diff));
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const formatDate = (d) => `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${formatDate(monday)} - ${formatDate(sunday)}`;
}

function autoArchiveIfNeeded() {
  const lastArchivedWeekId = state.lastArchivedWeekId;
  const currentWeekId = getCurrentWeekId();
  
  if (lastArchivedWeekId === currentWeekId) {
    return;
  }
  
  const now = new Date();
  const today = now.getDay();
  
  if (today === 1 && state.plan && state.plan.length > 0) {
    const hasAnyActivity = state.plan.some(day => 
      Object.values(day.tasks || {}).some(v => v === true)
    );
    
    if (hasAnyActivity) {
      const lastWeekDate = new Date();
      lastWeekDate.setDate(lastWeekDate.getDate() - 7);
      const day = lastWeekDate.getDay();
      const diff = lastWeekDate.getDate() - day + (day === 0 ? -6 : 1);
      const lastMonday = new Date(lastWeekDate.setDate(diff));
      const lastSunday = new Date(lastMonday);
      lastSunday.setDate(lastSunday.getDate() + 6);
      const formatDate = (d) => `${d.getMonth() + 1}月${d.getDate()}日`;
      const lastWeekRange = `${formatDate(lastMonday)} - ${formatDate(lastSunday)}`;
      
      const startOfYear = new Date(lastMonday.getFullYear(), 0, 1);
      const weekNumber = Math.ceil(((lastMonday - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
      const weekId = `${lastMonday.getFullYear()}-W${weekNumber}`;
      
      const archiveData = {
        id: weekId,
        weekRange: lastWeekRange,
        archivedAt: Date.now(),
        plan: JSON.parse(JSON.stringify(state.plan)),
        settings: JSON.parse(JSON.stringify(state.settings)),
        totalPoints: getTotalPoints(),
        weeklyGoal: state.settings.weeklyGoal,
        weeklyGrandRewardsClaimed: JSON.parse(JSON.stringify(state.weeklyGrandRewardsClaimed || {})),
      };
      
      if (!state.history.some(h => h.id === archiveData.id)) {
        state.history.unshift(archiveData);
      }
      
      state.lastArchivedWeekId = currentWeekId;
      state.plan = createDefaultPlan();
      state.weeklyGrandRewardsClaimed = {};
      
      saveState();
      refresh();
    }
  }
}

function openHistoryModal() {
  renderHistoryContent();
  document.getElementById('history-modal').classList.remove('hidden');
}

function closeHistoryModal() {
  document.getElementById('history-modal').classList.add('hidden');
}

function renderHistoryContent() {
  const container = document.getElementById('history-content');
  
  if (!state.history || state.history.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #666; padding: 40px;">暂无历史记录。每周数据会在周一自动保存到历史记录。</p>';
    return;
  }
  
  let html = '';
  state.history.forEach((week, weekIndex) => {
    const reachedGoal = week.totalPoints >= week.weeklyGoal;
    html += `
      <div class="history-week-card" style="border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 16px; overflow: hidden;">
        <div class="history-week-header" style="background: #f9fafb; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e5e7eb;">
          <div>
            <h4 style="margin: 0; font-size: 16px; color: #1f2937;">${week.weekRange}</h4>
            <p style="margin: 4px 0 0; font-size: 12px; color: #6b7280;">归档时间：${new Date(week.archivedAt).toLocaleString('zh-CN')}</p>
          </div>
          <div class="history-week-score" style="text-align: right;">
            <span style="font-size: 24px; font-weight: bold; color: ${reachedGoal ? '#10b981' : '#ef4444'};">${week.totalPoints}</span>
            <span style="color: #6b7280;"> / ${week.weeklyGoal} 分</span>
            ${reachedGoal ? '<span style="margin-left: 8px; color: #10b981; font-weight: 500;">✓ 达标</span>' : '<span style="margin-left: 8px; color: #ef4444; font-weight: 500;">未达标</span>'}
          </div>
        </div>
        <div class="history-week-details" style="padding: 16px;">
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr>
                <th style="text-align: left; padding: 8px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #4b5563;">日期</th>
                <th style="text-align: left; padding: 8px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #4b5563;">完成活动</th>
                <th style="text-align: right; padding: 8px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #4b5563;">得分</th>
                <th style="text-align: center; padding: 8px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #4b5563;">每日奖励</th>
              </tr>
            </thead>
            <tbody>
    `;
    
    week.plan.forEach((day) => {
      const activeActivities = week.settings.activities.filter(a => a.enabled);
      const completedActivities = activeActivities.filter(a => day.tasks[a.key]);
      const dayPoints = completedActivities.reduce((sum, a) => {
        const detail = day.taskDetails && day.taskDetails[a.key] || {};
        const qty = detail.quantity || 1;
        return sum + (a.score * qty);
      }, 0);

      const completedLabels = completedActivities.map(a => {
        const detail = day.taskDetails && day.taskDetails[a.key] || {};
        let label = a.label;
        const parts = [];
        const qty = detail.quantity || 1;
        if (qty > 1) parts.push(`×${qty}`);
        if (detail.recorder) parts.push(detail.recorder);

        // Show association selections
        const detailAssociations = detail.associations || {};
        const categories = [
          { key: 'books', label: '图书', items: week.settings.books || [], itemKey: 'key', itemLabel: 'name' },
        ];
        categories.forEach(cat => {
          const selectedKey = detailAssociations[cat.key];
          if (selectedKey) {
            const item = cat.items.find(i => i[cat.itemKey] === selectedKey);
            parts.push(item ? item[cat.itemLabel] : selectedKey);
          }
        });
        // Backward compat for old bookKey
        if (detail.bookKey && !detailAssociations.books) {
          const book = (week.settings.books || []).find(b => b.key === detail.bookKey);
          parts.push(book ? book.name : detail.bookKey);
        }

        if (parts.length > 0) label += `（${parts.join(' · ')}）`;
        return label;
      }).join('、') || '无';

      const rewardList = week.settings.rewards || [];
      const rewardLabel = day.reward ? (rewardList.find(r => r.key === day.reward) || {}).label || day.reward : '';

      html += `
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #f3f4f6; font-size: 14px;">${day.day}</td>
          <td style="padding: 8px; border-bottom: 1px solid #f3f4f6; font-size: 14px; color: #6b7280;">${completedLabels}</td>
          <td style="padding: 8px; border-bottom: 1px solid #f3f4f6; text-align: right; font-size: 14px; font-weight: 500;">${dayPoints} 分</td>
          <td style="padding: 8px; border-bottom: 1px solid #f3f4f6; text-align: center; font-size: 13px;">${rewardLabel ? `<span style="color: #6366f1; font-weight: 500;">🎁 ${rewardLabel}</span>` : '<span style="color: #d1d5db;">—</span>'}</td>
        </tr>
      `;
    });

    html += `
            </tbody>
          </table>
    `;

    const historyExtras = (week.settings.extraBonuses || []).filter(r => r.enabled && Number(r.requiredCount) > 0 && Number(r.bonusPoints) > 0);
    const extraDetails = [];
    let extraTotal = 0;
    historyExtras.forEach((rule) => {
      let count = 0;
      week.plan.forEach((day) => {
        if (day.tasks && day.tasks[rule.activityKey]) count += 1;
      });
      const times = Math.floor(count / Number(rule.requiredCount));
      const points = times * (Number(rule.bonusPoints) || 0);
      if (points > 0) {
        const act = (week.settings.activities || []).find(a => a.key === rule.activityKey);
        const name = act ? act.label : rule.activityKey;
        extraDetails.push({ name, count, required: rule.requiredCount, points });
        extraTotal += points;
      }
    });
    if (extraDetails.length > 0) {
      html += `
          <div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed #d1d5db;">
            <h5 style="margin: 0 0 8px; font-size: 13px; color: #6366f1;">额外加分</h5>
      `;
      extraDetails.forEach((d) => {
        html += `<div style="font-size: 13px; color: #4b5563; margin-bottom: 4px;">${d.name}: 完成 ${d.count}/${d.required} 次 → 获得 ${d.points} 分</div>`;
      });
      html += `<div style="font-size: 13px; font-weight: 600; color: #6366f1; margin-top: 4px;">额外加分合计：${extraTotal} 分</div>`;
      html += `</div>`;
    }

    let grandRewards = week.settings.weeklyGrandRewards || [];
    let grandClaimed = week.weeklyGrandRewardsClaimed || {};
    if (grandRewards.length === 0 && week.settings.weeklyGrandReward && typeof week.settings.weeklyGrandReward === 'object') {
      const old = week.settings.weeklyGrandReward;
      grandRewards = [{
        key: old.key || 'grand',
        label: old.label || '周大奖励',
        weeklyLimit: Number(old.weeklyLimit) > 0 ? Number(old.weeklyLimit) : 1,
        enabled: old.enabled === true,
      }];
    }
    if (Object.keys(grandClaimed).length === 0 && week.weeklyGrandRewardClaimed) {
      const oldClaimed = week.weeklyGrandRewardClaimed;
      if (oldClaimed.claimed) {
        const key = oldClaimed.rewardKey || 'grand';
        grandClaimed = { [key]: { claimed: true, timestamp: oldClaimed.timestamp } };
      }
    }
    const enabledGrandRewards = grandRewards.filter(g => g.enabled);
    const allGrandKeys = new Set(enabledGrandRewards.map(g => g.key));
    Object.keys(grandClaimed).forEach(k => allGrandKeys.add(k));
    if (allGrandKeys.size > 0) {
      html += `<div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed #d1d5db;">`;
      html += `<h5 style="margin: 0 0 8px; font-size: 13px; color: #f59e0b;">🏆 本周大奖励</h5>`;
      allGrandKeys.forEach(key => {
        const reward = grandRewards.find(g => g.key === key);
        const label = reward ? reward.label : key;
        const claimedVal = grandClaimed[key];
        const claimed = claimedVal === true || (claimedVal && claimedVal.claimed === true);
        if (claimed) {
          html += `<div style="font-size: 13px; color: #10b981; margin-bottom: 4px;">✅ ${label}：已领取</div>`;
        } else {
          html += `<div style="font-size: 13px; color: #9ca3af; margin-bottom: 4px;">⬜ ${label}：未领取</div>`;
        }
      });
      html += `</div>`;
    }
    
    html += `
        </div>
      </div>
    `;
  });

  // Data recovery section
  html += `
    <div style="margin-top: 20px; padding: 16px; background: #fef3c7; border-radius: 8px; border: 1px solid #fcd34d;">
      <div style="font-size: 14px; font-weight: 600; color: #92400e; margin-bottom: 8px;">⚠️ 数据保护</div>
      <div style="font-size: 13px; color: #78350f; margin-bottom: 12px;">
        每次保存前系统会自动备份。如果数据被意外篡改，可以从备份恢复。
      </div>
      <button id="load-backups-btn" class="btn btn-secondary" style="font-size: 13px; padding: 6px 12px;">查看备份记录</button>
      <div id="backups-list" style="margin-top: 12px;"></div>
    </div>
  `;

  container.innerHTML = html;

  const loadBtn = document.getElementById('load-backups-btn');
  if (loadBtn) {
    loadBtn.addEventListener('click', async () => {
      const listDiv = document.getElementById('backups-list');
      if (!isSupabaseReady()) {
        listDiv.innerHTML = '<div style="color: #ef4444; font-size: 13px;">Supabase 未连接，无法加载备份。</div>';
        return;
      }
      listDiv.innerHTML = '<div style="font-size: 13px; color: #6b7280;">正在加载备份...</div>';
      const { data: backups, error } = await window.supabaseClient
        .from(BACKUP_TABLE_NAME)
        .select('id, archived_at, updated_at')
        .eq('plan_id', SUPABASE_STATE_ID)
        .order('archived_at', { ascending: false })
        .limit(10);
      if (error || !backups || backups.length === 0) {
        listDiv.innerHTML = '<div style="font-size: 13px; color: #6b7280;">暂无备份记录。请先确保已在 Supabase 中创建备份表。</div>';
        return;
      }
      let bh = '<div style="font-size: 13px; font-weight: 600; margin-bottom: 8px;">最近备份：</div>';
      backups.forEach((b, idx) => {
        const date = new Date(b.archived_at).toLocaleString('zh-CN');
        bh += `<div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 0; border-bottom: 1px solid #fde68a;">
          <span style="font-size: 13px; color: #78350f;">${date}</span>
          <button class="btn btn-secondary restore-backup-btn" data-backup-id="${b.id}" style="font-size: 12px; padding: 4px 10px;">恢复此版本</button>
        </div>`;
      });
      listDiv.innerHTML = bh;
      listDiv.querySelectorAll('.restore-backup-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const backupId = e.target.dataset.backupId;
          if (!confirm('确定要恢复这个备份版本吗？当前数据将被覆盖。')) return;
          const { data: backupData } = await window.supabaseClient
            .from(BACKUP_TABLE_NAME)
            .select('state')
            .eq('id', backupId)
            .single();
          if (backupData && backupData.state) {
            state = migrateRemoteState(backupData.state, Date.now());
            window.state = state;
            saveState(true);
            refresh();
            alert('备份已恢复！');
            closeHistoryModal();
          } else {
            alert('恢复失败，无法读取备份数据。');
          }
        });
      });
    });
  }
}

document.getElementById('view-history-btn').addEventListener('click', openHistoryModal);
document.getElementById('history-modal-close').addEventListener('click', closeHistoryModal);
document.getElementById('history-modal-cancel').addEventListener('click', closeHistoryModal);
document.getElementById('history-modal').addEventListener('click', (e) => {
  if (e.target.id === 'history-modal') closeHistoryModal();
});

// 页面加载时自动检查是否需要归档
autoArchiveIfNeeded();
