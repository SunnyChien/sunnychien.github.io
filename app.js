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
  return typeof isSupabaseConfigured === "function" && isSupabaseConfigured() && typeof supabaseClient !== "undefined" && supabaseClient !== null;
}

async function saveStateToRemote() {
  if (!isSupabaseReady()) return;

  const payload = {
    id: SUPABASE_STATE_ID,
    state,
    updated_at: new Date().toISOString(),
  };
  setSyncStatus("正在将数据保存到 Supabase...", "pending");

  const { error } = await supabaseClient.from(SUPABASE_TABLE_NAME).upsert(payload, {
    onConflict: "id",
  });

  if (error) {
    console.warn("Supabase 远程保存失败", error);
    setSyncStatus("Supabase 远程保存失败，请稍后重试。", "error");
  } else {
    setSyncStatus("已同步到 Supabase。", "connected");
  }
}

async function syncStateFromRemote() {
  if (!isSupabaseReady()) return;
  setSyncStatus("正在从 Supabase 获取最新数据...", "pending");

  try {
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
      await saveStateToRemote();
      return;
    }

    const remoteState = data.state || {};
    const remoteUpdatedAt = new Date(data.updated_at).getTime() || 0;
    const localUpdatedAt = Number(state.updatedAt) || 0;

    if (remoteUpdatedAt > localUpdatedAt) {
      state = { ...remoteState, updatedAt: remoteUpdatedAt };
      saveState(false);
      refresh();
      setSyncStatus("已从 Supabase 拉取最新数据。", "connected");
    } else if (localUpdatedAt > remoteUpdatedAt) {
      await saveStateToRemote();
      setSyncStatus("本地数据较新，已同步到 Supabase。", "connected");
    } else {
      setSyncStatus("Supabase 与本地数据已同步。", "connected");
    }
  } catch (error) {
    console.warn("Supabase 同步失败", error);
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
initializeSyncStatus();

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
    if (!Object.prototype.hasOwnProperty.call(day, "reward")) {
      day.reward = null;
    }
  });
  return plan;
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
      const activities = activitiesSource.map((item) => ({
        key: item.key,
        label: item.label || item.key,
        score: item.score > 0 ? item.score : 10,
        enabled: item.enabled !== false,
      }));
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
        },
        weeklyGrandRewardClaimed: parsed.weeklyGrandRewardClaimed || { claimed: false, rewardKey: null },
      };
    }
  } catch (error) {
    console.warn("读取本地存储失败", error);
  }
  return {
    plan: createDefaultPlan(),
    settings: defaultSettings,
  };
}

function saveState(syncRemote = true) {
  state.updatedAt = Date.now();
  localStorage.setItem(storageKey, JSON.stringify(state));
  if (syncRemote) {
    syncStateToRemote();
  }
}

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

function isWeeklyGrandClaimed() {
  return !!(state.weeklyGrandRewardClaimed && state.weeklyGrandRewardClaimed.claimed);
}

function claimWeeklyGrandToggle() {
  if (!state.weeklyGrandRewardClaimed) state.weeklyGrandRewardClaimed = { claimed: false, rewardKey: null };
  if (!isWeeklyGrandClaimed()) {
    // Claim
    state.weeklyGrandRewardClaimed.claimed = true;
    state.weeklyGrandRewardClaimed.rewardKey = state.settings.weeklyGrandReward ? state.settings.weeklyGrandReward.key : null;
    state.weeklyGrandRewardClaimed.timestamp = Date.now();
    saveState();
    refresh();
  } else {
    // Cancel claim
    if (confirm("取消本周大奖励领取？")) {
      state.weeklyGrandRewardClaimed = { claimed: false, rewardKey: null };
      saveState();
      refresh();
    }
  }
}

function renderWeeklyScoreBadge(totalPoints, weeklyGoal) {
  if (!weeklyScore) return;
  weeklyScore.classList.toggle('reached', totalPoints >= weeklyGoal);
  weeklyScore.innerHTML = `<div class="badge-text">${totalPoints} / ${weeklyGoal} 分</div>`;
  // add claim button when reached and enabled
  const grand = state.settings.weeklyGrandReward;
  if (totalPoints >= weeklyGoal && grand && grand.enabled) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-save';
    if (isWeeklyGrandClaimed()) {
      btn.textContent = `已领取：${grand.label}`;
    } else {
      btn.textContent = '领取本周大奖励';
    }
    btn.addEventListener('click', claimWeeklyGrandToggle);
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
    return sum + (day.tasks[activity.key] ? activity.score : 0);
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
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "task-checkbox";
      checkbox.checked = !!day.tasks[activity.key];
      checkbox.addEventListener("change", () => {
        day.tasks[activity.key] = checkbox.checked;
        saveState();
        refresh();
      });
      cell.appendChild(checkbox);
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

function refresh() {
  buildTable();
  buildSummary();
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
}

renderDateHeader();
attachRewardModalHandlers();
refresh();
syncStateFromRemote().then(() => refresh());
