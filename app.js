const STORAGE_KEY = "weekfocus_tasks";
const WEEKDAYS = [
  { key: "monday", name: "Понедельник" },
  { key: "tuesday", name: "Вторник" },
  { key: "wednesday", name: "Среда" },
  { key: "thursday", name: "Четверг" },
  { key: "friday", name: "Пятница" },
  { key: "saturday", name: "Суббота" },
  { key: "sunday", name: "Воскресенье" },
];
const WEEKDAY_SHORT_LABELS = {
  monday: "Пн",
  tuesday: "Вт",
  wednesday: "Ср",
  thursday: "Чт",
  friday: "Пт",
  saturday: "Сб",
  sunday: "Вс",
};
const CATEGORIES = ["work", "personal", "home", "study", "meetings"];
const CATEGORY_LABELS = {
  work: "Работа",
  personal: "Личное",
  home: "Дом",
  study: "Учеба",
  meetings: "Встречи",
};
const PRIORITIES = [
  { key: "normal", label: "Обычная" },
  { key: "important", label: "Важная" },
  { key: "critical", label: "Критичная" },
];
const PRIORITY_SORT_WEIGHT = {
  critical: 0,
  important: 1,
  normal: 2,
};
const YANDEX_TOKEN_KEY = "weekfocus_yandex_token";
const YANDEX_CLIENT_ID = "";
const YANDEX_AUTH_URL = "https://oauth.yandex.ru/authorize";
const YANDEX_EVENTS_ENDPOINT = "https://api.calendar.yandex.net/v1/events";
const YANDEX_SYNC_INTERVAL_MS = 3600000;

var tasks = loadTasks();
var displayedWeekDate = normalizeDate(new Date());
var selectedDateKey = formatDateKey(displayedWeekDate);
var activeCategoryFilter = null;
var pendingRegularDeleteTaskId = null;
var yandexSyncIntervalId = null;
var inlineTaskDraft = null;

