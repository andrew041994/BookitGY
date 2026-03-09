export const minutesToDurationParts = (totalMinutes) => {
  const safeMinutes = Number.isFinite(Number(totalMinutes))
    ? Math.max(0, Math.floor(Number(totalMinutes)))
    : 0;
  const days = Math.floor(safeMinutes / 1440);
  const hours = Math.floor((safeMinutes % 1440) / 60);
  const minutes = safeMinutes % 60;
  return { days, hours, minutes };
};

export const durationPartsToMinutes = ({ days = 0, hours = 0, minutes = 0 } = {}) => {
  const safeDays = Math.max(0, Math.floor(Number(days) || 0));
  const safeHours = Math.max(0, Math.floor(Number(hours) || 0));
  const safeMinutes = Math.max(0, Math.floor(Number(minutes) || 0));
  return safeDays * 1440 + safeHours * 60 + safeMinutes;
};

export const validateDurationParts = ({ days = 0, hours = 0, minutes = 0 } = {}) => {
  const values = { days: Number(days), hours: Number(hours), minutes: Number(minutes) };

  if ([values.days, values.hours, values.minutes].some((value) => Number.isNaN(value))) {
    return "Duration fields must be numeric.";
  }

  if (values.days < 0 || values.hours < 0 || values.minutes < 0) {
    return "Duration values cannot be negative.";
  }

  if (durationPartsToMinutes(values) <= 0) {
    return "Enter a duration greater than 0.";
  }

  return "";
};

export const formatDuration = (totalMinutes) => {
  const { days, hours, minutes } = minutesToDurationParts(totalMinutes);
  const chunks = [];

  if (days) chunks.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours) chunks.push(`${hours} hr${hours === 1 ? "" : "s"}`);
  if (minutes || chunks.length === 0) chunks.push(`${minutes} min`);

  return chunks.join(" ");
};
