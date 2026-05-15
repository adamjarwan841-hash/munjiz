// ==================== إعداد قاعدة البيانات (IndexedDB) ====================
let db;
let currentTaskFilter = 'all';
let confirmCallback = null;

const DB_NAME = 'MunjizDB';
const DB_VERSION = 2;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('tasks')) {
                const store = db.createObjectStore('tasks', { keyPath: 'id', autoIncrement: true });
                store.createIndex('date', 'date', { unique: false });
                store.createIndex('completed', 'completed', { unique: false });
                store.createIndex('priority', 'priority', { unique: false });
            }
            if (!db.objectStoreNames.contains('settings')) {
                db.createObjectStore('settings', { keyPath: 'key' });
            }
        };
    });
}

// ==================== دوال المهام ====================
async function addTask(task) {
    const tx = db.transaction('tasks', 'readwrite');
    return tx.objectStore('tasks').add(task);
}

async function getTasksByDate(date) {
    const tx = db.transaction('tasks', 'readonly');
    const index = tx.objectStore('tasks').index('date');
    return new Promise((resolve) => {
        const tasks = [];
        const request = index.openCursor(IDBKeyRange.only(date));
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                tasks.push(cursor.value);
                cursor.continue();
            } else {
                resolve(tasks);
            }
        };
    });
}

async function getAllTasks() {
    const tx = db.transaction('tasks', 'readonly');
    return new Promise((resolve) => {
        const tasks = [];
        const request = tx.objectStore('tasks').openCursor();
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                tasks.push(cursor.value);
                cursor.continue();
            } else {
                resolve(tasks);
            }
        };
        request.onerror = () => resolve([]);
    });
}

async function updateTask(task) {
    const tx = db.transaction('tasks', 'readwrite');
    return tx.objectStore('tasks').put(task);
}

async function deleteTask(id) {
    const tx = db.transaction('tasks', 'readwrite');
    return tx.objectStore('tasks').delete(id);
}

async function clearAllTasks() {
    const tx = db.transaction('tasks', 'readwrite');
    return tx.objectStore('tasks').clear();
}

// ==================== دوال الإعدادات ====================
async function saveSetting(key, value) {
    const tx = db.transaction('settings', 'readwrite');
    return tx.objectStore('settings').put({ key, value });
}

async function getSetting(key, defaultValue = null) {
    const tx = db.transaction('settings', 'readonly');
    return new Promise((resolve) => {
        const request = tx.objectStore('settings').get(key);
        request.onsuccess = () => {
            resolve(request.result ? request.result.value : defaultValue);
        };
    });
}

// ==================== المتغيرات العامة ====================
let weeklyChart, completionChart, categoryChart, trendChart, priorityChart;
let currentFilter = 'week';

// ==================== تهيئة التطبيق ====================
document.addEventListener('DOMContentLoaded', async () => {
    await openDB();
    await loadSettings();
    await loadDashboard();
    await loadTasks(getTodayDate());
    await loadAnalytics('week');
    await loadHistory();
    await loadStatistics();
    
    updateClock();
    setInterval(updateClock, 1000);
    
    setupEventListeners();
    checkNotifications();
});

function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}

function updateClock() {
    const now = new Date();
    document.getElementById('currentTime').textContent = now.toLocaleTimeString('ar-EG');
}

async function loadSettings() {
    const userName = await getSetting('userName', 'المستخدم');
    document.getElementById('userName').value = userName;
    document.getElementById('userNameDisplay').textContent = userName;
    
    const dailyGoal = await getSetting('dailyGoal', 5);
    document.getElementById('dailyGoalSetting').value = dailyGoal;
    
    const weeklyGoal = await getSetting('weeklyGoal', 20);
    document.getElementById('weeklyGoalSetting').value = weeklyGoal;
    
    const avatar = await getSetting('avatar', '😀');
    document.querySelectorAll('.avatar-option').forEach(opt => {
        if (opt.dataset.avatar === avatar) opt.classList.add('selected');
    });
    
    const notifications = await getSetting('notifications', false);
    document.getElementById('notificationsEnabled').checked = notifications;
    
    const reminderTime = await getSetting('reminderTime', '09:00');
    document.getElementById('reminderTime').value = reminderTime;
    
    const joinDate = await getSetting('joinDate');
    if (!joinDate) {
        saveSetting('joinDate', new Date().toLocaleDateString('ar-EG'));
        document.getElementById('joinDate').textContent = new Date().toLocaleDateString('ar-EG');
    } else {
        document.getElementById('joinDate').textContent = joinDate;
    }
}