function loadTasks() {
  const savedTasks = localStorage.getItem(STORAGE_KEY);

  if (!savedTasks) {
    return [];
  }

  try {
    const parsedTasks = JSON.parse(savedTasks);
    return Array.isArray(parsedTasks) ? parsedTasks : [];
  } catch (error) {
    console.warn("Не удалось прочитать weekfocus_tasks из localStorage.", error);
    return [];
  }
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function isValidDateKey(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidTimeValue(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidTaskShape(task) {
  return (
    task &&
    typeof task === "object" &&
    (typeof task.id === "number" || typeof task.id === "string") &&
    typeof task.title === "string" &&
    CATEGORIES.includes(task.category) &&
    PRIORITIES.some((priority) => priority.key === task.priority) &&
    isValidDateKey(task.date) &&
    typeof task.isCompleted === "boolean"
  );
}

function normalizeImportedTask(task) {
  if (!isValidTaskShape(task)) {
    return null;
  }

  return {
    id: task.id,
    title: task.title,
    category: task.category,
    priority: task.priority,
    date: task.date,
    time: isValidTimeValue(task.time) ? task.time : null,
    isCompleted: task.isCompleted,
    isRegular: Boolean(task.isRegular),
    isRegularTemplate: Boolean(task.isRegularTemplate),
    isRegularDeleted: Boolean(task.isRegularDeleted),
    regularSeriesId: task.regularSeriesId || null,
    detachedRegularSeriesId: task.detachedRegularSeriesId || null,
    deletedRegularSeriesId: task.deletedRegularSeriesId || null,
    regularDays: Array.isArray(task.regularDays)
      ? task.regularDays.filter((day) => WEEKDAYS.some((weekday) => weekday.key === day))
      : [],
    dateStart: isValidDateKey(task.dateStart) ? task.dateStart : null,
    dateEnd: isValidDateKey(task.dateEnd) ? task.dateEnd : null,
    yandexEventId: task.yandexEventId || null,
  };
}

function parseBackupPayload(text) {
  let parsedData;

  try {
    parsedData = JSON.parse(text);
  } catch (error) {
    throw new Error("Файл не является корректным JSON.");
  }

  if (!Array.isArray(parsedData)) {
    throw new Error("Файл бэкапа должен содержать массив задач.");
  }

  const normalizedTasks = parsedData.map(normalizeImportedTask);

  if (normalizedTasks.some((task) => task === null)) {
    throw new Error("Структура задач в файле не соответствует схеме weekfocus.");
  }

  return normalizedTasks;
}

function exportBackup() {
  const backupSource = localStorage.getItem(STORAGE_KEY) || JSON.stringify(tasks);
  const backupBlob = new Blob([backupSource], { type: "application/json" });
  const backupUrl = URL.createObjectURL(backupBlob);
  const downloadLink = document.createElement("a");

  downloadLink.href = backupUrl;
  downloadLink.download = "weekfocus_backup.json";
  document.body.append(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  URL.revokeObjectURL(backupUrl);
}

function importBackupFile(file) {
  if (!file) {
    return;
  }

  const reader = new FileReader();

  reader.addEventListener("load", () => {
    try {
      tasks = parseBackupPayload(String(reader.result || ""));
      window.tasks = tasks;
      saveTasks();
      renderCalendar();
      window.alert("Бэкап успешно импортирован.");
    } catch (error) {
      window.alert(error.message || "Не удалось импортировать файл бэкапа.");
    }
  });

  reader.addEventListener("error", () => {
    window.alert("Не удалось прочитать файл бэкапа.");
  });

  reader.readAsText(file);
}

function normalizeDate(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
}

function addDays(date, days) {
  const result = normalizeDate(date);
  result.setDate(result.getDate() + days);
  return result;
}

function getWeekStart(date) {
  const normalizedDate = normalizeDate(date);
  const dayOffsetFromMonday = (normalizedDate.getDay() + 6) % 7;
  return addDays(normalizedDate, -dayOffsetFromMonday);
}

function getWeekDates(date) {
  const weekStart = getWeekStart(date);
  return WEEKDAYS.map((weekday, index) => ({
    ...weekday,
    date: addDays(weekStart, index),
  }));
}

function isSameDate(firstDate, secondDate) {
  return (
    firstDate.getFullYear() === secondDate.getFullYear() &&
    firstDate.getMonth() === secondDate.getMonth() &&
    firstDate.getDate() === secondDate.getDate()
  );
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function formatTimelineDate(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}`;
}

function formatShortYearDate(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(-2);
  return `${day}.${month}.${year}`;
}

function formatTodayInformer(date) {
  const formatter = new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.weekday}, ${parts.day} ${parts.month} ${parts.year}`;
}

function getTasksByDate(dateKey) {
  return tasks.filter((task) => !task.isRegularTemplate && !task.isRegularDeleted && task.date === dateKey);
}

function getVisibleTasksByDate(dateKey) {
  const dayTasks = getTasksByDate(dateKey);

  return sortTasksForDay(applyCategoryFilter(dayTasks));
}

function applyCategoryFilter(taskList) {
  if (!activeCategoryFilter) {
    return taskList;
  }

  return taskList.filter((task) => task.category === activeCategoryFilter);
}

function sortTasksForDay(taskList) {
  return [...taskList].sort((firstTask, secondTask) => {
    const priorityDiff = (PRIORITY_SORT_WEIGHT[firstTask.priority] ?? 99) - (PRIORITY_SORT_WEIGHT[secondTask.priority] ?? 99);

    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    if (firstTask.time && secondTask.time && firstTask.time !== secondTask.time) {
      return firstTask.time.localeCompare(secondTask.time);
    }

    if (firstTask.time && !secondTask.time) {
      return -1;
    }

    if (!firstTask.time && secondTask.time) {
      return 1;
    }

    return String(firstTask.id).localeCompare(String(secondTask.id), "ru", { numeric: true });
  });
}

function getTasksByDateRange(startKey, endKey) {
  return tasks.filter((task) => (
    !task.isRegularTemplate &&
    !task.isRegularDeleted &&
    task.date >= startKey &&
    task.date <= endKey
  ));
}

function getOverdueTasks() {
  const todayKey = formatDateKey(new Date());
  return applyCategoryFilter(tasks.filter((task) => (
    !task.isRegularTemplate &&
    !task.isRegularDeleted &&
    !task.isCompleted &&
    task.date < todayKey
  )));
}

function getTaskById(taskId) {
  return tasks.find((item) => String(item.id) === String(taskId));
}

function getWeekdayKey(date) {
  const dayIndex = (normalizeDate(date).getDay() + 6) % 7;
  return WEEKDAYS[dayIndex].key;
}

function generateSeriesId() {
  return `regular-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getRegularSeriesTemplates() {
  const templates = new Map();

  tasks
    .filter((task) => task.isRegular && task.regularSeriesId)
    .forEach((task) => {
      const currentTemplate = templates.get(task.regularSeriesId);
      const taskStart = task.dateStart || task.date;

      if (!currentTemplate || task.isRegularTemplate || taskStart < currentTemplate.dateStart) {
        templates.set(task.regularSeriesId, {
          ...task,
          dateStart: taskStart,
          regularDays: Array.isArray(task.regularDays) && task.regularDays.length > 0
            ? task.regularDays
            : [getWeekdayKey(parseDateKey(task.date))],
        });
      }
    });

  return Array.from(templates.values());
}

function hasRegularInstance(seriesId, dateKey) {
  return tasks.some((task) => (
    !task.isRegularTemplate &&
    task.date === dateKey &&
    (task.regularSeriesId === seriesId || task.detachedRegularSeriesId === seriesId || task.deletedRegularSeriesId === seriesId)
  ));
}

function createRegularInstance(template, dateKey) {
  return {
    id: `${template.regularSeriesId}-${dateKey}`,
    title: template.title,
    category: template.category,
    priority: template.priority,
    date: dateKey,
    time: template.time || null,
    isCompleted: false,
    isRegular: true,
    regularSeriesId: template.regularSeriesId,
    regularDays: [...template.regularDays],
    dateStart: template.dateStart,
    dateEnd: template.dateEnd || null,
    yandexEventId: null,
  };
}

function generateRegularTasksForDates(dates) {
  let hasNewTasks = false;
  const templates = getRegularSeriesTemplates();

  templates.forEach((template) => {
    dates.forEach((date) => {
      const dateKey = formatDateKey(date);
      const weekdayKey = getWeekdayKey(date);
      const isInSeriesRange = dateKey >= template.dateStart && (!template.dateEnd || dateKey <= template.dateEnd);

      if (!isInSeriesRange || !template.regularDays.includes(weekdayKey) || hasRegularInstance(template.regularSeriesId, dateKey)) {
        return;
      }

      tasks.push(createRegularInstance(template, dateKey));
      hasNewTasks = true;
    });
  });

  if (hasNewTasks) {
    saveTasks();
  }
}

function generateRegularTasksForVisiblePeriods() {
  const displayedWeekDates = getWeekDates(displayedWeekDate).map((day) => day.date);
  const currentWeekDates = getWeekDates(new Date()).map((day) => day.date);
  const datesByKey = new Map();

  [...displayedWeekDates, ...currentWeekDates].forEach((date) => {
    datesByKey.set(formatDateKey(date), date);
  });

  generateRegularTasksForDates(Array.from(datesByKey.values()));
}

function getUpcomingImportantTasks() {
  const tomorrowKey = formatDateKey(addDays(new Date(), 1));
  const weekEndKey = formatDateKey(addDays(getWeekStart(displayedWeekDate), 6));
  const importantPriorities = new Set(["critical", "important"]);

  if (weekEndKey < tomorrowKey) {
    return [];
  }

  return applyCategoryFilter(tasks
    .filter((task) => (
      !task.isRegularTemplate &&
      !task.isRegularDeleted &&
      !task.isCompleted &&
      importantPriorities.has(task.priority) &&
      task.date >= tomorrowKey &&
      task.date <= weekEndKey
    ))
    .sort((firstTask, secondTask) => firstTask.date.localeCompare(secondTask.date)));
}

function getCategoryIcon(category) {
  const sourceIcon = document.getElementById(`icon-${category}`);

  if (!sourceIcon) {
    const fallbackIcon = document.createElement("span");
    fallbackIcon.className = "task-item__icon";
    fallbackIcon.textContent = "•";
    return fallbackIcon;
  }

  const icon = sourceIcon.cloneNode(true);
  icon.removeAttribute("id");
  icon.classList.remove("category-icon");
  icon.classList.add("task-item__icon");
  icon.classList.add(`task-item__icon--${category}`);
  icon.setAttribute("aria-hidden", "true");
  icon.removeAttribute("role");
  icon.removeAttribute("aria-labelledby");
  icon.querySelector("title")?.remove();
  return icon;
}

function createIconButton(category, className, action) {
  const button = document.createElement("button");
  button.className = className;
  button.type = "button";
  button.dataset.category = category;

  if (action) {
    button.dataset.action = action;
  }

  button.title = CATEGORY_LABELS[category] || category;
  button.setAttribute("aria-label", CATEGORY_LABELS[category] || category);
  button.append(getCategoryIcon(category));
  return button;
}

function createCategoryPicker(task) {
  const picker = document.createElement("div");
  picker.className = "task-item__picker task-item__picker--category";

  const trigger = createIconButton(task.category, "task-item__category-trigger", "toggle-category-picker");
  trigger.setAttribute("aria-label", "Изменить категорию");

  const options = document.createElement("div");
  options.className = "task-item__picker-options";
  options.hidden = true;

  CATEGORIES.forEach((category) => {
    const option = createIconButton(category, "task-item__picker-option", "set-category");
    options.append(option);
  });

  picker.append(trigger, options);
  return picker;
}

function getPriorityLabel(priority) {
  return PRIORITIES.find((item) => item.key === priority)?.label || "Обычная";
}

function createPriorityFlagIcon() {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.classList.add("task-item__priority-flag");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.8");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");

  const pole = document.createElementNS("http://www.w3.org/2000/svg", "path");
  pole.setAttribute("d", "M6 21V4");

  const flag = document.createElementNS("http://www.w3.org/2000/svg", "path");
  flag.setAttribute("d", "M6 4h11l-2 4 2 4H6");

  icon.append(pole, flag);
  return icon;
}

function createPriorityPicker(task) {
  const picker = document.createElement("div");
  picker.className = "task-item__picker task-item__picker--priority";

  const trigger = document.createElement("button");
  trigger.className = `task-item__priority-trigger task-item__priority-trigger--${task.priority}`;
  trigger.type = "button";
  trigger.dataset.action = "toggle-priority-picker";
  trigger.title = getPriorityLabel(task.priority);
  trigger.setAttribute("aria-label", `Важность: ${getPriorityLabel(task.priority)}`);
  trigger.append(createPriorityFlagIcon());

  const options = document.createElement("div");
  options.className = "task-item__picker-options";
  options.hidden = true;

  PRIORITIES.forEach((priority) => {
    const option = document.createElement("button");
    option.className = `task-item__priority-option task-item__priority-option--${priority.key}`;
    option.type = "button";
    option.title = priority.label;
    option.setAttribute("aria-label", priority.label);
    option.dataset.action = "set-priority";
    option.dataset.priority = priority.key;
    option.append(createPriorityFlagIcon());
    options.append(option);
  });

  picker.append(trigger, options);
  return picker;
}

function createTaskElement(task) {
  const taskItem = document.createElement("li");
  taskItem.className = `task-item task-item--${task.priority}`;
  taskItem.dataset.id = String(task.id);
  taskItem.dataset.priority = task.priority;
  taskItem.classList.toggle("is-completed", Boolean(task.isCompleted));

  const checkbox = document.createElement("input");
  checkbox.className = "task-item__checkbox";
  checkbox.type = "checkbox";
  checkbox.checked = Boolean(task.isCompleted);
  checkbox.setAttribute("aria-label", "Отметить выполнение задачи");

  const content = document.createElement("div");
  content.className = "task-item__content";

  const title = document.createElement("span");
  title.className = "task-item__title";
  title.textContent = task.title;
  content.append(title);

  if (task.time) {
    const time = document.createElement("time");
    time.className = "task-item__time";
    time.dateTime = task.time;
    time.textContent = task.time;
    content.prepend(time);
  }

  const deleteButton = document.createElement("button");
  deleteButton.className = "task-item__delete";
  deleteButton.type = "button";
  deleteButton.textContent = "×";
  deleteButton.setAttribute("aria-label", "Удалить задачу");

  const actions = document.createElement("div");
  actions.className = "task-item__actions";

  const editButton = document.createElement("button");
  editButton.className = "task-item__action";
  editButton.type = "button";
  editButton.innerHTML = `
    <svg class="task-item__action-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 20h9"></path>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"></path>
    </svg>
  `;
  editButton.title = "Изменить";
  editButton.setAttribute("aria-label", "Изменить задачу");
  editButton.dataset.action = "edit-task";

  actions.append(editButton);

  actions.append(deleteButton);
  taskItem.append(checkbox, createCategoryPicker(task), content, createPriorityPicker(task), actions);
  return taskItem;
}

function createOverdueTaskElement(task) {
  const taskItem = document.createElement("li");
  taskItem.className = `overdue-task task-item--${task.priority}`;
  taskItem.dataset.id = String(task.id);
  taskItem.dataset.priority = task.priority;

  const checkbox = document.createElement("input");
  checkbox.className = "overdue-task__checkbox";
  checkbox.type = "checkbox";
  checkbox.setAttribute("aria-label", "Выполнено");
  checkbox.dataset.action = "complete-overdue";

  const content = document.createElement("div");
  content.className = "overdue-task__content";

  const title = document.createElement("span");
  title.className = "overdue-task__title";
  title.textContent = task.title;

  const date = document.createElement("time");
  date.className = "overdue-task__date";
  date.dateTime = task.date;
  date.textContent = formatTimelineDate(parseDateKey(task.date));

  content.append(title, date);

  const actions = document.createElement("div");
  actions.className = "overdue-task__actions";

  const tomorrowButton = document.createElement("button");
  tomorrowButton.className = "overdue-task__button";
  tomorrowButton.type = "button";
  tomorrowButton.textContent = "На завтра";
  tomorrowButton.dataset.action = "move-overdue-tomorrow";

  const dateInput = document.createElement("input");
  dateInput.className = "overdue-task__date-input";
  dateInput.type = "date";
  dateInput.min = formatDateKey(new Date());
  dateInput.value = formatDateKey(new Date());
  dateInput.dataset.action = "move-overdue-date";
  dateInput.setAttribute("aria-label", "Выбрать дату");

  const dateWrapper = document.createElement("label");
  dateWrapper.className = "overdue-task__date-picker";

  const dateText = document.createElement("span");
  dateText.className = "overdue-task__date-short";
  dateText.textContent = formatShortYearDate(new Date());

  dateWrapper.append(dateText, dateInput);

  const deleteButton = document.createElement("button");
  deleteButton.className = "overdue-task__delete";
  deleteButton.type = "button";
  deleteButton.textContent = "Удалить";
  deleteButton.dataset.action = "delete-overdue";

  actions.append(tomorrowButton, dateWrapper, deleteButton);
  taskItem.append(checkbox, getCategoryIcon(task.category), content, actions);
  return taskItem;
}

function createImportantTaskElement(task) {
  const taskItem = document.createElement("li");
  taskItem.className = `important-task task-item--${task.priority}`;
  taskItem.dataset.id = String(task.id);
  taskItem.dataset.priority = task.priority;

  const content = document.createElement("div");
  content.className = "important-task__content";

  const title = document.createElement("span");
  title.className = "important-task__title";
  title.textContent = task.title;

  const date = document.createElement("time");
  date.className = "important-task__date";
  date.dateTime = task.date;
  date.textContent = formatTimelineDate(parseDateKey(task.date));

  content.append(title, date);
  taskItem.append(getCategoryIcon(task.category), content);
  return taskItem;
}

function getSelectedDayTaskList() {
  return document.getElementById("selected-day-tasks") || document.getElementById("selected-day-task-list");
}

function createInlineNewTaskPlaceholder() {
  const placeholder = document.createElement("li");
  placeholder.className = "inline-new-task-placeholder";
  placeholder.id = "inline-new-task-placeholder";
  placeholder.textContent = "Новая задача";
  return placeholder;
}

function appendInlineNewTaskPlaceholder(taskList) {
  if (!taskList) {
    return;
  }

  taskList.append(createInlineNewTaskPlaceholder());
}

function closeInlineTaskMenus(row, exceptMenu = null) {
  row?.querySelectorAll(".inline-new-task-menu").forEach((menu) => {
    if (menu !== exceptMenu) {
      menu.classList.remove("is-open");
      menu.hidden = true;
    }
  });

  row?.querySelectorAll(".inline-new-task-action").forEach((button) => {
    const controlsMenu = button.dataset.inlineMenu;
    button.classList.toggle(
      "is-active",
      Boolean(controlsMenu && row.querySelector(`[data-inline-menu-panel="${controlsMenu}"]`)?.hidden === false)
    );
  });
}

function getWeekdayShortLabel(weekdayKey) {
  return WEEKDAY_SHORT_LABELS[weekdayKey] || "";
}

function updateInlineRegularSummary(row) {
  const summary = row?.querySelector(".inline-new-task-regular-summary");
  const draft = row?.__weekfocusInlineDraft;

  if (!summary || !draft) {
    return;
  }

  const selectedLabels = draft.regularDays.map(getWeekdayShortLabel).filter(Boolean);
  summary.textContent = selectedLabels.join(", ");
  summary.hidden = selectedLabels.length === 0;
}

function positionInlineRegularMenu(row, menu, anchor = null) {
  if (!row || !menu) {
    return;
  }

  const rowRect = row.getBoundingClientRect();
  const anchorRect = anchor?.getBoundingClientRect ? anchor.getBoundingClientRect() : rowRect;
  const estimatedMenuWidth = 330;
  const rowPadding = 8;
  const maxLeft = Math.max(rowPadding, rowRect.width - estimatedMenuWidth - rowPadding);
  const left = Math.min(Math.max(rowPadding, anchorRect.left - rowRect.left - estimatedMenuWidth + anchorRect.width), maxLeft);

  menu.style.left = `${left}px`;
  menu.style.top = "calc(100% + 8px)";
}

function updateInlineRegularButton(row) {
  const regularButton = row?.querySelector("[data-inline-action='regular']");
  const draft = row?.__weekfocusInlineDraft;

  if (!regularButton || !draft) {
    return;
  }

  const regularMenu = row.querySelector("[data-inline-menu-panel='regular']");
  const isRegularOpen = Boolean(regularMenu && !regularMenu.hidden);
  regularButton.classList.toggle("is-active", draft.regularDays.length > 0 || isRegularOpen);
  regularButton.setAttribute(
    "aria-label",
    draft.regularDays.length > 0 ? "Регулярность включена" : "Настроить регулярность"
  );
}

function updateInlineMenuState(row) {
  const draft = row?.__weekfocusInlineDraft;

  if (!row || !draft) {
    return;
  }

  row.querySelectorAll("[data-inline-menu]").forEach((button) => {
    const menu = row.querySelector(`[data-inline-menu-panel="${button.dataset.inlineMenu}"]`);
    button.classList.toggle("is-active", Boolean(menu && !menu.hidden));
  });

  row.querySelectorAll("[data-inline-category]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.inlineCategory === draft.category);
  });

  row.querySelectorAll("[data-inline-priority]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.inlinePriority === draft.priority);
  });

  row.querySelectorAll("[data-inline-regular-day]").forEach((button) => {
    button.classList.toggle("is-active", draft.regularDays.includes(button.dataset.inlineRegularDay));
  });

  updateInlineRegularButton(row);
  updateInlineRegularSummary(row);
}

function createInlineCategoryMenu() {
  const menu = document.createElement("div");
  menu.className = "inline-new-task-menu inline-new-task-menu--category";
  menu.dataset.inlineMenuPanel = "category";
  menu.hidden = true;

  CATEGORIES.forEach((category) => {
    const option = createIconButton(category, "inline-new-task-menu__icon-option", null);
    option.dataset.inlineCategory = category;
    option.removeAttribute("data-action");
    menu.append(option);
  });

  return menu;
}

function createInlinePriorityMenu() {
  const menu = document.createElement("div");
  menu.className = "inline-new-task-menu inline-new-task-menu--priority";
  menu.dataset.inlineMenuPanel = "priority";
  menu.hidden = true;

  PRIORITIES.forEach((priority) => {
    const option = document.createElement("button");
    option.className = `inline-new-task-menu__priority-option inline-new-task-menu__priority-option--${priority.key}`;
    option.type = "button";
    option.dataset.inlinePriority = priority.key;
    option.title = priority.label;
    option.setAttribute("aria-label", priority.label);

    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.classList.add("inline-new-task-menu__flag-icon");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("fill", "none");
    icon.setAttribute("stroke", "currentColor");
    icon.setAttribute("stroke-width", "1.8");
    icon.setAttribute("stroke-linecap", "round");
    icon.setAttribute("stroke-linejoin", "round");

    const pole = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pole.setAttribute("d", "M6 21V4");

    const flag = document.createElementNS("http://www.w3.org/2000/svg", "path");
    flag.setAttribute("d", "M6 4h11l-2 4 2 4H6");

    icon.append(pole, flag);
    option.append(icon);
    menu.append(option);
  });

  return menu;
}

function createInlineRegularMenu() {
  const menu = document.createElement("div");
  menu.className = "inline-new-task-menu inline-new-task-menu--regular";
  menu.dataset.inlineMenuPanel = "regular";
  menu.hidden = true;

  WEEKDAYS.forEach((weekday) => {
    const option = document.createElement("button");
    option.className = "regular-popover__day inline-new-task-menu__day";
    option.type = "button";
    option.dataset.inlineRegularDay = weekday.key;
    option.textContent = getWeekdayShortLabel(weekday.key);
    option.setAttribute("aria-label", weekday.name);
    menu.append(option);
  });

  return menu;
}

function createInlineActionButton(action, icon, label, menuName = "") {
  const button = document.createElement("button");
  button.className = "inline-new-task-action";
  button.type = "button";
  button.dataset.inlineAction = action;
  button.textContent = icon;
  button.setAttribute("aria-label", label);

  if (menuName) {
    button.dataset.inlineMenu = menuName;
  }

  return button;
}

function createInlineRegularSummary() {
  const summary = document.createElement("span");
  summary.className = "inline-new-task-regular-summary";
  summary.hidden = true;
  return summary;
}

function createTaskObjectFromInlineDraft(title, draft) {
  const isRegular = draft.regularDays.length > 0;
  const regularSeriesId = isRegular ? generateSeriesId() : null;

  return {
    id: Date.now(),
    title,
    category: draft.category,
    priority: draft.priority,
    date: selectedDateKey,
    time: isValidTimeValue(draft.time) ? draft.time : null,
    isCompleted: false,
    isRegular,
    regularSeriesId,
    regularDays: isRegular ? [...draft.regularDays] : [],
    dateStart: isRegular ? selectedDateKey : null,
    dateEnd: null,
    yandexEventId: null,
  };
}

function resetInlineTaskRow(row) {
  inlineTaskDraft = null;

  if (!row) {
    return;
  }

  row.replaceWith(createInlineNewTaskPlaceholder());
}

function saveInlineTask(row) {
  if (!row) {
    return;
  }

  const input = row.querySelector(".inline-new-task-input");
  const title = String(input?.value || "").trim();
  const draft = row.__weekfocusInlineDraft;
  const timeInput = row.querySelector(".inline-new-task-time");
  inlineTaskDraft = null;

  if (draft) {
    draft.time = isValidTimeValue(timeInput?.value) ? timeInput.value : null;
  }

  if (!title || !draft) {
    resetInlineTaskRow(row);
    return;
  }

  addTask(createTaskObjectFromInlineDraft(title, draft));
}

function activateInlineTaskInput(placeholder) {
  if (!placeholder || placeholder.classList.contains("is-active")) {
    return;
  }

  const selectedDate = parseDateKey(selectedDateKey);
  const defaultWeekday = getWeekdayKey(selectedDate);
  inlineTaskDraft = {
    category: activeCategoryFilter || "work",
    priority: "normal",
    time: null,
    regularDays: [],
  };

  placeholder.__weekfocusInlineDraft = inlineTaskDraft;
  placeholder.className = "inline-new-task-placeholder is-active";
  placeholder.replaceChildren();

  const input = document.createElement("input");
  input.className = "inline-new-task-input";
  input.type = "text";
  input.placeholder = "Новая задача";
  input.setAttribute("aria-label", "Новая задача");

  const timeInput = document.createElement("input");
  timeInput.className = "inline-new-task-time";
  timeInput.type = "time";
  timeInput.setAttribute("aria-label", "Время задачи");

  const priorityButton = createInlineActionButton("priority", "🚩", "Выбрать важность", "priority");
  const categoryButton = createInlineActionButton("category", "🏷️", "Выбрать категорию", "category");
  const regularButton = createInlineActionButton("regular", "🔄", "Настроить регулярность", "regular");
  const regularSummary = createInlineRegularSummary();

  placeholder.append(
    input,
    timeInput,
    priorityButton,
    categoryButton,
    regularButton,
    regularSummary,
    createInlinePriorityMenu(),
    createInlineCategoryMenu(),
    createInlineRegularMenu()
  );

  placeholder.dataset.defaultWeekday = defaultWeekday;
  updateInlineMenuState(placeholder);
  input.focus();
}

function renderSelectedDayTasks() {
  const taskList = getSelectedDayTaskList();
  const dayDetailTitle = document.getElementById("day-detail-title");

  if (!taskList) {
    return;
  }

  const selectedDate = parseDateKey(selectedDateKey);
  const dayTasks = getVisibleTasksByDate(selectedDateKey);
  taskList.replaceChildren();

  if (dayDetailTitle) {
    dayDetailTitle.textContent = `Задачи на ${formatTimelineDate(selectedDate)}`;
  }

  if (dayTasks.length === 0) {
    const emptyItem = document.createElement("li");
    const emptyText = document.createElement("p");
    emptyText.className = "task-list__empty";
    emptyText.textContent = activeCategoryFilter ? "Задач по выбранной категории нет" : "Задач нет";
    emptyItem.append(emptyText);
    taskList.append(emptyItem);
    appendInlineNewTaskPlaceholder(taskList);
    return;
  }

  dayTasks.forEach((task) => {
    taskList.append(createTaskElement(task));
  });
  appendInlineNewTaskPlaceholder(taskList);
}

function renderOverdueTasks() {
  const overdueTaskList = document.getElementById("overdue-task-list");

  if (!overdueTaskList) {
    return;
  }

  const overdueTasks = getOverdueTasks();
  overdueTaskList.replaceChildren();

  if (overdueTasks.length === 0) {
    const emptyItem = document.createElement("li");
    const emptyText = document.createElement("p");
    emptyText.className = "task-list__empty";
    emptyText.textContent = "Просроченных задач нет";
    emptyItem.append(emptyText);
    overdueTaskList.append(emptyItem);
    return;
  }

  overdueTasks.forEach((task) => {
    overdueTaskList.append(createOverdueTaskElement(task));
  });
}

function renderUpcomingImportantTasks() {
  const weeklyImportantTaskList = document.getElementById("weekly-important-task-list");

  if (!weeklyImportantTaskList) {
    return;
  }

  const importantTasks = getUpcomingImportantTasks();
  weeklyImportantTaskList.replaceChildren();

  if (importantTasks.length === 0) {
    const emptyItem = document.createElement("li");
    const emptyText = document.createElement("p");
    emptyText.className = "task-list__empty";
    emptyText.textContent = "Важных задач нет";
    emptyItem.append(emptyText);
    weeklyImportantTaskList.append(emptyItem);
    return;
  }

  importantTasks.forEach((task) => {
    weeklyImportantTaskList.append(createImportantTaskElement(task));
  });
}

function updateReturnTodayButton() {
  const returnTodayButton = document.getElementById("return-today-button");

  if (!returnTodayButton) {
    return;
  }

  returnTodayButton.hidden = selectedDateKey === formatDateKey(new Date());
}

function ensureDayProgressRing(dayCard, dayKey) {
  let ring = dayCard.querySelector(".day-card__progress");

  if (ring) {
    return ring;
  }

  ring = document.createElement("div");
  ring.className = "day-card__progress";
  ring.setAttribute("aria-hidden", "true");
  ring.innerHTML = `
    <svg class="day-card__progress-svg" viewBox="0 0 32 32">
      <circle class="day-card__progress-track" cx="16" cy="16" r="12" fill="none" stroke-width="3" stroke-dasharray="75" stroke-dashoffset="0"></circle>
      <circle class="day-card__progress-value" id="day-progress-${dayKey}" cx="16" cy="16" r="12" fill="none" stroke-width="3" stroke-dasharray="75" stroke-dashoffset="75"></circle>
    </svg>
    <span class="day-card__progress-percent" id="day-progress-percent-${dayKey}">0%</span>
  `;
  dayCard.append(ring);
  return ring;
}

function renderDayAnalytics(dateKey, dayKey) {
  const analyticsElement = document.getElementById(`day-analytics-${dayKey}`);
  const dayCard = document.getElementById(`day-card-${dayKey}`);

  if (!analyticsElement) {
    return;
  }

  const dayTasks = getTasksByDate(dateKey);
  const completedCount = dayTasks.filter((task) => task.isCompleted).length;
  const percent = calculatePercent(completedCount, dayTasks.length);
  analyticsElement.textContent = `${completedCount}/${dayTasks.length}`;

  if (dayCard) {
    ensureDayProgressRing(dayCard, dayKey);
    updateCircleProgress(document.getElementById(`day-progress-${dayKey}`), percent);
    const percentElement = document.getElementById(`day-progress-percent-${dayKey}`);
    if (percentElement) {
      percentElement.textContent = `${percent}%`;
    }
  }
}

function getWeekdayNameByDate(date) {
  const weekdayKey = getWeekdayKey(date);
  return WEEKDAYS.find((weekday) => weekday.key === weekdayKey)?.name.toLowerCase() || "";
}

function calculatePercent(completedCount, totalCount) {
  if (totalCount === 0) {
    return 0;
  }

  return Math.round((completedCount / totalCount) * 100);
}

function calculateWeekCategoryStats() {
  const weekDates = getWeekDates(displayedWeekDate);
  const weekStartKey = formatDateKey(weekDates[0].date);
  const weekEndKey = formatDateKey(weekDates[6].date);
  const weekTasks = getTasksByDateRange(weekStartKey, weekEndKey);
  const categoryStats = {};

  CATEGORIES.forEach((category) => {
    const categoryTasks = weekTasks.filter((task) => task.category === category);
    const completedCount = categoryTasks.filter((task) => task.isCompleted).length;

    categoryStats[category] = {
      completedCount,
      totalCount: categoryTasks.length,
      percent: calculatePercent(completedCount, categoryTasks.length),
    };
  });

  const totalCompletedCount = weekTasks.filter((task) => task.isCompleted).length;

  return {
    categoryStats,
    totalCompletedCount,
    totalCount: weekTasks.length,
    totalPercent: calculatePercent(totalCompletedCount, weekTasks.length),
  };
}

function renderLifeAnalyticsSummary() {
  const summaryElement = document.getElementById("life-analytics-summary");

  if (!summaryElement) {
    return;
  }

  const selectedDate = parseDateKey(selectedDateKey);
  const dayTasks = getTasksByDate(selectedDateKey);
  const completedCount = dayTasks.filter((task) => task.isCompleted).length;
  const remainingCount = dayTasks.length - completedCount;
  const weekdayName = getWeekdayNameByDate(selectedDate);

  summaryElement.textContent = `Выбрано: ${weekdayName}. Задач выполнено: ${completedCount}, осталось сделать: ${remainingCount}.`;
}

function renderWeekProgress(totalPercent) {
  const weekProgressBar = document.getElementById("week-progress-bar");
  const weekProgress = document.getElementById("week-progress");
  const weekProgressLabel = document.getElementById("week-progress-label");

  if (!weekProgressBar || !weekProgress) {
    return;
  }

  weekProgressBar.style.width = `${totalPercent}%`;
  weekProgress.setAttribute("aria-label", `Недельный прогресс: ${totalPercent}%`);

  if (weekProgressLabel) {
    weekProgressLabel.textContent = `Неделя выполнена на ${totalPercent}%`;
  }
}

function updateDashboardDonut(circle, percent) {
  if (!circle) {
    return;
  }

  const dashArray = Number(circle.getAttribute("stroke-dasharray")) || 113;
  const dashOffset = dashArray - (dashArray * percent) / 100;
  circle.style.width = `${percent}%`;
  circle.style.strokeDasharray = String(dashArray);
  circle.style.strokeDashoffset = String(dashOffset);
  circle.setAttribute("stroke-dashoffset", String(dashOffset));
}

function updateCircleProgress(circle, percent) {
  if (!circle) {
    return;
  }

  const dashArray = Number(circle.getAttribute("stroke-dasharray")) || 75;
  const dashOffset = dashArray - (dashArray * percent) / 100;
  circle.style.strokeDashoffset = String(dashOffset);
  circle.setAttribute("stroke-dashoffset", String(dashOffset));
}

function renderCategoryProgress(categoryStats) {
  CATEGORIES.forEach((category) => {
    const indicator = document.getElementById(`life-indicator-${category}`);
    const value = document.getElementById(`life-indicator-value-${category}`);
    const dashboardWidget = document.getElementById(`dashboard-widget-${category}`);
    const dashboardValue = document.getElementById(`dashboard-percent-${category}`);
    const dashboardBar = document.getElementById(`dashboard-bar-${category}`);
    const percent = categoryStats[category]?.percent || 0;

    indicator?.style.setProperty("--life-progress", `${percent}%`);
    dashboardWidget?.style.setProperty("--dashboard-progress", `${percent}%`);

    if (dashboardBar) {
      updateDashboardDonut(dashboardBar, percent);
      dashboardBar.style.setProperty("--dashboard-progress", `${percent}%`);
    }

    if (value) {
      value.textContent = `${percent}%`;
    }

    if (dashboardValue) {
      dashboardValue.textContent = `${percent}%`;
    }
  });
}

function renderFilterProgress(weekStats) {
  const allPercent = document.getElementById("filter-percent-all");

  if (allPercent) {
    allPercent.textContent = `${weekStats.totalPercent}%`;
  }

  CATEGORIES.forEach((category) => {
    const value = document.getElementById(`filter-percent-${category}`);
    const percent = weekStats.categoryStats[category]?.percent || 0;

    if (value) {
      value.textContent = `${percent}%`;
    }
  });
}

function renderAnalytics() {
  const weekStats = calculateWeekCategoryStats();

  renderLifeAnalyticsSummary();
  renderCategoryProgress(weekStats.categoryStats);
  renderFilterProgress(weekStats);
  renderWeekProgress(weekStats.totalPercent);
}

function captureYandexTokenFromHash() {
  if (!window.location?.hash || !window.location.hash.includes("access_token=")) {
    return localStorage.getItem(YANDEX_TOKEN_KEY);
  }

  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = hashParams.get("access_token");

  if (accessToken) {
    localStorage.setItem(YANDEX_TOKEN_KEY, accessToken);
    history.replaceState(null, document.title, window.location.pathname + window.location.search);
  }

  return accessToken || localStorage.getItem(YANDEX_TOKEN_KEY);
}

function requestYandexToken() {
  if (!YANDEX_CLIENT_ID) {
    console.warn("Для синхронизации с Яндекс.Календарем нужно указать YANDEX_CLIENT_ID.");
    return;
  }

  const authParams = new URLSearchParams({
    response_type: "token",
    client_id: YANDEX_CLIENT_ID,
    redirect_uri: window.location.origin + window.location.pathname,
  });

  window.location.assign(`${YANDEX_AUTH_URL}?${authParams.toString()}`);
}

function eventContainsVideoLink(event) {
  const searchableText = [
    event.name,
    event.summary,
    event.title,
    event.description,
    event.location,
    event.htmlLink,
    event.url,
    event.conferenceData?.entryPoints?.map((entryPoint) => entryPoint.uri).join(" "),
  ].filter(Boolean).join(" ");

  return /(telemost\.yandex|zoom\.us|meet\.google|teams\.microsoft|skype|webex|video|видеосвяз)/i.test(searchableText);
}

function getYandexEventId(event) {
  return event.id || event.event_id || event.uid || null;
}

function getYandexEventStartDate(event) {
  const startValue = event.start?.dateTime || event.start?.date || event.startTs || event.start || event.date;

  if (!startValue) {
    return null;
  }

  const startDate = new Date(startValue);

  if (Number.isNaN(startDate.getTime())) {
    return null;
  }

  return formatDateKey(startDate);
}

function normalizeYandexEvent(event) {
  const yandexEventId = getYandexEventId(event);
  const date = getYandexEventStartDate(event);

  if (!yandexEventId || !date || !eventContainsVideoLink(event)) {
    return null;
  }

  return {
    id: `yandex-${yandexEventId}`,
    title: event.name || event.summary || event.title || "Встреча",
    category: "meetings",
    priority: "normal",
    date,
    isCompleted: false,
    isRegular: false,
    regularSeriesId: null,
    isRegularTemplate: false,
    isRegularDeleted: false,
    regularDays: [],
    dateStart: null,
    dateEnd: null,
    yandexEventId: String(yandexEventId),
  };
}

function getYandexWeekRange() {
  const weekDates = getWeekDates(new Date());
  return {
    from: formatDateKey(weekDates[0].date),
    to: formatDateKey(weekDates[6].date),
  };
}

async function fetchYandexEvents(token) {
  const weekRange = getYandexWeekRange();
  const requestUrl = new URL(YANDEX_EVENTS_ENDPOINT);

  requestUrl.searchParams.set("from", weekRange.from);
  requestUrl.searchParams.set("to", weekRange.to);

  const response = await fetch(requestUrl.toString(), {
    headers: {
      Authorization: `OAuth ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Яндекс.Календарь вернул статус ${response.status}.`);
  }

  const payload = await response.json();
  return Array.isArray(payload) ? payload : (payload.events || payload.items || []);
}

async function importYandexMeetings(token) {
  if (!token || typeof fetch !== "function") {
    return 0;
  }

  try {
    const events = await fetchYandexEvents(token);
    const importedTasks = events
      .map(normalizeYandexEvent)
      .filter((task) => task && !tasks.some((item) => item.yandexEventId === task.yandexEventId));

    if (importedTasks.length === 0) {
      return 0;
    }

    tasks.push(...importedTasks);
    saveTasks();
    renderCalendar();
    return importedTasks.length;
  } catch (error) {
    console.warn("Не удалось импортировать встречи из Яндекс.Календаря.", error);
    return 0;
  }
}

async function syncWithYandex(options = {}) {
  const token = captureYandexTokenFromHash();

  if (!token) {
    if (options.forceAuth) {
      requestYandexToken();
    }
    return 0;
  }

  return importYandexMeetings(token);
}

function updateTodayInformer() {
  const todayInformer = document.getElementById("today-informer");
  const todayWeekday = document.getElementById("today-weekday");
  const todayDate = document.getElementById("today-date");

  if (!todayInformer) {
    return;
  }

  const today = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatToParts(today).map((part) => [part.type, part.value]));

  if (todayWeekday && todayDate) {
    todayWeekday.textContent = parts.weekday;
    todayDate.textContent = `${parts.day} ${parts.month} ${parts.year}`;
    todayDate.setAttribute("datetime", formatDateKey(today));
    return;
  }

  todayInformer.textContent = `${parts.weekday}, ${parts.day} ${parts.month} ${parts.year}`;
}

function renderWeekTimeline() {
  const today = normalizeDate(new Date());
  const weekDates = getWeekDates(displayedWeekDate);

  weekDates.forEach((day) => {
    const dayCard = document.getElementById(`day-card-${day.key}`);
    const dayDate = document.getElementById(`day-date-${day.key}`);
    const dayWeekday = document.getElementById(`day-weekday-${day.key}`);

    if (!dayCard || !dayDate || !dayWeekday) {
      return;
    }

    const dateKey = formatDateKey(day.date);
    const isToday = isSameDate(day.date, today);

    dayCard.dataset.date = dateKey;
    dayCard.classList.toggle("is-today", isToday);
    dayCard.classList.toggle("is-selected", dateKey === selectedDateKey);

    if (isToday) {
      dayCard.setAttribute("aria-current", "date");
    } else {
      dayCard.removeAttribute("aria-current");
    }

    dayDate.textContent = formatTimelineDate(day.date);
    dayDate.setAttribute("datetime", dateKey);
    dayWeekday.textContent = getWeekdayShortLabel(day.key);
    renderDayAnalytics(dateKey, day.key);
  });
}

function renderCalendar() {
  generateRegularTasksForVisiblePeriods();
  updateTodayInformer();
  renderWeekTimeline();
  updateReturnTodayButton();
  renderSelectedDayTasks();
  renderOverdueTasks();
  renderUpcomingImportantTasks();
  renderCategoryFilterState();
  renderAnalytics();
}

function shiftDisplayedWeek(dayShift) {
  displayedWeekDate = addDays(displayedWeekDate, dayShift);
  selectedDateKey = formatDateKey(addDays(parseDateKey(selectedDateKey), dayShift));
  renderCalendar();
}

function selectDate(dateKey) {
  selectedDateKey = dateKey;
  displayedWeekDate = parseDateKey(dateKey);
  renderCalendar();
}

function createTaskFromForm(form) {
  const formData = new FormData(form);
  const title = String(formData.get("taskText") || "").trim();

  if (!title) {
    return null;
  }

  const isRegular = formData.get("taskRegular") === "true";
  const selectedDate = parseDateKey(selectedDateKey);
  const regularDays = formData.getAll("regularDays");
  const normalizedRegularDays = regularDays.length > 0 ? regularDays : [getWeekdayKey(selectedDate)];
  const regularSeriesId = isRegular ? generateSeriesId() : null;

  return {
    id: Date.now(),
    title,
    category: String(formData.get("taskCategory") || "work"),
    priority: String(formData.get("taskPriority") || "normal"),
    date: selectedDateKey,
    time: isValidTimeValue(String(formData.get("taskTime") || "")) ? String(formData.get("taskTime")) : null,
    isCompleted: false,
    isRegular,
    regularSeriesId,
    regularDays: isRegular ? normalizedRegularDays : [],
    dateStart: isRegular ? selectedDateKey : null,
    dateEnd: null,
    yandexEventId: null,
  };
}

function addTask(task) {
  if (task.isRegular && task.regularSeriesId) {
    tasks.push({
      ...task,
      id: `${task.regularSeriesId}-template`,
      isCompleted: true,
      isRegularTemplate: true,
    });
  }

  tasks.push(task);
  saveTasks();
  renderCalendar();
}

function toggleTaskCompletion(taskId, isCompleted) {
  const task = getTaskById(taskId);

  if (!task) {
    return;
  }

  task.isCompleted = isCompleted;
  saveTasks();
  renderCalendar();
}

function completeOverdueTask(taskId) {
  const task = getTaskById(taskId);

  if (!task) {
    return;
  }

  task.isCompleted = true;
  saveTasks();
  renderCalendar();
}

function moveTaskToDate(taskId, dateKey) {
  const task = getTaskById(taskId);

  if (!task) {
    return;
  }

  const previousSeriesId = task.regularSeriesId;
  task.date = dateKey;

  if (previousSeriesId) {
    detachTaskFromSeries(task, previousSeriesId);
  }

  saveTasks();
  renderCalendar();
}

function moveTaskToTomorrow(taskId) {
  moveTaskToDate(taskId, formatDateKey(addDays(new Date(), 1)));
}

function createDeletedRegularInstanceMarker(task) {
  return {
    id: `${task.regularSeriesId}-${task.date}-deleted`,
    title: task.title,
    category: task.category,
    priority: task.priority,
    date: task.date,
    time: task.time || null,
    isCompleted: true,
    isRegular: false,
    isRegularDeleted: true,
    regularSeriesId: null,
    deletedRegularSeriesId: task.regularSeriesId,
    regularDays: [],
    dateStart: null,
    dateEnd: null,
    yandexEventId: null,
  };
}

function deleteTask(taskId) {
  const taskIndex = tasks.findIndex((item) => String(item.id) === String(taskId));

  if (taskIndex === -1) {
    return;
  }

  const task = tasks[taskIndex];

  if (task.isRegular && task.regularSeriesId && !task.isRegularTemplate) {
    tasks.splice(taskIndex, 1, createDeletedRegularInstanceMarker(task));
  } else {
    tasks.splice(taskIndex, 1);
  }

  saveTasks();
  renderCalendar();
}

function requestDeleteTask(taskId) {
  const task = getTaskById(taskId);

  if (!task) {
    return;
  }

  if (task.isRegular && task.regularSeriesId) {
    pendingRegularDeleteTaskId = String(taskId);
    const dialog = document.getElementById("delete-regular-dialog");

    if (dialog?.showModal) {
      dialog.showModal();
    } else if (window.confirm("Удалить всю серию? Нажмите Отмена, чтобы удалить только текущую задачу.")) {
      deleteRegularSeries(taskId);
    } else {
      deleteTask(taskId);
    }
    return;
  }

  deleteTask(taskId);
}

function deleteRegularSeries(taskId) {
  const task = getTaskById(taskId);

  if (!task?.regularSeriesId) {
    return;
  }

  const seriesId = task.regularSeriesId;
  const deleteFromDate = task.date;
  const dateEnd = formatDateKey(addDays(parseDateKey(deleteFromDate), -1));

  tasks.forEach((item) => {
    if (item.regularSeriesId === seriesId) {
      item.dateEnd = dateEnd;
    }
  });

  tasks = tasks.filter((item) => {
    if (item.regularSeriesId === seriesId) {
      return item.isRegularTemplate || item.date < deleteFromDate;
    }

    if (item.deletedRegularSeriesId === seriesId) {
      return item.date < deleteFromDate;
    }

    return true;
  });
  window.tasks = tasks;
  saveTasks();
  renderCalendar();
}

function cancelRegularSeries(taskId) {
  deleteRegularSeries(taskId);
}

function detachTaskFromSeries(task, seriesId = task.regularSeriesId) {
  task.isRegular = false;
  task.regularSeriesId = null;
  task.regularDays = [];
  task.dateStart = null;
  task.dateEnd = null;
  task.detachedRegularSeriesId = seriesId || null;
}

function updateTaskCategory(taskId, category) {
  const task = getTaskById(taskId);

  if (!task || !CATEGORIES.includes(category)) {
    return;
  }

  if (task.isRegular) {
    detachTaskFromSeries(task);
  }

  task.category = category;
  saveTasks();
  renderCalendar();
}

function updateTaskPriority(taskId, priority) {
  const task = getTaskById(taskId);

  if (!task || !PRIORITIES.some((item) => item.key === priority)) {
    return;
  }

  if (task.isRegular) {
    detachTaskFromSeries(task);
  }

  task.priority = priority;
  saveTasks();
  renderCalendar();
}

function toggleTaskPicker(taskItem, pickerSelector) {
  taskItem.querySelectorAll(".task-item__picker-options").forEach((options) => {
    const shouldToggle = options.closest(pickerSelector);
    options.hidden = shouldToggle ? !options.hidden : true;
  });
}

function renderCategoryFilterState() {
  const resetButton = document.getElementById("category-filter-reset");
  resetButton?.classList.toggle("is-active-filter", activeCategoryFilter === null);
  resetButton?.setAttribute("aria-pressed", String(activeCategoryFilter === null));

  document.querySelectorAll(".category-icons [data-category-filter]").forEach((tab) => {
    const isActive = tab.dataset.categoryFilter === "all"
      ? activeCategoryFilter === null
      : tab.dataset.categoryFilter === activeCategoryFilter;
    tab.classList.toggle("is-active-filter", isActive);
    tab.setAttribute("aria-pressed", String(isActive));
  });
}

function updateTaskTitle(taskId, title) {
  const task = getTaskById(taskId);
  const normalizedTitle = String(title || "").trim();

  if (!task || !normalizedTitle) {
    return;
  }

  task.title = normalizedTitle;

  if (task.isRegular) {
    detachTaskFromSeries(task);
  }

  saveTasks();
  renderCalendar();
}

function startInlineTaskTitleEdit(taskItem) {
  const title = taskItem?.querySelector(".task-item__title");
  const task = getTaskById(taskItem?.dataset.id);

  if (!taskItem || !title || !task || taskItem.classList.contains("is-editing-title")) {
    return;
  }

  const originalTitle = task.title;
  const input = document.createElement("input");
  input.className = "task-item__title-input";
  input.type = "text";
  input.value = originalTitle;
  input.setAttribute("aria-label", "Название задачи");

  let isFinished = false;

  const finishEdit = (shouldSave) => {
    if (isFinished) {
      return;
    }

    isFinished = true;
    const nextTitle = input.value.trim();

    if (shouldSave && nextTitle && nextTitle !== originalTitle) {
      updateTaskTitle(task.id, nextTitle);
      return;
    }

    taskItem.classList.remove("is-editing-title");
    input.replaceWith(title);
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      finishEdit(true);
    }

    if (event.key === "Escape") {
      event.preventDefault();
      finishEdit(false);
    }
  });

  input.addEventListener("blur", () => {
    finishEdit(true);
  });

  taskItem.classList.add("is-editing-title");
  title.replaceWith(input);
  input.focus();
  input.select();
}

function initWeekNavigation() {
  const previousWeekButton = document.getElementById("previous-week-button");
  const nextWeekButton = document.getElementById("next-week-button");

  previousWeekButton?.addEventListener("click", () => shiftDisplayedWeek(-7));
  nextWeekButton?.addEventListener("click", () => shiftDisplayedWeek(7));
}

function initDaySelection() {
  const weekTimeline = document.getElementById("week-timeline");

  weekTimeline?.addEventListener("click", (event) => {
    const dayCard = event.target.closest(".day-card");

    if (!dayCard?.dataset.date) {
      return;
    }

    selectDate(dayCard.dataset.date);
  });
}

function initTaskForm() {
  const taskForm = document.getElementById("task-form");
  const taskRegular = document.getElementById("task-regular");
  const regularDays = document.getElementById("regular-days");

  if (regularDays && taskRegular) {
    regularDays.hidden = !taskRegular.checked;
  }

  taskRegular?.addEventListener("change", () => {
    if (regularDays) {
      regularDays.hidden = !taskRegular.checked;
    }
  });

  taskForm?.addEventListener("submit", (event) => {
    event.preventDefault();

    const task = createTaskFromForm(taskForm);

    if (!task) {
      return;
    }

    addTask(task);
    taskForm.reset();
    if (regularDays) {
      regularDays.hidden = true;
    }
    document.getElementById("task-text")?.focus();
  });
}

function initTaskListActions() {
  const taskList = getSelectedDayTaskList();

  taskList?.addEventListener("change", (event) => {
    if (!event.target.matches(".task-item__checkbox")) {
      return;
    }

    const taskItem = event.target.closest(".task-item");
    toggleTaskCompletion(taskItem?.dataset.id, event.target.checked);
  });

  taskList?.addEventListener("click", (event) => {
    const taskItem = event.target.closest(".task-item");

    if (!taskItem) {
      return;
    }

    if (event.target.matches(".task-item__delete")) {
      requestDeleteTask(taskItem.dataset.id);
      return;
    }

    const categoryOption = event.target.closest("[data-action='set-category']");
    if (categoryOption) {
      updateTaskCategory(taskItem.dataset.id, categoryOption.dataset.category);
      return;
    }

    const priorityOption = event.target.closest("[data-action='set-priority']");
    if (priorityOption) {
      updateTaskPriority(taskItem.dataset.id, priorityOption.dataset.priority);
      return;
    }

    if (event.target.closest("[data-action='toggle-category-picker']")) {
      toggleTaskPicker(taskItem, ".task-item__picker--category");
      return;
    }

    if (event.target.closest("[data-action='toggle-priority-picker']")) {
      toggleTaskPicker(taskItem, ".task-item__picker--priority");
      return;
    }

    if (event.target.closest("[data-action='edit-task']")) {
      startInlineTaskTitleEdit(taskItem);
    }
  });
}

function initInlineTaskInput() {
  const taskList = getSelectedDayTaskList();

  if (!taskList) {
    return;
  }

  taskList.addEventListener("mousedown", (event) => {
    if (
      event.target.closest(".inline-new-task-placeholder.is-active") &&
      !event.target.matches(".inline-new-task-input") &&
      event.target.closest("button")
    ) {
      event.preventDefault();
    }
  });

  taskList.addEventListener("click", (event) => {
    const activeRow = event.target.closest(".inline-new-task-placeholder.is-active");
    const passiveRow = event.target.closest(".inline-new-task-placeholder:not(.is-active)");

    if (passiveRow) {
      activateInlineTaskInput(passiveRow);
      return;
    }

    if (!activeRow) {
      return;
    }

    const draft = activeRow.__weekfocusInlineDraft;

    if (!draft) {
      return;
    }

    if (event.target.matches(".inline-new-task-input")) {
      closeInlineTaskMenus(activeRow);
      updateInlineMenuState(activeRow);
      return;
    }

    const menuButton = event.target.closest("[data-inline-menu]");
    if (menuButton) {
      const menu = activeRow.querySelector(`[data-inline-menu-panel="${menuButton.dataset.inlineMenu}"]`);

      if (menu) {
        const shouldOpen = menu.hidden;
        closeInlineTaskMenus(activeRow, shouldOpen ? menu : null);
        menu.hidden = !shouldOpen;
        if (shouldOpen && menuButton.dataset.inlineMenu === "regular") {
          positionInlineRegularMenu(activeRow, menu, menuButton);
        }
        menu.classList.toggle("is-open", shouldOpen);
        updateInlineMenuState(activeRow);
      }
      activeRow.querySelector(".inline-new-task-input")?.focus();
      return;
    }

    const categoryOption = event.target.closest("[data-inline-category]");
    if (categoryOption) {
      draft.category = categoryOption.dataset.inlineCategory;
      closeInlineTaskMenus(activeRow);
      updateInlineMenuState(activeRow);
      activeRow.querySelector(".inline-new-task-input")?.focus();
      return;
    }

    const priorityOption = event.target.closest("[data-inline-priority]");
    if (priorityOption) {
      draft.priority = priorityOption.dataset.inlinePriority;
      closeInlineTaskMenus(activeRow);
      updateInlineMenuState(activeRow);
      activeRow.querySelector(".inline-new-task-input")?.focus();
      return;
    }

    const regularDayOption = event.target.closest("[data-inline-regular-day]");
    if (regularDayOption) {
      const weekday = regularDayOption.dataset.inlineRegularDay;
      draft.regularDays = draft.regularDays.includes(weekday)
        ? draft.regularDays.filter((day) => day !== weekday)
        : [...draft.regularDays, weekday];
      updateInlineMenuState(activeRow);
      activeRow.querySelector(".inline-new-task-input")?.focus();
    }
  });

  taskList.addEventListener("keydown", (event) => {
    const activeRow = event.target.closest(".inline-new-task-placeholder.is-active");

    if (!activeRow) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      saveInlineTask(activeRow);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      resetInlineTaskRow(activeRow);
    }
  });

  taskList.addEventListener("focusout", (event) => {
    const activeRow = event.target.closest(".inline-new-task-placeholder.is-active");

    if (!activeRow) {
      return;
    }

    window.setTimeout(() => {
      if (document.activeElement && activeRow.contains(document.activeElement)) {
        return;
      }

      saveInlineTask(activeRow);
    }, 0);
  });
}

function setSettingsPopoverOpen(isOpen) {
  const settingsButton = document.getElementById("settings-button");
  const settingsPopover = document.getElementById("settings-popover");

  if (!settingsButton || !settingsPopover) {
    return;
  }

  settingsButton.setAttribute("aria-expanded", String(isOpen));

  if (isOpen) {
    settingsPopover.hidden = false;
    window.requestAnimationFrame(() => {
      settingsPopover.classList.add("is-open");
    });
    return;
  }

  settingsPopover.classList.remove("is-open");
  window.setTimeout(() => {
    if (!settingsPopover.classList.contains("is-open")) {
      settingsPopover.hidden = true;
    }
  }, 180);
}

function initSettingsPopover() {
  const settingsButton = document.getElementById("settings-button");
  const settingsPopover = document.getElementById("settings-popover");

  if (!settingsButton || !settingsPopover) {
    return;
  }

  settingsButton.setAttribute("aria-expanded", "false");

  settingsButton.addEventListener("click", (event) => {
    event.stopPropagation();
    setSettingsPopoverOpen(settingsPopover.hidden || !settingsPopover.classList.contains("is-open"));
  });

  settingsPopover.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", () => {
    if (!settingsPopover.hidden) {
      setSettingsPopoverOpen(false);
    }
  });
}

function initOverdueActions() {
  const overdueTaskList = document.getElementById("overdue-task-list");

  overdueTaskList?.addEventListener("change", (event) => {
    const taskItem = event.target.closest(".overdue-task");

    if (!taskItem) {
      return;
    }

    if (event.target.dataset.action === "complete-overdue") {
      completeOverdueTask(taskItem.dataset.id);
      return;
    }

    if (event.target.dataset.action === "move-overdue-date" && event.target.value) {
      moveTaskToDate(taskItem.dataset.id, event.target.value);
    }
  });

  overdueTaskList?.addEventListener("click", (event) => {
    const taskItem = event.target.closest(".overdue-task");

    if (!taskItem) {
      return;
    }

    if (event.target.dataset.action === "move-overdue-tomorrow") {
      moveTaskToTomorrow(taskItem.dataset.id);
      return;
    }

    if (event.target.dataset.action === "delete-overdue") {
      requestDeleteTask(taskItem.dataset.id);
      return;
    }

  });
}

function initReturnTodayButton() {
  const returnTodayButton = document.getElementById("return-today-button");

  returnTodayButton?.addEventListener("click", () => {
    const today = normalizeDate(new Date());
    displayedWeekDate = today;
    selectedDateKey = formatDateKey(today);
    renderCalendar();
  });
}

function initCategoryFilter() {
  const categoryIcons = document.getElementById("category-icons");
  const resetButton = document.getElementById("category-filter-reset");

  categoryIcons?.querySelectorAll("[data-category-filter]").forEach((tab) => {
    tab.setAttribute("aria-pressed", tab.dataset.categoryFilter === "all" ? "true" : "false");
  });

  resetButton?.addEventListener("click", () => {
    activeCategoryFilter = null;
    renderCalendar();
  });

  categoryIcons?.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-category-filter]");

    if (!tab) {
      return;
    }

    if (tab.dataset.categoryFilter === "all") {
      activeCategoryFilter = null;
      renderCalendar();
      return;
    }

    activeCategoryFilter = activeCategoryFilter === tab.dataset.categoryFilter ? null : tab.dataset.categoryFilter;
    renderCalendar();
  });

  categoryIcons?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    const tab = event.target.closest("[data-category-filter]");

    if (!tab) {
      return;
    }

    event.preventDefault();
    if (tab.dataset.categoryFilter === "all") {
      activeCategoryFilter = null;
    } else {
      activeCategoryFilter = activeCategoryFilter === tab.dataset.categoryFilter ? null : tab.dataset.categoryFilter;
    }
    renderCalendar();
  });
}

function initRegularDeleteDialog() {
  const dialog = document.getElementById("delete-regular-dialog");

  dialog?.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-delete-scope]");

    if (!actionButton) {
      return;
    }

    const taskId = pendingRegularDeleteTaskId;
    pendingRegularDeleteTaskId = null;
    dialog.close();

    if (!taskId || actionButton.dataset.deleteScope === "cancel") {
      return;
    }

    if (actionButton.dataset.deleteScope === "series") {
      deleteRegularSeries(taskId);
      return;
    }

    deleteTask(taskId);
  });
}

function initBackupControls() {
  const exportButton = document.getElementById("export-backup-button");
  const importButton = document.getElementById("import-backup-button");
  const fileInput = document.getElementById("backup-file-input");

  exportButton?.addEventListener("click", exportBackup);

  importButton?.addEventListener("click", () => {
    fileInput?.click();
  });

  fileInput?.addEventListener("change", () => {
    importBackupFile(fileInput.files?.[0]);
    fileInput.value = "";
  });
}

function initYandexSync() {
  syncWithYandex();

  if (yandexSyncIntervalId) {
    clearInterval(yandexSyncIntervalId);
  }

  yandexSyncIntervalId = setInterval(() => {
    syncWithYandex();
  }, YANDEX_SYNC_INTERVAL_MS);
}

function initApp() {
  window.tasks = tasks;
  window.saveTasks = saveTasks;
  window.syncWithYandex = syncWithYandex;
  window.weekfocusCalendar = {
    addDays,
    getWeekDates,
    getWeekStart,
    isSameDate,
    renderCalendar,
  };

  initWeekNavigation();
  initDaySelection();
  initTaskForm();
  initTaskListActions();
  initInlineTaskInput();
  initOverdueActions();
  initReturnTodayButton();
  initCategoryFilter();
  initRegularDeleteDialog();
  initBackupControls();
  initSettingsPopover();
  initYandexSync();
  renderCalendar();
}

document.addEventListener("DOMContentLoaded", initApp);
