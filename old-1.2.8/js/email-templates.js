/**
 * Email subject/body templates — mirrors Android EmailTemplates.
 */
(function (global) {
  const EXPENSE_TO = 'invoice@andrewssurvey.com';
  const TIMESHEET_TO = 'timesheet@andrewssurvey.com';
  // Previous default (<= 0.3.14-web); saved values equal to this are migrated.
  const LEGACY_TIMESHEET_TO = 'timesheets@andrewssurvey.com';
  const DEFAULT_NAME = '';

  const DEFAULT_EXPENSE_SUBJECT = 'Expense claim — {job} — {name}';
  const DEFAULT_EXPENSE_BODY =
    'Hi,\n\nPlease find attached my expense claim for {job} ({dateFrom} to {dateTo}).\n\nAttachment: {filename}\n\nThanks,\n{name}';

  const DEFAULT_TIMESHEET_SUBJECT = 'Timesheet — {month} {year} — {name}';
  const DEFAULT_TIMESHEET_BODY =
    'Hi,\n\nPlease find attached my timesheet for {month} {year}.\n\nAttachment: {filename}\n\nThanks,\n{name}';

  const PLACEHOLDER_HELP =
    'Placeholders: {name}, {job}, {dateFrom}, {dateTo}, {month}, {year}, {filename}';

  const TOKEN = /\{([a-zA-Z]+)\}/g;

  function fill(template, placeholders) {
    const map = {
      name: placeholders.name || '',
      job: placeholders.job || '',
      dateFrom: placeholders.dateFrom || '',
      dateTo: placeholders.dateTo || '',
      month: placeholders.month || '',
      year: placeholders.year || '',
      filename: placeholders.filename || '',
    };
    return String(template || '').replace(TOKEN, (match, key) =>
      Object.prototype.hasOwnProperty.call(map, key) ? map[key] : match
    );
  }

  function isPlausibleEmail(value) {
    const t = String(value || '').trim();
    if (t.length < 5 || t.length > 254) return false;
    if (/\s/.test(t)) return false;
    const at = t.indexOf('@');
    if (at <= 0 || at !== t.lastIndexOf('@') || at === t.length - 1) return false;
    const domain = t.slice(at + 1);
    if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return false;
    return true;
  }

  /** Old default timesheet address (case-insensitive) → new default; anything else unchanged. */
  function migrateTimesheetTo(value) {
    if (typeof value !== 'string') return value;
    return value.trim().toLowerCase() === LEGACY_TIMESHEET_TO ? TIMESHEET_TO : value;
  }

  global.AsEmailTemplates = {
    EXPENSE_TO,
    TIMESHEET_TO,
    LEGACY_TIMESHEET_TO,
    migrateTimesheetTo,
    DEFAULT_NAME,
    DEFAULT_EXPENSE_SUBJECT,
    DEFAULT_EXPENSE_BODY,
    DEFAULT_TIMESHEET_SUBJECT,
    DEFAULT_TIMESHEET_BODY,
    PLACEHOLDER_HELP,
    fill,
    isPlausibleEmail,
  };
})(window);