function setupEventListeners() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', async () => {
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const page = btn.dataset.page;
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            document.getElementById(`${page}Page`).classList.add('active');
            
            if (page === 'dashboard') await loadDashboard();
            else if (page === 'tasks') await loadTasks(document.getElementById('selectedDate').value);
            else if (page === 'analytics') await loadAnalytics(currentFilter);
            else if (page === 'history') await loadHistory();
            else if (page === 'statistics') await loadStatistics();
        });
    });
    
    document.getElementById('selectedDate').addEventListener('change', async (e) => {
        await loadTasks(e.target.value);
    });
    
    document.getElementById('todayBtn').addEventListener('click', () => {
        document.getElementById('selectedDate').value = getTodayDate();
        loadTasks(getTodayDate());
    });
    
    document.getElementById('openTaskModalBtn').addEventListener('click', () => {
        openModal('taskModal');
    });
    
    document.getElementById('quickAddTaskBtn').addEventListener('click', () => {
        openModal('quickAddModal');
    });
    
    document.querySelectorAll('.close-modal, .close-quick-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            closeModal('taskModal');
            closeModal('quickAddModal');
            closeModal('confirmModal');
        });
    });
    
    document.getElementById('saveTaskBtn').addEventListener('click', async () => {
        const title = document.getElementById('taskTitle').value;
        if (!title) return showNotification('الرجاء إدخال عنوان المهمة', 'warning');
        
        const task = {
            title: title,
            description: document.getElementById('taskDescription').value,
            category: document.getElementById('taskCategory').value,
            priority: document.getElementById('taskPriority').value,
            completed: false,
            date: document.getElementById('selectedDate').value,
            dueDate: document.getElementById('taskDueDate').value,
            createdAt: new Date().toISOString()
        };
        
        await addTask(task);
        closeModal('taskModal');
        document.getElementById('taskTitle').value = '';
        document.getElementById('taskDescription').value = '';
        
        await loadTasks(document.getElementById('selectedDate').value);
        await loadDashboard();
        showNotification('تم إضافة المهمة بنجاح!', 'success');
    });
    
    document.getElementById('quickSaveBtn').addEventListener('click', async () => {
        const title = document.getElementById('quickTaskTitle').value;
        if (!title) return showNotification('الرجاء إدخال عنوان المهمة', 'warning');
        
        const task = {
            title: title,
            description: '',
            category: 'شخصي',
            priority: 'متوسطة',
            completed: false,
            date: document.getElementById('selectedDate').value,
            dueDate: '',
            createdAt: new Date().toISOString()
        };
        
        await addTask(task);
        closeModal('quickAddModal');
        document.getElementById('quickTaskTitle').value = '';
        await loadTasks(document.getElementById('selectedDate').value);
        await loadDashboard();
        showNotification('تم إضافة المهمة بسرعة!', 'success');
    });
    
    document.querySelectorAll('.filter-tab').forEach(btn => {
        btn.addEventListener('click', async () => {
            document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentTaskFilter = btn.dataset.taskFilter;
            await loadTasks(document.getElementById('selectedDate').value);
        });
    });
    
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            await loadAnalytics(currentFilter);
        });
    });
    
    document.getElementById('exportReportBtn')?.addEventListener('click', exportReport);
    document.getElementById('exportChartBtn')?.addEventListener('click', exportChart);
    
    document.getElementById('saveUserName').addEventListener('click', async () => {
        const name = document.getElementById('userName').value;
        await saveSetting('userName', name);
        document.getElementById('userNameDisplay').textContent = name;
        showNotification('تم حفظ الاسم بنجاح', 'success');
    });
    
    document.getElementById('dailyGoalSetting').addEventListener('change', async (e) => {
        await saveSetting('dailyGoal', parseInt(e.target.value));
        await loadDashboard();
    });
    
    document.getElementById('weeklyGoalSetting').addEventListener('change', async (e) => {
        await saveSetting('weeklyGoal', parseInt(e.target.value));
        await loadDashboard();
    });
    
    document.querySelectorAll('.avatar-option').forEach(opt => {
        opt.addEventListener('click', async () => {
            document.querySelectorAll('.avatar-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            await saveSetting('avatar', opt.dataset.avatar);
        });
    });
    
    document.getElementById('notificationsEnabled').addEventListener('change', async (e) => {
        await saveSetting('notifications', e.target.checked);
        if (e.target.checked) requestNotificationPermission();
    });
    
    document.getElementById('reminderTime').addEventListener('change', async (e) => {
        await saveSetting('reminderTime', e.target.value);
    });
    
    document.getElementById('exportDataBtn').addEventListener('click', exportData);
    document.getElementById('importDataBtn').addEventListener('click', () => {
        document.getElementById('importFile').click();
    });
    
    document.getElementById('importFile').addEventListener('change', importData);
    
    document.getElementById('resetDataBtn').addEventListener('click', () => {
        showConfirm('هل أنت متأكد من إعادة تعيين جميع البيانات؟ لا يمكن التراجع عن هذا الإجراء.', async () => {
            await clearAllTasks();
            await loadDashboard();
            await loadTasks(getTodayDate());
            await loadHistory();
            await loadStatistics();
            showNotification('تم إعادة تعيين جميع البيانات', 'success');
        });
    });
    
    document.getElementById('historySearch')?.addEventListener('input', loadHistory);
    document.getElementById('historyFilter')?.addEventListener('change', loadHistory);
    
    document.getElementById('newQuoteBtn')?.addEventListener('click', () => {
        loadRandomQuote();
    });
    
    window.onclick = (event) => {
        if (event.target.classList.contains('modal')) {
            closeModal('taskModal');
            closeModal('quickAddModal');
            closeModal('confirmModal');
        }
    };
}

