#!/usr/bin/env node
// Webwriter: starts the server and opens a browser window on it.
//
//   webwriter [book folder] [--port N] [--no-open] [--keep-running]
//   webwriter check <book folder>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from '../src/server/server.js';
import { check, USAGE } from '../src/server/check.js';

const HELP = `usage: webwriter [book folder] [options]
       webwriter check <book folder>

Opens the book in a browser window. Without a folder, the last book is reopened.

Options:
  --port N         Listen on port N (default 4848, or the next free port).
  --no-open        Do not open a browser window.
  --keep-running   Keep the server running after the last window closes.
  --drawio-url URL The draw.io editor for diagrams (default: the copy npm install puts in
                   vendor/drawio, else https://embed.diagrams.net/).
  -h, --help       Show this help.`;

const args = process.argv.slice(2);

if (args[0] === 'check') {
  if (args.length !== 2 || args[1].startsWith('-')) {
    console.log(USAGE);
    process.exit(2);
  }
  const result = check(args[1]);
  for (const line of result.lines) console.log(line);
  process.exit(result.status);
}

let folder = null;
let port = Number(process.env.WEBWRITER_PORT) || 4848;
let fixedPort = Boolean(process.env.WEBWRITER_PORT);
/** Longer than a browser waits before an event stream reconnects, which is about three seconds. */
const RECONNECT_WAIT = 4000;
let openBrowser = true;
let keepRunning = false;
let drawioURL;
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '-h' || arg === '--help') {
    console.log(HELP);
    process.exit(0);
  } else if (arg === '--port') {
    port = Number(args[++i]);
    fixedPort = true;
  } else if (arg === '--no-open') openBrowser = false;
  else if (arg === '--keep-running') keepRunning = true;
  else if (arg === '--drawio-url') drawioURL = args[++i];
  else if (arg.startsWith('-')) {
    console.error(`Unknown option ${arg}\n\n${HELP}`);
    process.exit(2);
  } else folder = arg;
}

if (folder && !fs.existsSync(folder)) {
  console.error(`${folder} does not exist.`);
  process.exit(1);
}

const { server, state } = createServer({
  book: folder,
  quitWhenClosed: !keepRunning && openBrowser,
  ...(drawioURL ? { drawioURL } : {}),
  log: (message) => console.log(message),
});

function listen(attempt = 0) {
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && !fixedPort && attempt < 20) {
      port += 1;
      listen(attempt + 1);
    } else {
      console.error(error.message);
      process.exit(1);
    }
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`Webwriter is running at ${url}`);
    console.log('Press Ctrl+C to quit.');
    if (openBrowser) openUnlessReconnected(url);
  });
}

/**
 * Windows left open by an earlier run reconnect on their own within a few seconds. A new window then
 * would be one more, and each holds a connection: past the browser's six per host, requests stall.
 */
function openUnlessReconnected(url) {
  setTimeout(() => {
    if (state.clients.size > 0) console.log('A Webwriter window reconnected. No new window was opened.');
    else openWindow(url);
  }, RECONNECT_WAIT);
}

/** An app-style window in Chrome or Edge when installed, otherwise the default browser. */
function openWindow(url) {
  const launch = (command, commandArgs) => {
    try {
      const child = spawn(command, commandArgs, { stdio: 'ignore', detached: true });
      child.on('error', () => {});
      child.unref();
      return true;
    } catch {
      return false;
    }
  };
  if (process.platform === 'darwin') {
    const chrome = ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium']
      .find((app) => fs.existsSync(`/Applications/${app}.app`));
    if (chrome && launch('open', ['-na', chrome, '--args', `--app=${url}`, '--new-window'])) return;
    launch('open', [url]);
  } else if (process.platform === 'win32') {
    launch('cmd', ['/c', 'start', '', url]);
  } else {
    launch('xdg-open', [url]);
  }
}

process.on('SIGINT', () => process.exit(0));
listen();
