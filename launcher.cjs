#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const dotenv = require('dotenv');

const ROOT = __dirname;
const NAME = 'ihmod-admin';
const RUN_DIR = path.join(ROOT, '.run');
const LOG_DIR = path.join(ROOT, 'logs');
const PID_FILE = path.join(RUN_DIR, `${NAME}.pid`);
const LOG_FILE = path.join(LOG_DIR, `${NAME}.log`);

dotenv.config({ path: path.join(ROOT, '.env') });

const command = process.argv[2] || 'help';
const flags = new Set(process.argv.slice(3));

function ensureDirs() {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function readPid() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function isAppProcess(pid) {
  try {
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    return cmdline.includes('server.js') || cmdline.includes('src/server.ts');
  } catch {
    return false;
  }
}

function writePid(pid) {
  ensureDirs();
  fs.writeFileSync(PID_FILE, String(pid));
}

function clearPid() {
  try {
    fs.rmSync(PID_FILE, { force: true });
  } catch {
    // ignore
  }
}

function logTail(lines = 80) {
  try {
    const content = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
    console.log(content.slice(-lines).join('\n'));
  } catch {
    console.log('(no log yet)');
  }
}

function url() {
  const host = !process.env.HOST || process.env.HOST === '0.0.0.0' ? '127.0.0.1' : process.env.HOST;
  const port = process.env.PORT || '8080';
  return `http://${host}:${port}`;
}

async function health() {
  try {
    const res = await fetch(`${url()}/healthz`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function build() {
  console.log('building dist...');
  const result = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error('build failed');
    process.exit(1);
  }
}

async function start() {
  ensureDirs();
  const existing = readPid();
  if (existing && isAlive(existing) && isAppProcess(existing)) {
    console.log(`${NAME} already running (pid ${existing})`);
    return;
  }
  if (existing) clearPid();

  const dev = flags.has('--dev');
  if (!dev && !flags.has('--no-build')) build();

  const fd = fs.openSync(LOG_FILE, 'a');
  const cmd = dev ? path.join(ROOT, 'node_modules', '.bin', 'tsx') : process.execPath;
  const args = dev ? ['src/server.ts'] : ['dist/server.js'];
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: process.env,
    detached: true,
    stdio: ['ignore', fd, fd],
  });
  child.unref();
  fs.closeSync(fd);
  writePid(child.pid);

  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (!isAlive(child.pid)) {
    console.error(`failed to start; see ${LOG_FILE}`);
    logTail();
    clearPid();
    process.exit(1);
  }

  const ok = await health();
  console.log(`${NAME} started (pid ${child.pid})`);
  console.log(`  url:    ${url()}`);
  console.log(`  log:    ${LOG_FILE}`);
  console.log(`  health: ${ok ? 'ok' : 'not responding yet'}`);
}

function stop() {
  const pid = readPid();
  if (!pid) {
    console.log(`${NAME} is not running`);
    return;
  }
  if (!isAlive(pid)) {
    clearPid();
    console.log(`${NAME} is not running (stale pid)`);
    return;
  }
  if (!isAppProcess(pid)) {
    clearPid();
    console.log(`${NAME} pid ${pid} is not the app; cleared pid file`);
    return;
  }

  process.kill(pid, 'SIGTERM');
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) {
      clearPid();
      console.log(`${NAME} stopped`);
      return;
    }
    spawnSync('sleep', ['0.2']);
  }
  process.kill(pid, 'SIGKILL');
  clearPid();
  console.log(`${NAME} killed`);
}

async function status() {
  const pid = readPid();
  if (!pid || !isAlive(pid) || !isAppProcess(pid)) {
    if (pid) clearPid();
    console.log(`${NAME} is stopped`);
    return;
  }
  const ok = await health();
  console.log(`${NAME} is running (pid ${pid})`);
  console.log(`  url:    ${url()}`);
  console.log(`  health: ${ok ? 'ok' : 'not responding'}`);
  console.log(`  log:    ${LOG_FILE}`);
}

function logs() {
  ensureDirs();
  if (!fs.existsSync(LOG_FILE)) {
    console.log('(no log yet)');
    return;
  }
  if (flags.has('-f') || flags.has('--follow')) {
    spawn('tail', ['-f', LOG_FILE], { stdio: 'inherit' });
    return;
  }
  logTail(200);
}

function help() {
  console.log(`usage: node launcher.cjs <command> [options]

Commands:
  start           build and start in the background (pid + log files)
  start --dev     run tsx src/server.ts without building
  start --no-build  start dist/server.js without rebuilding
  stop            SIGTERM, then SIGKILL after 10s
  restart         stop + start (rebuilds)
  status          show pid, url, health
  list            alias for status
  logs            show the last 200 lines
  logs -f         follow the log

Files:
  pid: ${PID_FILE}
  log: ${LOG_FILE}
  env: ${path.join(ROOT, '.env')}`);
}

async function main() {
  switch (command) {
    case 'start':
      await start();
      break;
    case 'stop':
      stop();
      break;
    case 'restart':
      stop();
      await start();
      break;
    case 'status':
    case 'list':
      await status();
      break;
    case 'logs':
      logs();
      break;
    case 'help':
    case '--help':
    case '-h':
      help();
      break;
    default:
      help();
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