// ==================== تحميل لوحة التحكم ====================
async function loadDashboard() {
    const allTasks = await getAllTasks();
    const today = getTodayDate();
    
    const todayTasks = allTasks.filter(t => t.date === today);
    const todayCompleted = todayTasks.filter(t => t.completed).length;
    
    const last7Days = getLast7Days();
    const weeklyData = [];
    for (let day of last7Days) {
        const dayTasks = allTasks.filter(t => t.date === day);
        const completed = dayTasks.filter(t => t.completed).length;
        weeklyData.push(dayTasks.length > 0 ? (completed / dayTasks.length) * 100 : 0);
    }
    
    const weeklyAvg = weeklyData.reduce((a, b) => a + b, 0) / 7;
    const totalCompleted = allTasks.filter(t => t.completed).length;
    
    document.getElementById('todayTasksCount').textContent = todayTasks.length;
    document.getElementById('todayCompletedCount').textContent = todayCompleted;
    document.getElementById('weeklyProgress').textContent = Math.round(weeklyAvg);
    document.getElementById('totalCompleted').textContent = totalCompleted;
    document.getElementById('totalTasksDone').textContent = totalCompleted;
    
    let level = 1;
    if (totalCompleted >= 100) level = 5;
    else if (totalCompleted >= 50) level = 4;
    else if (totalCompleted >= 25) level = 3;
    else if (totalCompleted >= 10) level = 2;
    document.getElementById('userLevel').textContent = level;
    
    let streak = 0;
    let currentDate = new Date();
    for (let i = 0; i < 365; i++) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const dayTasks = allTasks.filter(t => t.date === dateStr);
        const hasCompletion = dayTasks.some(t => t.completed);
        if (hasCompletion) streak++;
        else break;
        currentDate.setDate(currentDate.getDate() - 1);
    }
    document.getElementById('streakCount').textContent = streak;
    
    const dailyGoal = await getSetting('dailyGoal', 5);
    const weeklyGoal = await getSetting('weeklyGoal', 20);
    document.getElementById('dailyGoalTarget').textContent = dailyGoal;
    document.getElementById('weeklyGoalTarget').textContent = weeklyGoal;
    
    const dailyPercent = Math.min((todayCompleted / dailyGoal) * 100, 100);
    document.getElementById('dailyGoalProgress').style.width = `${dailyPercent}%`;
    document.getElementById('dailyGoalStatus').textContent = `${todayCompleted}/${dailyGoal} مكتملة`;
    
    const weeklyTotal = allTasks.filter(t => {
        const taskDate = new Date(t.date);
        const now = new Date();
        const weekAgo = new Date(now.setDate(now.getDate() - 7));
        return taskDate >= weekAgo && t.completed;
    }).length;
    const weeklyPercent = Math.min((weeklyTotal / weeklyGoal) * 100, 100);
    document.getElementById('weeklyGoalProgress').style.width = `${weeklyPercent}%`;
    document.getElementById('weeklyGoalStatus').textContent = `${weeklyTotal}/${weeklyGoal} مكتملة`;
    
    const achievements = calculateAchievements(allTasks, streak, totalCompleted);
    document.getElementById('achievementsCount').textContent = achievements.length;
    const recentAchievements = achievements.slice(-3);
    document.getElementById('recentAchievements').innerHTML = recentAchievements.map(a => 
        `<span class="achievement-badge">🏆 ${a}</span>`
    ).join('');
    if (recentAchievements.length === 0) {
        document.getElementById('recentAchievements').innerHTML = '<span style="color:var(--gray);">ابدأ بإنجاز مهامك أولاً 🚀</span>';
    }
    
    if (weeklyChart) weeklyChart.destroy();
    const ctx = document.getElementById('weeklyChart').getContext('2d');
    weeklyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: last7Days.map(d => d.split('-').slice(1).join('/')),
            datasets: [{
                label: 'نسبة الإنجاز %',
                data: weeklyData,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 5,
                pointBackgroundColor: '#10b981'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: { legend: { position: 'top' } }
        }
    });
    
    loadRandomQuote();
}

