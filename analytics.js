// ============================================================
//  BRAHMA YANTRA — analytics.js  v1
//  Complete scoring engine. No dependencies.
//  Used by all dashboard pages.
//
//  USAGE:
//    <script src="js/analytics.js"></script>
//    const scores = BY.calcDay(dayRow, disciplineRows);
//    const level  = BY.calcLevel(allDays);
//
//  All functions live under the BY namespace.
//  Never modifies input data. Always returns new objects.
// ============================================================

const BY = (() => {

  // ══════════════════════════════════════════════════════════
  //  CONSTANTS  (mirrors checkin.html TARGETS + philosophy)
  // ══════════════════════════════════════════════════════════
  const C = {
    // Targets
    SKY_FULL_MINS:       15,
    PLANK_TARGET_SECS:   120,
    PUSHUP_DAILY:        60,
    PULLUP_DAILY:        20,
    READING_DAILY_MINS:  30,
    MEDITATION_TARGET:   10,
    WATER_TARGET:        3,

    // Scoring weights (discipline is foundation)
    W_DISCIPLINE: 0.40,
    W_STRONG:     0.25,
    W_SMART:      0.20,
    W_RICH:       0.15,

    // Discipline point allocations
    DISC_NOFAP:     30,
    DISC_SKY:       20,
    DISC_SLEEP:     15,
    DISC_WAKE:      15,
    DISC_SCREEN:    10,
    DISC_PRANAYAMA:  5,
    DISC_HAND:       5,

    // Personal best streak (from CSV data)
    PERSONAL_BEST_STREAK: 502,

    // Level thresholds (cumulative lifetime points)
    LEVELS: [
      { name: 'Seeker',       min: 0     },
      { name: 'Practitioner', min: 2000  },
      { name: 'Disciplined',  min: 5000  },
      { name: 'Warrior',      min: 10000 },
      { name: 'Sadhak',       min: 18000 },
      { name: 'Yogi',         min: 30000 },
      { name: 'Brahma',       min: 50000 },
    ],

    // Amrit streak multipliers
    AMRIT_MULTIPLIERS: [
      { days:  7, mult: 1.1 },
      { days: 21, mult: 1.2 },
      { days: 30, mult: 1.3 },
      { days: 90, mult: 1.5 },
    ],

    // Streak bonus Amrits per Core habit per day
    AMRIT_STREAK_BONUS: [
      { days:  7, bonus: 10 },
      { days: 21, bonus: 15 },
      { days: 30, bonus: 20 },
      { days: 90, bonus: 30 },
    ],
  };

  // ══════════════════════════════════════════════════════════
  //  PARSERS
  // ══════════════════════════════════════════════════════════

  /**
   * Parse sets string "20+20+15+15" → { total, sets, best, parts }
   */
  function parseSets(str) {
    if (!str || typeof str !== 'string') return { total: 0, sets: 0, best: 0, parts: [] };
    const parts = str.split('+')
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n) && n > 0);
    return {
      total: parts.reduce((a, b) => a + b, 0),
      sets:  parts.length,
      best:  parts.length ? Math.max(...parts) : 0,
      parts,
    };
  }

  /**
   * Parse DD/MM/YYYY string → Date object (midnight local)
   */
  function parseDate(str) {
    if (!str) return null;
    const s = String(str).trim();
    // DD/MM/YYYY
    if (s.includes('/')) {
      const [d, m, y] = s.split('/').map(Number);
      if (!d || !m || !y) return null;
      return new Date(y, m - 1, d);
    }
    // YYYY-MM-DD (from date input)
    if (s.includes('-')) {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    return null;
  }

  /**
   * Format Date → DD/MM/YYYY
   */
  function formatDate(date) {
    if (!date) return '';
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}/${m}/${y}`;
  }

  /**
   * Parse HH:MM time string → total minutes from midnight
   */
  function timeToMins(str) {
    if (!str) return null;
    const parts = String(str).split(':').map(Number);
    if (parts.length < 2) return null;
    return parts[0] * 60 + parts[1];
  }

  /**
   * Calculate sleep hours from bed + wake time strings
   */
  function calcSleepHours(bedTime, wakeTime) {
    const b = timeToMins(bedTime);
    const w = timeToMins(wakeTime);
    if (b === null || w === null) return null;
    let mins = w - b;
    if (mins < 0) mins += 1440; // crossed midnight
    return parseFloat((mins / 60).toFixed(1));
  }

  /**
   * Check time window: how close is actual to target?
   * Returns 'full' | 'partial' | 'missed'
   * tol10 = tolerance in minutes for full pts (double = partial)
   */
  function checkTimeWindow(actualStr, targetStr, tol10 = 10) {
    const a = timeToMins(actualStr);
    const t = timeToMins(targetStr);
    if (a === null || t === null) return 'missed';
    const diff = Math.abs(a - t);
    if (diff <= tol10)     return 'full';
    if (diff <= tol10 * 2) return 'partial';
    return 'missed';
  }

  /**
   * Parse screen time — accepts decimal hours or HH:MM
   * Returns decimal hours
   */
  function parseScreenTime(val) {
    if (val === '' || val === null || val === undefined) return null;
    const s = String(val).trim();
    if (s.includes(':')) {
      const [h, m] = s.split(':').map(Number);
      return h + m / 60;
    }
    return parseFloat(s) || 0;
  }

  // ══════════════════════════════════════════════════════════
  //  LAYER 1 — DISCIPLINE SCORE (0–100)
  // ══════════════════════════════════════════════════════════

  /**
   * Calculate discipline score from a single day's data row.
   * currentStreak: current NoFap streak length (integer days)
   * Returns { score, breakdown } where score ∈ [0,100]
   */
  function calcDisciplineScore(day, currentStreak = 0) {
    const breakdown = {};
    let score = 0;

    // ── NoFap (30 pts, proportional to streak vs personal best) ──
    if (day['NoFap'] === 'Yes' || day['NoFap'] === true) {
      const streakPts = Math.round(
        Math.min(1, currentStreak / C.PERSONAL_BEST_STREAK) * C.DISC_NOFAP
      );
      // Minimum 5 pts if kept today (avoids 0 on day 1)
      breakdown.nofap = Math.max(5, streakPts);
    } else {
      breakdown.nofap = 0;
    }
    score += breakdown.nofap;

    // ── Sudarshan Kriya (20 pts) ──
    const skyMins = parseFloat(day['SKY Mins']) || 0;
    if (skyMins >= C.SKY_FULL_MINS)   breakdown.sky = 20;
    else if (skyMins > 0)             breakdown.sky = 10;
    else                              breakdown.sky = 0;
    score += breakdown.sky;

    // ── Sleep before 11 PM (15 pts, auto from Bed Time) ──
    const sleepResult = checkTimeWindow(day['Bed Time'], '23:00', 10);
    breakdown.sleep = sleepResult === 'full' ? 15 : sleepResult === 'partial' ? 7 : 0;
    score += breakdown.sleep;

    // ── Wake before 5 AM (15 pts, auto from Wake Time) ──
    const wakeResult = checkTimeWindow(day['Wake Time'], '05:00', 10);
    breakdown.wake = wakeResult === 'full' ? 15 : wakeResult === 'partial' ? 7 : 0;
    score += breakdown.wake;

    // ── Screen Time (10 pts) ──
    const screenHrs = parseScreenTime(day['Screen Time']);
    if (screenHrs !== null) {
      if (screenHrs < 1)       breakdown.screen = 10;
      else if (screenHrs <= 2) breakdown.screen = 7;
      else if (screenHrs <= 3) breakdown.screen = 3;
      else                     breakdown.screen = 0;
    } else {
      breakdown.screen = 0;
    }
    score += breakdown.screen;

    // ── Pranayama (5 pts) ──
    breakdown.pranayama = (day['Pranayama'] === 'Yes' || day['Pranayama'] === true) ? 5 : 0;
    score += breakdown.pranayama;

    // ── Hand Exercise (5 pts) ──
    breakdown.hand = (day['Hand Exercise'] === 'Yes' || day['Hand Exercise'] === true) ? 5 : 0;
    score += breakdown.hand;

    return { score: Math.min(100, score), breakdown };
  }

  // ══════════════════════════════════════════════════════════
  //  LAYER 2 — DISCIPLINE BOOST MULTIPLIER
  // ══════════════════════════════════════════════════════════

  /**
   * Returns multiplier ∈ [1.00, 1.15]
   * NEVER goes below 1.00 — philosophy: boosts only, never penalises
   */
  function calcMultiplier(disciplineScore) {
    if (disciplineScore >= 90) return 1.15;
    if (disciplineScore >= 75) return 1.08;
    if (disciplineScore >= 50) return 1.03;
    return 1.00;
  }

  // ══════════════════════════════════════════════════════════
  //  LAYER 3 — SMART SCORE (raw, before multiplier)
  // ══════════════════════════════════════════════════════════

  /**
   * Reading 70 pts | Focus 20 pts | Meditation 10 pts
   * (Study removed — has the job now)
   */
  function calcSmartScore(day) {
    const breakdown = {};
    let raw = 0;

    // Reading (70 pts)
    const readMins = parseFloat(day['Reading Mins']) || 0;
    breakdown.reading = Math.min(70, (readMins / C.READING_DAILY_MINS) * 70);
    raw += breakdown.reading;

    // Focus (20 pts) — stored as integer 1–10
    const focus = parseFloat(day['Focus']) || 5;
    breakdown.focus = (focus / 10) * 20;
    raw += breakdown.focus;

    // Meditation (10 pts)
    const medMins = parseFloat(day['Meditation Mins']) || 0;
    breakdown.meditation = Math.min(10, (medMins / C.MEDITATION_TARGET) * 10);
    raw += breakdown.meditation;

    return { raw: Math.min(100, raw), breakdown };
  }

  // ══════════════════════════════════════════════════════════
  //  LAYER 4 — STRONG SCORE (raw, before multiplier)
  // ══════════════════════════════════════════════════════════

  function calcStrongScore(day) {
    const breakdown = {};
    let raw = 0;

    // Push Ups (25 pts)
    const push = parseSets(day['Push Ups']);
    breakdown.pushups = Math.min(25, (push.total / C.PUSHUP_DAILY) * 25);
    raw += breakdown.pushups;

    // Pull Ups (15 pts)
    const pull = parseSets(day['Pull Ups']);
    breakdown.pullups = Math.min(15, (pull.total / C.PULLUP_DAILY) * 15);
    raw += breakdown.pullups;

    // Plank (15 pts)
    const plankSecs = parseFloat(day['Plank Secs']) || 0;
    breakdown.plank = Math.min(15, (plankSecs / C.PLANK_TARGET_SECS) * 15);
    raw += breakdown.plank;

    // Workout (20 pts)
    breakdown.workout = (day['Workout'] === 'Yes' || day['Workout'] === true) ? 20 : 0;
    raw += breakdown.workout;

    // Water (15 pts)
    const water = parseFloat(day['Water']) || 0;
    breakdown.water = Math.min(15, (water / C.WATER_TARGET) * 15);
    raw += breakdown.water;

    // Cardio (10 pts)
    breakdown.cardio = (day['Cardio'] === 'Yes' || day['Cardio'] === true) ? 10 : 0;
    raw += breakdown.cardio;

    return { raw: Math.min(100, raw), breakdown };
  }

  // ══════════════════════════════════════════════════════════
  //  LAYER 5 — RICH SCORE (monthly, not daily)
  // ══════════════════════════════════════════════════════════

  /**
   * monthData: array of Finance tab rows for a single month
   * Returns { raw, breakdown } — call with multiplier separately
   *
   * Income rows:  Category Type = 'Income'
   * Expense rows: Category Type = 'Expense'
   */
  function calcRichScore(monthData, monthBudget = null) {
    const breakdown = {};
    let raw = 0;

    const income   = monthData.filter(r => r['Category Type'] === 'Income');
    const expenses = monthData.filter(r => r['Category Type'] === 'Expense');

    const totalIncome  = income.reduce((s, r)   => s + (parseFloat(r['Amount']) || 0), 0);
    const totalExpense = expenses.reduce((s, r)  => s + (parseFloat(r['Amount']) || 0), 0);
    const saved        = totalIncome - totalExpense;

    // Savings rate (40 pts)
    if (totalIncome > 0) {
      const savingsRate = saved / totalIncome;
      breakdown.savings = Math.min(40, Math.max(0, savingsRate * 100));
    } else {
      breakdown.savings = 0;
    }
    raw += breakdown.savings;

    // Expenses vs budget (30 pts)
    if (monthBudget && monthBudget > 0) {
      if (totalExpense <= monthBudget) {
        breakdown.budget = 30;
      } else {
        const over = (totalExpense - monthBudget) / monthBudget;
        breakdown.budget = Math.max(0, 30 - over * 30);
      }
    } else {
      // No budget set — give proportional based on savings
      breakdown.budget = saved > 0 ? 20 : 0;
    }
    raw += breakdown.budget;

    // Investments (20 pts) — any 'Investment' category row
    const hasInvestment = monthData.some(r =>
      String(r['Category Name']).toLowerCase().includes('invest') ||
      String(r['Category Name']).toLowerCase().includes('mutual') ||
      String(r['Category Name']).toLowerCase().includes('sip')
    );
    breakdown.investment = hasInvestment ? 20 : 0;
    raw += breakdown.investment;

    // Financial goal progress (10 pts) — placeholder, updated by goals tab
    breakdown.goals = 0;
    raw += breakdown.goals;

    // Attach summary for display
    breakdown._summary = { totalIncome, totalExpense, saved, savingsRate: totalIncome > 0 ? saved / totalIncome : 0 };

    return { raw: Math.min(100, raw), breakdown };
  }

  // ══════════════════════════════════════════════════════════
  //  LAYER 6 — OVERALL SCORE
  // ══════════════════════════════════════════════════════════

  /**
   * disc, smart, strong: final scores (already multiplied)
   * rich: final Rich score (monthly, pass 0 if not available)
   */
  function calcOverallScore(disc, smart, strong, rich = 0) {
    return (
      disc   * C.W_DISCIPLINE +
      smart  * C.W_SMART      +
      strong * C.W_STRONG     +
      rich   * C.W_RICH
    );
  }

  // ══════════════════════════════════════════════════════════
  //  LAYER 7 — CONSISTENCY SCORE
  // ══════════════════════════════════════════════════════════

  /**
   * allDays: array of day score objects (sorted oldest first)
   *   each: { date, overall }
   * Returns consistency score (0–100), moves slowly
   */
  function calcConsistencyScore(dayScores) {
    if (!dayScores || dayScores.length === 0) return 0;
    const sorted = [...dayScores].sort((a, b) => parseDate(a.date) - parseDate(b.date));
    const overalls = sorted.map(d => d.overall || 0);

    const avg7  = _rollingAvg(overalls, 7);
    const avg30 = _rollingAvg(overalls, 30);
    const avg90 = _rollingAvg(overalls, 90);

    return (avg7 * 0.20) + (avg30 * 0.35) + (avg90 * 0.45);
  }

  function _rollingAvg(arr, n) {
    const slice = arr.slice(-n);
    if (!slice.length) return 0;
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  }

  // ══════════════════════════════════════════════════════════
  //  LAYER 8 — GROWTH RATE
  // ══════════════════════════════════════════════════════════

  /**
   * Returns { direction, pct, label }
   * direction: 'growing' | 'plateau' | 'declining'
   */
  function calcGrowthRate(dayScores) {
    if (!dayScores || dayScores.length < 14) {
      return { direction: 'plateau', pct: 0, label: 'Not enough data' };
    }
    const sorted   = [...dayScores].sort((a, b) => parseDate(a.date) - parseDate(b.date));
    const overalls = sorted.map(d => d.overall || 0);

    const thisMonth = _rollingAvg(overalls.slice(-30), 30);
    const lastMonth = _rollingAvg(overalls.slice(-60, -30), 30);

    if (lastMonth === 0) return { direction: 'plateau', pct: 0, label: 'Not enough data' };

    const diff = thisMonth - lastMonth;
    const pct  = parseFloat(((diff / lastMonth) * 100).toFixed(1));

    let direction, label;
    if (Math.abs(pct) <= 2) {
      direction = 'plateau';
      label = `→ Plateau (${pct > 0 ? '+' : ''}${pct}%)`;
    } else if (pct > 0) {
      direction = 'growing';
      label = `↑ Growing +${pct}% this month`;
    } else {
      direction = 'declining';
      label = `↓ Declining ${pct}% this month`;
    }

    return { direction, pct, label };
  }

  // ══════════════════════════════════════════════════════════
  //  STREAK CALCULATOR
  // ══════════════════════════════════════════════════════════

  /**
   * Calculate current and best streak for any boolean habit
   * habitRows: array of { date: 'DD/MM/YYYY', done: 'Yes'|'No' }
   *            sorted by date (any order — will sort internally)
   * Returns { current, best, lastDone }
   */
  function calcStreak(habitRows) {
    if (!habitRows || !habitRows.length) return { current: 0, best: 0, lastDone: null };

    const sorted = [...habitRows]
      .filter(r => r.date && r.done !== undefined)
      .sort((a, b) => parseDate(a.date) - parseDate(b.date));

    let current = 0, best = 0, streak = 0;
    let lastDone = null;
    let prevDate = null;

    for (const row of sorted) {
      const d   = parseDate(row.date);
      const done = row.done === 'Yes' || row.done === true || row.done === 1;

      if (done) {
        if (prevDate) {
          const dayDiff = Math.round((d - prevDate) / 86400000);
          // Allow 1-day gap (consecutive days)
          if (dayDiff === 1) {
            streak++;
          } else {
            streak = 1; // reset
          }
        } else {
          streak = 1;
        }
        if (streak > best) best = streak;
        lastDone = row.date;
        prevDate = d;
      } else {
        streak = 0;
        prevDate = d;
      }
    }

    current = streak;
    return { current, best, lastDone };
  }

  /**
   * Get current NoFap streak from Discipline CSV tab rows
   * Uses 'Whole Streak' column (integer days)
   * Row 0 (start marker) is skipped automatically
   */
  function getNoFapStreak(disciplineRows) {
    if (!disciplineRows || !disciplineRows.length) return { current: 0, best: C.PERSONAL_BEST_STREAK };

    // Sort by date ascending
    const sorted = [...disciplineRows]
      .filter(r => r['Date'] && r['Sl. No.'] !== 0 && r['Sl. No.'] !== '0')
      .sort((a, b) => parseDate(a['Date']) - parseDate(b['Date']));

    if (!sorted.length) return { current: 0, best: C.PERSONAL_BEST_STREAK };

    // Last row's Whole Streak = current streak
    const last    = sorted[sorted.length - 1];
    const current = parseInt(last['Whole Streak']) || 0;

    // Best ever (from all rows + known personal best)
    const maxFromData = Math.max(...sorted.map(r => parseInt(r['Whole Streak']) || 0));
    const best = Math.max(maxFromData, C.PERSONAL_BEST_STREAK);

    return { current, best };
  }

  // ══════════════════════════════════════════════════════════
  //  AMRIT ENGINE
  // ══════════════════════════════════════════════════════════

  /**
   * Calculate Amrits earned for a single day
   * AMRIT_START_DATE: 'DD/MM/YYYY' string — Amrits only after this date
   * streaks: { [habitName]: currentStreakDays }
   * Returns { amrits, breakdown } or { amrits: 0 } if before start date
   */
  function calcAmrits(day, overallScore, streaks = {}, amritStartDate = '') {
    const dayDate = parseDate(day['Date']);

    // Check AMRIT_START_DATE
    if (amritStartDate) {
      const startDate = parseDate(amritStartDate);
      if (startDate && dayDate && dayDate < startDate) {
        return { amrits: 0, breakdown: {}, beforeStart: true };
      }
    }

    const breakdown = {};
    let total = 0;

    // Base: 1 Amrit per overall score point
    breakdown.base = Math.round(overallScore);
    total += breakdown.base;

    // All-Core bonus: all 5 Core habits done
    const coreHabits = ['SKY Mins', 'Meditation Mins', 'Push Ups', 'Pull Ups', 'Plank Secs'];
    const allCoreDone = coreHabits.every(h => {
      const v = day[h];
      if (h === 'Push Ups' || h === 'Pull Ups') return v && String(v).trim() !== '';
      return parseFloat(v) > 0;
    });
    breakdown.allCore = allCoreDone ? 20 : 0;
    total += breakdown.allCore;

    // Perfect discipline bonus
    const discScore = parseFloat(day['Disc Score']) || 0;
    breakdown.perfectDisc = discScore >= 90 ? 25 : 0;
    total += breakdown.perfectDisc;

    // Streak bonuses (per Core habit)
    breakdown.streakBonus = 0;
    const CORE_HABIT_KEYS = ['SKY', 'Meditation', 'Push Ups', 'Pull Ups', 'Plank'];
    CORE_HABIT_KEYS.forEach(h => {
      const s = streaks[h] || 0;
      let bonus = 0;
      for (const tier of [...C.AMRIT_STREAK_BONUS].reverse()) {
        if (s >= tier.days) { bonus = tier.bonus; break; }
      }
      breakdown.streakBonus += bonus;
    });
    total += breakdown.streakBonus;

    // Overall consistency streak multiplier
    const overallStreak = streaks['overall'] || 0;
    let mult = 1.0;
    for (const tier of [...C.AMRIT_MULTIPLIERS].reverse()) {
      if (overallStreak >= tier.days) { mult = tier.mult; break; }
    }
    breakdown.multiplier = mult;
    total = Math.round(total * mult);
    breakdown.total = total;

    return { amrits: total, breakdown, beforeStart: false };
  }

  // ══════════════════════════════════════════════════════════
  //  LEVEL SYSTEM
  // ══════════════════════════════════════════════════════════

  /**
   * Calculate level from cumulative lifetime points
   * Returns { level, name, current, next, progress, pct }
   */
  function calcLevel(cumulativePoints) {
    const pts   = cumulativePoints || 0;
    let level   = 0;
    let current = C.LEVELS[0];
    let next    = C.LEVELS[1];

    for (let i = C.LEVELS.length - 1; i >= 0; i--) {
      if (pts >= C.LEVELS[i].min) {
        level   = i + 1;
        current = C.LEVELS[i];
        next    = C.LEVELS[i + 1] || null;
        break;
      }
    }

    const progressPts = pts - current.min;
    const rangePts    = next ? next.min - current.min : Infinity;
    const pct         = next ? Math.min(100, (progressPts / rangePts) * 100) : 100;

    return {
      level,
      name:     current.name,
      current:  current.min,
      next:     next ? next.min : null,
      nextName: next ? next.name : null,
      points:   pts,
      progress: progressPts,
      range:    rangePts,
      pct:      parseFloat(pct.toFixed(1)),
    };
  }

  // ══════════════════════════════════════════════════════════
  //  BADGE CHECKER
  // ══════════════════════════════════════════════════════════

  /**
   * Check which badges have been newly earned on a given day
   * allDays: all daily rows sorted ascending
   * disciplineRows: Discipline tab rows
   * Returns array of newly earned badge objects { id, name, emoji, date }
   */
  function checkBadges(allDays, disciplineRows = []) {
    const newBadges = [];
    const today     = allDays[allDays.length - 1];
    if (!today) return newBadges;

    const todayDate = today['Date'];

    // ── Helper: count consecutive tail streak ──
    function tailStreak(rows, testFn) {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (testFn(rows[i])) count++;
        else break;
      }
      return count;
    }

    // ── Helper: ever reached condition ──
    function everReached(rows, testFn) {
      return rows.some(testFn);
    }

    const checkIn = allDays.length;
    const skyRows = allDays.filter(d => parseFloat(d['SKY Mins']) >= C.SKY_FULL_MINS);
    const skyStreak = tailStreak(allDays, d => parseFloat(d['SKY Mins']) >= C.SKY_FULL_MINS);

    // ── SKY Badges ──
    if (allDays.length === 1 && parseFloat(today['SKY Mins']) > 0)
      newBadges.push({ id: 'sky_first', emoji: '🌬️', name: 'First Breath', date: todayDate });
    if (skyStreak === 7)
      newBadges.push({ id: 'sky_7', emoji: '🌬️🌬️', name: 'Seven Suns', date: todayDate });
    if (skyStreak === 30)
      newBadges.push({ id: 'sky_30', emoji: '🌊', name: 'Deep Practice', date: todayDate });
    if (skyStreak === 90)
      newBadges.push({ id: 'sky_90', emoji: '☀️', name: 'Sadhak', date: todayDate });

    // ── Sleep Badges ──
    const sleepStreak = tailStreak(allDays, d => checkTimeWindow(d['Bed Time'], '23:00', 10) !== 'missed');
    if (sleepStreak === 1 && !everReached(allDays.slice(0, -1), d => checkTimeWindow(d['Bed Time'], '23:00', 10) !== 'missed'))
      newBadges.push({ id: 'sleep_first', emoji: '🌙', name: 'Early Night', date: todayDate });
    if (sleepStreak === 7)
      newBadges.push({ id: 'sleep_7', emoji: '🌙🌙', name: 'Night Discipline', date: todayDate });
    if (sleepStreak === 30)
      newBadges.push({ id: 'sleep_30', emoji: '🌙🌙🌙', name: 'Sleep Master', date: todayDate });

    // ── Wake Badges ──
    const wakeStreak = tailStreak(allDays, d => checkTimeWindow(d['Wake Time'], '05:00', 10) !== 'missed');
    if (wakeStreak === 1 && !everReached(allDays.slice(0, -1), d => checkTimeWindow(d['Wake Time'], '05:00', 10) !== 'missed'))
      newBadges.push({ id: 'wake_first', emoji: '🌅', name: 'First Dawn', date: todayDate });
    if (wakeStreak === 7)
      newBadges.push({ id: 'wake_7', emoji: '🌅🌅', name: 'Dawn Warrior', date: todayDate });
    if (wakeStreak === 30)
      newBadges.push({ id: 'wake_30', emoji: '🌅🌅🌅', name: 'Dawn Master', date: todayDate });

    // ── Push-up Badges ──
    const todayPush = parseSets(today['Push Ups']).total;
    if (todayPush >= 100) {
      if (!everReached(allDays.slice(0, -1), d => parseSets(d['Push Ups']).total >= 100))
        newBadges.push({ id: 'push_100', emoji: '💪', name: 'First Hundred', date: todayDate });
    }
    const push100Streak = tailStreak(allDays, d => parseSets(d['Push Ups']).total >= 100);
    if (push100Streak === 5)
      newBadges.push({ id: 'push_5', emoji: '💪💪', name: 'Iron Five', date: todayDate });
    const pushLogStreak = tailStreak(allDays, d => !!d['Push Ups']);
    if (pushLogStreak === 30)
      newBadges.push({ id: 'push_30', emoji: '💪💪💪', name: 'Consistent Iron', date: todayDate });

    // ── NoFap Badges (from Discipline tab) ──
    const { current: nofapCurrent, best: nofapBest } = getNoFapStreak(disciplineRows);
    const nofapMilestones = [
      { days: 7,   id: 'nofap_7',   emoji: '🔥',  name: 'First Week' },
      { days: 14,  id: 'nofap_14',  emoji: '🔥🔥', name: 'Fortnight' },
      { days: 30,  id: 'nofap_30',  emoji: '🔥🔥🔥',name: 'Month' },
      { days: 90,  id: 'nofap_90',  emoji: '⚔️',  name: 'Warrior' },
      { days: 180, id: 'nofap_180', emoji: '👑',  name: 'Brahmacharya' },
      { days: 365, id: 'nofap_365', emoji: '🌟',  name: 'Transcendent' },
    ];
    nofapMilestones.forEach(m => {
      if (nofapCurrent === m.days)
        newBadges.push({ id: m.id, emoji: m.emoji, name: m.name, date: todayDate });
    });
    if (nofapCurrent > C.PERSONAL_BEST_STREAK)
      newBadges.push({ id: 'nofap_record', emoji: '🏆', name: 'Record Broken', date: todayDate });

    // ── Overall Check-in Badges ──
    const checkInMilestones = [
      { n: 1,   id: 'checkin_1',   emoji: '🌱', name: 'First Step' },
      { n: 7,   id: 'checkin_7',   emoji: '📅', name: 'One Week' },
      { n: 30,  id: 'checkin_30',  emoji: '🗓️', name: 'One Month' },
      { n: 90,  id: 'checkin_90',  emoji: '💎', name: 'Quarter' },
      { n: 365, id: 'checkin_365', emoji: '🏔️', name: 'One Year' },
    ];
    checkInMilestones.forEach(m => {
      if (checkIn === m.n)
        newBadges.push({ id: m.id, emoji: m.emoji, name: m.name, date: todayDate });
    });

    // ── Level Badges ──
    const levelEmojis = ['🔵','🟢','🟡','🟠','🔴','🟣','⚪'];
    // (Level badge checking happens in calcLevel — check externally if level just changed)

    return newBadges;
  }

  // ══════════════════════════════════════════════════════════
  //  HABIT GRID DATA  (for habits.html heatmap)
  // ══════════════════════════════════════════════════════════

  /**
   * Build grid data for one habit across all days
   * habitLogRows: rows from Habit Log tab filtered to this habit
   * Returns array of { date, done, value } sorted ascending
   */
  function buildHabitGrid(habitLogRows, habitName) {
    return habitLogRows
      .filter(r => r['Habit Name'] === habitName)
      .map(r => ({
        date:  r['Date'],
        done:  r['Done'] === 'Yes',
        value: r['Value'],
      }))
      .sort((a, b) => parseDate(a.date) - parseDate(b.date));
  }

  // ══════════════════════════════════════════════════════════
  //  MASTER calcDay — compute everything for one day
  // ══════════════════════════════════════════════════════════

  /**
   * The main function dashboards call.
   *
   * day:             one row from Daily tab
   * disciplineRows:  all rows from Discipline tab (for NoFap streak)
   * amritStartDate:  'DD/MM/YYYY' string or ''
   * streaks:         { habitName: days } — pass {} if not available
   * richScore:       pass monthly Rich score or 0
   *
   * Returns full score object for the day.
   */
  function calcDay(day, disciplineRows = [], amritStartDate = '', streaks = {}, richScore = 0) {
    const { current: nofapStreak } = getNoFapStreak(disciplineRows);

    const disc   = calcDisciplineScore(day, nofapStreak);
    const mult   = calcMultiplier(disc.score);

    const smartRaw  = calcSmartScore(day);
    const strongRaw = calcStrongScore(day);

    const smartFinal  = smartRaw.raw  * mult;
    const strongFinal = strongRaw.raw * mult;
    const richFinal   = richScore      * mult;

    const overall = calcOverallScore(disc.score, smartFinal, strongFinal, richFinal);

    const amrits = calcAmrits(
      { ...day, 'Disc Score': disc.score },
      overall,
      streaks,
      amritStartDate
    );

    return {
      date:         day['Date'] || '',
      disc:         parseFloat(disc.score.toFixed(1)),
      discBreakdown: disc.breakdown,
      multiplier:   mult,
      smartRaw:     parseFloat(smartRaw.raw.toFixed(1)),
      smartFinal:   parseFloat(smartFinal.toFixed(1)),
      smartBreakdown: smartRaw.breakdown,
      strongRaw:    parseFloat(strongRaw.raw.toFixed(1)),
      strongFinal:  parseFloat(strongFinal.toFixed(1)),
      strongBreakdown: strongRaw.breakdown,
      richFinal:    parseFloat(richFinal.toFixed(1)),
      overall:      parseFloat(overall.toFixed(1)),
      amrits:       amrits.amrits,
      amritsBreakdown: amrits.breakdown,
      amritBeforeStart: amrits.beforeStart,
    };
  }

  /**
   * Compute scores for all days at once.
   * Returns array sorted by date ascending.
   */
  function calcAllDays(dailyRows, disciplineRows = [], amritStartDate = '', richScore = 0) {
    if (!dailyRows || !dailyRows.length) return [];

    const sorted = [...dailyRows]
      .filter(r => r['Date'])
      .sort((a, b) => parseDate(a['Date']) - parseDate(b['Date']));

    // Build rolling streak map as we go
    const streakMap = {};
    const TRACKED = ['SKY', 'Meditation', 'Push Ups', 'Pull Ups', 'Plank', 'overall'];
    TRACKED.forEach(h => streakMap[h] = 0);

    return sorted.map((day, idx) => {
      // Update streaks for Amrit calculation
      const skyDone  = (parseFloat(day['SKY Mins']) || 0) > 0;
      const medDone  = (parseFloat(day['Meditation Mins']) || 0) > 0;
      const pushDone = !!day['Push Ups'];
      const pullDone = !!day['Pull Ups'];
      const plkDone  = (parseFloat(day['Plank Secs']) || 0) > 0;

      streakMap['SKY']        = skyDone  ? streakMap['SKY']  + 1 : 0;
      streakMap['Meditation'] = medDone  ? streakMap['Meditation'] + 1 : 0;
      streakMap['Push Ups']   = pushDone ? streakMap['Push Ups']  + 1 : 0;
      streakMap['Pull Ups']   = pullDone ? streakMap['Pull Ups']  + 1 : 0;
      streakMap['Plank']      = plkDone  ? streakMap['Plank']     + 1 : 0;
      streakMap['overall']    = idx > 0  ? streakMap['overall']   + 1 : 1;

      return calcDay(day, disciplineRows, amritStartDate, { ...streakMap }, richScore);
    });
  }

  // ══════════════════════════════════════════════════════════
  //  ROLLING AVERAGE HELPERS  (for charts)
  // ══════════════════════════════════════════════════════════

  /**
   * Add 7-day and 30-day rolling averages to an array of day scores
   * Returns same array with .avg7 and .avg30 added
   */
  function addRollingAverages(dayScores) {
    return dayScores.map((d, i, arr) => {
      const slice7  = arr.slice(Math.max(0, i - 6), i + 1).map(x => x.overall);
      const slice30 = arr.slice(Math.max(0, i - 29), i + 1).map(x => x.overall);
      return {
        ...d,
        avg7:  parseFloat((_rollingAvg(slice7, 7)).toFixed(1)),
        avg30: parseFloat((_rollingAvg(slice30, 30)).toFixed(1)),
      };
    });
  }

  // ══════════════════════════════════════════════════════════
  //  FINANCE HELPERS
  // ══════════════════════════════════════════════════════════

  /**
   * Parse finance date: "1 Jul 2024" → Date object
   */
  function parseFinanceDate(str) {
    if (!str) return null;
    const months = {
      jan:0,feb:1,mar:2,apr:3,may:4,jun:5,
      jul:6,aug:7,sep:8,oct:9,nov:10,dec:11
    };
    const parts = String(str).trim().split(' ');
    if (parts.length < 3) return parseDate(str); // fallback
    const d = parseInt(parts[0]);
    const m = months[parts[1].toLowerCase().slice(0,3)];
    const y = parseInt(parts[2]);
    if (isNaN(d) || m === undefined || isNaN(y)) return null;
    return new Date(y, m, d);
  }

  /**
   * Group Finance rows by YYYY-MM
   * Returns { 'YYYY-MM': [rows] }
   */
  function groupFinanceByMonth(financeRows) {
    const groups = {};
    financeRows.forEach(row => {
      const d = parseFinanceDate(row['Date']);
      if (!d) return;
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(row);
    });
    return groups;
  }

  // ══════════════════════════════════════════════════════════
  //  AFFIRMING MESSAGE ENGINE
  // ══════════════════════════════════════════════════════════

  function getMessage(discScore) {
    if (discScore >= 90) return "Perfect discipline today. The practice deepens.";
    if (discScore >= 75) return "Strong day. Every step forward matters.";
    if (discScore >= 50) return "Steady progress. The path is long, walk it gently.";
    if (discScore > 0)   return "Something was earned today. Rest is part of the practice.";
    return "Rest is part of the practice. Tomorrow is a new breath.";
  }

  // ══════════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════════
  return {
    // Core scoring
    calcDisciplineScore,
    calcMultiplier,
    calcSmartScore,
    calcStrongScore,
    calcRichScore,
    calcOverallScore,
    calcConsistencyScore,
    calcGrowthRate,
    calcLevel,
    calcDay,
    calcAllDays,
    addRollingAverages,

    // Streaks & badges
    calcStreak,
    getNoFapStreak,
    checkBadges,

    // Amrits
    calcAmrits,

    // Habit grid
    buildHabitGrid,

    // Parsers (exposed so dashboards can reuse)
    parseSets,
    parseDate,
    formatDate,
    timeToMins,
    calcSleepHours,
    checkTimeWindow,
    parseScreenTime,
    parseFinanceDate,
    groupFinanceByMonth,

    // Utils
    getMessage,

    // Constants (read-only reference)
    C,
  };

})();

// ── Quick self-test (runs only if opened directly in browser) ──
if (typeof window !== 'undefined' && window.location &&
    window.location.protocol === 'file:' &&
    typeof BY !== 'undefined') {
  console.group('🪬 BY analytics.js self-test');

  const testDay = {
    'Date':           '08/04/2026',
    'Bed Time':       '22:30',
    'Wake Time':      '04:50',
    'SKY Mins':       20,
    'Meditation Mins':15,
    'Pranayama':      'Yes',
    'Hand Exercise':  'Yes',
    'NoFap':          'Yes',
    'Screen Time':    '01:30',
    'Push Ups':       '20+20+15+15',
    'Pull Ups':       '10+8+8',
    'Plank Secs':     90,
    'Workout':        'Yes',
    'Workout Type':   'Home',
    'Water':          3,
    'Cardio':         'No',
    'Reading Mins':   35,
    'Focus':          8,
    'Mood':           7,
    'Energy':         8,
  };

  const result = BY.calcDay(testDay, [], '01/04/2026', {}, 0);
  console.log('calcDay result:', result);
  console.log(`  Discipline:  ${result.disc}`);
  console.log(`  Multiplier:  ×${result.multiplier}`);
  console.log(`  Smart:       ${result.smartFinal}`);
  console.log(`  Strong:      ${result.strongFinal}`);
  console.log(`  Overall:     ${result.overall}`);
  console.log(`  Amrits:      ${result.amrits}`);

  const level = BY.calcLevel(7500);
  console.log('calcLevel(7500):', level);

  const sets = BY.parseSets('20+20+15+15');
  console.log('parseSets:', sets);

  console.log('✅ All checks passed');
  console.groupEnd();
}
