// Format a Date as "DD-MM-YYYY HH:mm:ss".
exports.formatTimestamp = function (timestamp) {
  const pad = (value) => String(value).padStart(2, "0");
  const date = `${pad(timestamp.getDate())}-${pad(timestamp.getMonth() + 1)}-${timestamp.getFullYear()}`;
  const time = `${pad(timestamp.getHours())}:${pad(timestamp.getMinutes())}:${pad(timestamp.getSeconds())}`;
  return `${date} ${time}`;
};