function calculateAchievements(tasks, streak, totalCompleted) {
    const achievements = [];
    if (streak >= 7) achievements.push(`سلسلة ${streak} أيام متتالية 🎯`);
    if (streak >= 30) achievements.push('شهر كامل من الإنتاجية 🔥');
    if (totalCompleted >= 100) achievements.push('إنجاز 100 مهمة 🏅');
    else if (totalCompleted >= 50) achievements.push('إنجاز 50 مهمة 🌟');
    else if (totalCompleted >= 10) achievements.push('أول 10 مهام ✅');
    
    const tasksToday = tasks.filter(t => t.date === getTodayDate() && t.completed).length;
    const dailyGoal = 5;
    if (tasksToday >= dailyGoal) achievements.push('حققت هدف اليوم 🎯');
    
    const categories = ['عمل', 'شخصي', 'دراسة', 'رياضة'];
    for (let cat of categories) {
        const catCompleted = tasks.filter(t => t.category === cat && t.completed).length;
        if (catCompleted >= 20) achievements.push(`خبير في ${cat} 💼`);
        else if (catCompleted >= 10) achievements.push(`متميز في ${cat} 📈`);
    }
    
    return [...new Set(achievements)];
}

function loadRandomQuote() {
    const quotes = [
        "🌟 النجاح ليس محطة وصول، بل رحلة مستمرة",
        "💪 لا تقارن نفسك بالآخرين، قارن نفسك بنسخة الأمس منك",
        "🎯 الرحلة تبدأ بخطوة واحدة، مهما كانت صغيرة",
        "🏆 الإنجازات الصغيرة تبني النجاحات الكبيرة",
        "✨ كل يوم هو فرصة جديدة لتصبح أفضل",
        "📚 المعرفة وحدها لا تكفي، يجب تطبيقها",
        "🧘 النجاح هو تحقيق التوازن بين العمل والحياة",
        "🚀 استمر في التقدم، حتى لو كان بطيئاً",
        "💎 الإتقان في العمل عبادة",
        "⭐ لا تؤجل عمل اليوم إلى الغد"
    ];
    document.getElementById('motivationText').textContent = quotes[Math.floor(Math.random() * quotes.length)];
}

// ==================== تحميل المهام ====================
async function loadTasks(date) {
    let tasks = await getTasksByDate(date);
    
    switch(currentTaskFilter) {
        case 'pending': tasks = tasks.filter(t => !t.completed); break;
        case 'completed': tasks = tasks.filter(t => t.completed); break;
        case 'high': tasks = tasks.filter(t => t.priority === 'عالية'); break;
    }
    
    const container = document.getElementById('tasksContainer');
    if (tasks.length === 0) {
        container.innerHTML = '<div class="task-item" style="justify-content:center;color:var(--gray)">📭 لا توجد مهام | اضف مهمة جديدة ➕</div>';
        return;
    }
    
    container.innerHTML = tasks.map(task => `
        <div class="task-item" data-id="${task.id}">
            <div class="task-info">
                <input type="checkbox" class="task-check" ${task.completed ? 'checked' : ''} data-id="${task.id}">
                <span class="task-title ${task.completed ? 'completed' : ''}">${escapeHtml(task.title)}</span>
                <span class="task-category">${task.category}</span>
                <span class="task-priority priority-${getPriorityClass(task.priority)}">${task.priority}</span>
                ${task.description ? `<small style="color:var(--gray)">📝 ${escapeHtml(task.description.substring(0, 30))}</small>` : ''}
            </div>
            <button class="delete-task" data-id="${task.id}"><i class="fas fa-trash"></i></button>
        </div>
    `).join('');
    
    document.querySelectorAll('.task-check').forEach(cb => {
        cb.addEventListener('change', async (e) => {
            const taskId = Number(e.target.dataset.id);
            const tasksList = await getTasksByDate(date);
            const task = tasksList.find(t => t.id === taskId);
            if (task) {
                task.completed = e.target.checked;
                await updateTask(task);
                await loadTasks(date);
                await loadDashboard();
                if (task.completed) showNotification('🎉 مبروك! تم إنجاز المهمة', 'success');
            }
        });
    });
    
    document.querySelectorAll('.delete-task').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const taskId = Number(btn.dataset.id);
            showConfirm('هل تريد حذف هذه المهمة؟', async () => {
                await deleteTask(taskId);
                await loadTasks(date);
                await loadDashboard();
                await loadHistory();
                showNotification('تم حذف المهمة', 'info');
            });
        });
    });
}

