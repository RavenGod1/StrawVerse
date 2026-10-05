function makeStreamSafe(stream) {
  if (!stream) return;
  if (typeof stream.on === "function") {
    stream.on("error", (err) => {
      if (err && (err.code === "EIO" || err.code === "EPIPE")) return;
    });
  }
  if (typeof stream.write === "function") {
    const originalWrite = stream.write.bind(stream);
    stream.write = function (chunk, encoding, callback) {
      try {
        return originalWrite(chunk, encoding, (err) => {
          if (err && (err.code === "EIO" || err.code === "EPIPE")) {
            if (typeof callback === "function") callback();
            return;
          }
          if (typeof callback === "function") callback(err);
        });
      } catch (err) {
        if (err && (err.code === "EIO" || err.code === "EPIPE")) {
          if (typeof callback === "function") callback();
          return false;
        }
        throw err;
      }
    };
  }
}

makeStreamSafe(process.stdout);
makeStreamSafe(process.stderr);
if (console && console._stdout) makeStreamSafe(console._stdout);
if (console && console._stderr) makeStreamSafe(console._stderr);

if (typeof global.sendToRenderer !== "function") {
  global.sendToRenderer = () => {};
}

const winston = require("winston");
const path = require("path");
const fs = require("fs");
const { getUserDataPath } = require("./constants");

const logDir = getUserDataPath();

const LogFilePath = path.join(logDir, "app.log");

try {
  if (fs.existsSync(LogFilePath)) {
    fs.unlinkSync(LogFilePath);
  }
} catch (_) {}

function formatLogMessage(info) {
  if (info.message instanceof Error) {
    return info.message.message;
  }
  if (info.message !== undefined && info.message !== null) {
    return info.message;
  }
  if (info.stack) {
    return info.stack;
  }
  return "";
}

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf((info) => {
      return `${info.timestamp} [${info.level}]: ${formatLogMessage(info)}`;
    }),
  ),
  transports: [
    new winston.transports.File({
      filename: LogFilePath,
    }),
    new winston.transports.Console({
      format: winston.format.printf((info) => {
        return `[${info.level}]: ${formatLogMessage(info)}`;
      }),
    }),
  ],
});

logger.on("error", (err) => {
  console.error("[AppLogger Error]:", err?.message || err);
});

function getLogs() {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(LogFilePath)) {
      fs.readFile(LogFilePath, "utf8", (err, data) => {
        if (err) {
          reject("Error reading log file");
        } else {
          resolve(data);
        }
      });
    } else {
      resolve("No logs found.");
    }
  });
}

function clearLogs() {
  return new Promise((resolve, reject) => {
    fs.writeFile(LogFilePath, "", "utf8", (err) => {
      if (err) {
        reject("Error clearing log file");
      } else {
        resolve();
      }
    });
  });
}

module.exports = { logger, getLogs, clearLogs };