// ==================== تحميل التحليلات ====================
async function loadAnalytics(filter) {
    const allTasks = await getAllTasks();
    const now = new Date();
    let filteredTasks = allTasks;
    
    if (filter === 'week') {
        const weekAgo = new Date(now.setDate(now.getDate() - 7));
        filteredTasks = allTasks.filter(t => new Date(t.date) >= weekAgo);
    } else if (filter === 'month') {
        const monthAgo = new Date(now.setMonth(now.getMonth() - 1));
        filteredTasks = allTasks.filter(t => new Date(t.date) >= monthAgo);
    } else if (filter === 'year') {
        const yearAgo = new Date(now.setFullYear(now.getFullYear() - 1));
        filteredTasks = allTasks.filter(t => new Date(t.date) >= yearAgo);
    }
    
    const completed = filteredTasks.filter(t => t.completed).length;
    const notCompleted = filteredTasks.length - completed;
    
    if (completionChart) completionChart.destroy();
    const ctx1 = document.getElementById('completionChart').getContext('2d');
    completionChart = new Chart(ctx1, {
        type: 'doughnut',
        data: {
            labels: ['منجزة', 'غير منجزة'],
            datasets: [{
                data: [completed, notCompleted],
                backgroundColor: ['#10b981', '#e5e7eb'],
                borderWidth: 0
            }]
        },
        options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: 'bottom' } } }
    });
    
    const categories = { عمل: 0, شخصي: 0, دراسة: 0, رياضة: 0, منزل: 0, تطوير: 0 };
    filteredTasks.forEach(t => { if (t.completed && categories[t.category] !== undefined) categories[t.category]++; });
    
    if (categoryChart) categoryChart.destroy();
    const ctx2 = document.getElementById('categoryChart').getContext('2d');
    categoryChart = new Chart(ctx2, {
        type: 'bar',
        data: {
            labels: Object.keys(categories),
            datasets: [{
                label: 'المهام المنجزة',
                data: Object.values(categories),
                backgroundColor: '#8b5cf6',
                borderRadius: 10
            }]
        },
        options: { responsive: true, maintainAspectRatio: true }
    });
    
    const last7Days = getLast7Days();
    const trendData = [];
    for (let day of last7Days) {
        const dayTasks = filteredTasks.filter(t => t.date === day);
        const completedCount = dayTasks.filter(t => t.completed).length;
        trendData.push(completedCount);
    }
    
    if (trendChart) trendChart.destroy();
    const ctx3 = document.getElementById('trendChart').getContext('2d');
    trendChart = new Chart(ctx3, {
        type: 'line',
        data: {
            labels: last7Days.map(d => d.split('-').slice(1).join('/')),
            datasets: [{
                label: 'عدد المهام المنجزة',
                data: trendData,
                borderColor: '#f59e0b',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                fill: true,
                tension: 0.3
            }]
        },
        options: { responsive: true, maintainAspectRatio: true }
    });
    
    const priorities = { عالية: 0, متوسطة: 0, منخفضة: 0 };
    filteredTasks.forEach(t => { if (t.completed) priorities[t.priority]++; });
    
    if (priorityChart) priorityChart.destroy();
    const ctx4 = document.getElementById('priorityChart').getContext('2d');
    priorityChart = new Chart(ctx4, {
        type: 'pie',
        data: {
            labels: ['عالية', 'متوسطة', 'منخفضة'],
            datasets: [{
                data: [priorities.عالية, priorities.متوسطة, priorities.منخفضة],
                backgroundColor: ['#ef4444', '#f59e0b', '#10b981']
            }]
        },
        options: { responsive: true, maintainAspectRatio: true }
    });
    
    const total = filteredTasks.length;
    const percentage = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;
    document.getElementById('insightsContent').innerHTML = `
        <p>📈 نسبة الإنجاز الإجمالية: <strong style="font-size:24px">${percentage}%</strong></p>
        <p>✅ المهام المنجزة: <strong>${completed}</strong> | 📋 إجمالي المهام: <strong>${total}</strong></p>
        <p>🎯 أفضل يوم للإنجاز: <strong>${await getBestDay(filteredTasks)}</strong></p>
        <p>⚡ سرعة الإنجاز: ${calculateProductivitySpeed(filteredTasks)}</p>
        ${percentage > 70 ? '<p>🎉 ممتاز! أنت في قمة إنتاجيتك! استمر 🚀</p>' : percentage > 40 ? '<p>👍 أداء جيد، يمكنك تحسينه أكثر</p>' : '<p>💪 ابدأ بوضع أهداف صغيرة وحققها يومياً</p>'}
    `;
}

async function getBestDay(tasks) {
    const dayStats = {};
    tasks.forEach(t => {
        const day = new Date(t.date).toLocaleDateString('ar-EG', { weekday: 'long' });
        if (t.completed) dayStats[day] = (dayStats[day] || 0) + 1;
    });
    const bestDay = Object.entries(dayStats).sort((a,b) => b[1] - a[1])[0];
    return bestDay ? `${bestDay[0]} (${bestDay[1]} مهام)` : 'لا توجد بيانات';
}

function calculateProductivitySpeed(tasks) {
    const completedTasks = tasks.filter(t => t.completed);
    if (completedTasks.length === 0) return 'لا توجد مهام منجزة';
    const avgPerDay = completedTasks.length / 7;
    if (avgPerDay >= 5) return 'سريع جداً 🚀';
    if (avgPerDay >= 3) return 'جيد 👍';
    return 'يمكن تحسينه 💪';
}

// ==================== تحميل السجل ====================
async function loadHistory() {
    let allTasks = await getAllTasks();
    const searchTerm = document.getElementById('historySearch')?.value.toLowerCase() || '';
    const filter = document.getElementById('historyFilter')?.value || 'all';
    
    let filtered = allTasks;
    if (searchTerm) filtered = filtered.filter(t => t.title.toLowerCase().includes(searchTerm));
    if (filter === 'completed') filtered = filtered.filter(t => t.completed);
    if (filter === 'pending') filtered = filtered.filter(t => !t.completed);
    
    const sorted = filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
    const container = document.getElementById('historyList');
    
    if (sorted.length === 0) {
        container.innerHTML = '<div class="history-item" style="justify-content:center">📋 لا توجد مهام</div>';
        return;
    }
    
    container.innerHTML = sorted.slice(0, 50).map(task => `
        <div class="history-item">
            <div>
                <strong>${escapeHtml(task.title)}</strong>
                <span style="margin-right:15px;color:var(--gray)">📅 ${task.date}</span>
                <span style="margin-right:10px;padding:2px 10px;background:#f3f4f6;border-radius:12px">${task.category}</span>
            </div>
            <span style="color:${task.completed ? '#10b981' : '#ef4444'}">
                ${task.completed ? '✅ منجزة' : '⏳ غير منجزة'}
            </span>
        </div>
    `).join('');
}

// ==================== تحميل الإحصائيات المتقدمة (نسخة مصححة) ====================
async function loadStatistics() {
    const allTasks = await getAllTasks();
    
    // ========== 1. أكثر أيام إنتاجية ==========
    const dayStats = {};
    const dayNames = {
        'Sunday': 'الأحد',
        'Monday': 'الإثنين',
        'Tuesday': 'الثلاثاء',
        'Wednesday': 'الأربعاء',
        'Thursday': 'الخميس',
        'Friday': 'الجمعة',
        'Saturday': 'السبت'
    };
    
    allTasks.forEach(t => {
        if (t.completed && t.date) {
            const dateObj = new Date(t.date);
            if (!isNaN(dateObj.getTime())) {
                const dayIndex = dateObj.getDay();
                const dayName = Object.values(dayNames)[dayIndex];
                dayStats[dayName] = (dayStats[dayName] || 0) + 1;
            }
        }
    });
    
    const bestDayEntry = Object.entries(dayStats).sort((a, b) => b[1] - a[1])[0];
    if (bestDayEntry && bestDayEntry[0] !== 'Invalid Date') {
        document.getElementById('bestDay').textContent = bestDayEntry[0];
        document.getElementById('bestDayCount').textContent = `${bestDayEntry[1]} مهمة`;
    } else {
        document.getElementById('bestDay').textContent = 'لا توجد بيانات';
        document.getElementById('bestDayCount').textContent = '0 مهمة';
    }
    
    // ========== 2. أفضل فئة أداء ==========
    const categoryStats = {};
    const categoryTotal = {};
    
    allTasks.forEach(t => {
        if (t.category) {
            categoryTotal[t.category] = (categoryTotal[t.category] || 0) + 1;
            if (t.completed) {
                categoryStats[t.category] = (categoryStats[t.category] || 0) + 1;
            }
        }
    });
    
    let bestCategory = null;
    let bestPercent = 0;
    for (const cat in categoryStats) {
        const percent = categoryTotal[cat] > 0 ? (categoryStats[cat] / categoryTotal[cat]) * 100 : 0;
        if (percent > bestPercent) {
            bestPercent = percent;
            bestCategory = cat;
        }
    }
    
    if (bestCategory) {
        document.getElementById('bestCategory').textContent = bestCategory;
        document.getElementById('bestCategoryPercent').textContent = `${Math.round(bestPercent)}%`;
    } else {
        document.getElementById('bestCategory').textContent = 'لا توجد بيانات';
        document.getElementById('bestCategoryPercent').textContent = '0%';
    }
    
    // ========== 3. متوسط المهام يومياً ==========
    const uniqueDays = [...new Set(allTasks.map(t => t.date).filter(d => d))];
    const avgPerDay = uniqueDays.length > 0 ? (allTasks.length / uniqueDays.length).toFixed(1) : 0;
    document.getElementById('avgTasksPerDay').textContent = avgPerDay;
    
    // ========== 4. أفضل سلسلة متتالية ==========
    let currentStreak = 0;
    let bestStreak = 0;
    
    const completedDates = [...new Set(
        allTasks.filter(t => t.completed && t.date)
                .map(t => t.date)
    )].sort();
    
    if (completedDates.length > 0) {
        currentStreak = 1;
        bestStreak = 1;
        
        for (let i = 1; i < completedDates.length; i++) {
            const prevDate = new Date(completedDates[i - 1]);
            const currDate = new Date(completedDates[i]);
            const diffDays = Math.round((currDate - prevDate) / (1000 * 60 * 60 * 24));
            
            if (diffDays === 1) {
                currentStreak++;
                bestStreak = Math.max(bestStreak, currentStreak);
            } else {
                currentStreak = 1;
            }
        }
    }
    
    document.getElementById('bestStreak').textContent = bestStreak;
    
    // ========== 5. خريطة النشاط الشهرية ==========
    const last30Days = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        d.setHours(0, 0, 0, 0);
        last30Days.push(d.toISOString().split('T')[0]);
    }
    
    const heatmap = document.getElementById('activityHeatmap');
    if (heatmap) {
        heatmap.innerHTML = last30Days.map(date => {
            const dayTasks = allTasks.filter(t => t.date === date);
            const completed = dayTasks.filter(t => t.completed).length;
            const total = dayTasks.length;
            
            let status = '';
            let titleText = `${date}: `;
            
            if (completed > 0) {
                status = 'completed';
                titleText += `${completed} مهام منجزة`;
            } else if (total > 0) {
                status = 'partial';
                titleText += `${total} مهام (غير منجزة)`;
            } else {
                status = '';
                titleText += 'لا توجد مهام';
            }
            
            const dayNum = new Date(date).getDate();
            return `<div class="heatmap-day ${status}" title="${titleText}">${dayNum}</div>`;
        }).join('');
    }
    
    // ========== 6. نصائح ==========
    const tips = [
        '🎯 ابدأ يومك بأصعب مهمة (أكل الضفدع)',
        '⏰ استخدم تقنية بومودورو: 25 دقيقة عمل + 5 دقيقة راحة',
        '📝 قائمة المهام يجب ألا تتجاوز 5-7 مهام يومياً',
        '🔕 أطفئ الإشعارات أثناء فترات التركيز',
        '🧘 خذ فترات راحة قصيرة كل ساعة',
        '🎉 كافئ نفسك عند إنجاز المهام الكبيرة',
        '📊 راجع تقدمك أسبوعياً لتحديد نقاط القوة والضعف',
        '🌙 نم جيداً فالنوم الجيد يزيد الإنتاجية',
        '📈 قسم المهام الكبيرة إلى مهام صغيرة',
        '✍️ دوّن إنجازاتك يومياً لتحفيز نفسك'
    ];
    
    const tipsList = document.getElementById('tipsList');
    if (tipsList) {
        tipsList.innerHTML = tips.map(tip => `<li>${tip}</li>`).join('');
    }
}

// ==================== دوال مساعدة ====================
function getPriorityClass(priority) {
    if (priority === 'عالية') return 'high';
    if (priority === 'متوسطة') return 'medium';
    return 'low';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getLast7Days() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(d.toISOString().split('T')[0]);
    }
    return days;
}

function openModal(modalId) {
    document.getElementById(modalId).style.display = 'flex';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: ${type === 'success' ? '#10b981' : type === 'warning' ? '#f59e0b' : '#3b82f6'};
        color: white;
        padding: 12px 20px;
        border-radius: 12px;
        z-index: 2000;
        animation: slideIn 0.3s ease;
        font-weight: 500;
        direction: rtl;
        font-family: 'Cairo', sans-serif;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

function showConfirm(message, callback) {
    document.getElementById('confirmMessage').textContent = message;
    confirmCallback = callback;
    openModal('confirmModal');
}

document.getElementById('confirmYesBtn')?.addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    closeModal('confirmModal');
    confirmCallback = null;
});

document.getElementById('confirmNoBtn')?.addEventListener('click', () => {
    closeModal('confirmModal');
    confirmCallback = null;
});

async function exportData() {
    const allTasks = await getAllTasks();
    const settings = {
        userName: await getSetting('userName', ''),
        dailyGoal: await getSetting('dailyGoal', 5),
        weeklyGoal: await getSetting('weeklyGoal', 20),
        avatar: await getSetting('avatar', '😀'),
        notifications: await getSetting('notifications', false),
        reminderTime: await getSetting('reminderTime', '09:00'),
        joinDate: await getSetting('joinDate', new Date().toLocaleDateString('ar-EG'))
    };
    const exportObj = { tasks: allTasks, settings, exportDate: new Date().toISOString() };
    const dataStr = JSON.stringify(exportObj, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `munjiz_backup_${getTodayDate()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('تم تصدير البيانات بنجاح', 'success');
}

async function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (data.tasks && Array.isArray(data.tasks)) {
                await clearAllTasks();
                for (const task of data.tasks) {
                    delete task.id;
                    await addTask(task);
                }
            }
            if (data.settings) {
                for (const [key, value] of Object.entries(data.settings)) {
                    await saveSetting(key, value);
                }
            }
            await loadSettings();
            await loadDashboard();
            await loadTasks(getTodayDate());
            await loadHistory();
            await loadStatistics();
            showNotification('تم استيراد البيانات بنجاح', 'success');
        } catch (err) {
            showNotification('خطأ في ملف الاستيراد', 'warning');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

async function exportChart() {
    const chartCanvas = document.getElementById('weeklyChart');
    if (!chartCanvas) return;
    const link = document.createElement('a');
    link.download = `munjiz_chart_${getTodayDate()}.png`;
    link.href = chartCanvas.toDataURL();
    link.click();
    showNotification('تم تصدير الرسم البياني', 'success');
}

async function exportReport() {
    const allTasks = await getAllTasks();
    const completed = allTasks.filter(t => t.completed).length;
    const streak = document.getElementById('streakCount').textContent;
    const level = document.getElementById('userLevel').textContent;
    const report = `
╔══════════════════════════════════════╗
║         تقرير الإنجازات - مُنجِز         ║
╠══════════════════════════════════════╣
║ التاريخ: ${new Date().toLocaleDateString('ar-EG')}
╠══════════════════════════════════════╣
║ ✅ إجمالي المهام المنجزة: ${completed}
║ 📋 إجمالي المهام: ${allTasks.length}
║ 📈 نسبة الإنجاز: ${allTasks.length > 0 ? ((completed / allTasks.length) * 100).toFixed(1) : 0}%
║ 🔥 الأيام المتتالية: ${streak}
║ 🏆 المستوى: ${level}
╚══════════════════════════════════════╝
تم التصدير من منصة مُنجِز - MUNJIZ
    `;
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `munjiz_report_${getTodayDate()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('تم تصدير التقرير', 'success');
}

async function requestNotificationPermission() {
    if ('Notification' in window) {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            showNotification('سيتم إرسال التذكيرات اليومية', 'success');
        }
    }
}

async function checkNotifications() {
    const enabled = await getSetting('notifications', false);
    const reminderTime = await getSetting('reminderTime', '09:00');
    if (enabled && 'Notification' in window && Notification.permission === 'granted') {
        const now = new Date();
        const [hours, minutes] = reminderTime.split(':');
        if (now.getHours() === parseInt(hours) && now.getMinutes() === parseInt(minutes)) {
            const tasksToday = await getTasksByDate(getTodayDate());
            const pending = tasksToday.filter(t => !t.completed).length;
            if (pending > 0) {
                new Notification('تذكير بالمهام - مُنجِز', {
                    body: `لديك ${pending} مهام غير مكتملة اليوم!`,
                    icon: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'
                });
            }
        }
    }
}

setInterval(checkNotifications, 60000);

const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
`;
document.head.appendChild(style);
