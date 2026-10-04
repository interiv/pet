/**
 * 部署配置一致性检查
 *
 * 用法（在仓库根目录执行）：
 *   node scripts/check-deploy-config.mjs
 *   npm run check:deploy
 *
 * 为什么需要它：
 * 部署时同一个「端口」在三处出现，最容易只改一半，导致接口全挂或莫名跨域报错。
 * 本脚本把三处的实际值读出来摆在一起，并指出改端口时该动哪几处。
 *
 * 端口模型（易错点，务必分清）：
 *   容器内    —— 后端进程真正监听的端口，由 compose 的 environment.PORT 决定，通常固定 3000
 *   宿主机    —— 容器对外暴露的端口，由 ports 的「宿主机侧」决定，Nginx 的 proxy_pass 指向这里
 *   本地开发  —— vite 代理读backend/.env 的 PORT，与上面两者都无关
 *
 * 三处的关系：
 *   ports 的「宿主机侧」必须与 Nginx 的 proxy_pass 一致；
 *   ports 的「容器侧」必须与 environment.PORT 一致（这是本脚本能自动抓出的错误）。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

const problems = [];
const notes = [];

const say = (color, text) => console.log(`${color}${text}${C.reset}`);

/** 解析 env 风格的键值文件，返回 PORT 字符串（未配置则返回 null） */
function readEnvPort(file) {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  // 兼容 CRLF：\r 会被 \s 吞掉，这里显式处理 Windows 编辑过的 .env
  const matched = raw.match(/^\s*PORT\s*=\s*(\d+)/m);
  return matched ? matched[1] : null;
}

console.log('');
say(C.cyan + C.bold, '========== 部署配置一致性检查 ==========');
say(C.dim, '');

// ---------- 1. compose：宿主机侧与容器侧 ----------
const composePath = path.join(ROOT, 'docker-compose.yml');
let hostPort = '3000';
let containerPort = null;
let envPort = null;
let hostPortIsDefault = true;
let hostPortVarName = 'PORT';

if (!fs.existsSync(composePath)) {
  notes.push('仓库里没有 docker-compose.yml，跳过 compose 检查（服务器上的 compose 由 deploy.sh 生成）');
} else {
  const compose = fs.readFileSync(composePath, 'utf8');

  // ports 形如  - "127.0.0.1:${PORT:-3000}:3000"
  // 注意 ${PORT:-3000} 内部自带冒号，不能直接按冒号切分，
  // 必须先把插值整体摘出来（顺带取到默认值），再替换成不含冒号的占位符。
  const portsLine = compose
    .split(/\r?\n/)
    .find((l) => /^\s*-\s*["']?[\d.]+:/.test(l) && /:\d+["']?\s*$/.test(l));

  if (portsLine) {
    const quoted = portsLine.match(/["']([^"']+)["']/);
    const value = (quoted ? quoted[1] : portsLine.replace(/^\s*-\s*/, '').trim()).trim();

    let varDefault = null;
    let varName = null;
    // 取出 ${PORT:-3000} 的变量名与默认值
    const normalized = value
      .replace(/\$\{(\w+):-(\d+)\}/g, (_m, name, def) => {
        varName = name;
        varDefault = def;
        return `__VAR_${name}__`;
      })
      .replace(/\$\{\w+\}/g, '__VAR__');

    const parts = normalized.split(':');
    if (parts.length >= 3) {
      containerPort = parts[parts.length - 1].trim();
      const rawHost = parts[parts.length - 2].trim();
      if (/^__VAR/.test(rawHost)) {
        hostPort = varDefault || '（由环境变量决定）';
        hostPortIsDefault = true;
        hostPortVarName = varName || 'PORT';
      } else if (/^\d+$/.test(rawHost)) {
        hostPort = rawHost;
        hostPortIsDefault = false;
      }
    }
  }

  // environment 里可能显式写了 PORT
  const envLine = compose.split(/\r?\n/).find((l) => /^\s*-\s*PORT=/.test(l));
  if (envLine) {
    const m = envLine.match(/-\s*PORT=(\S+)/);
    if (m) envPort = m[1].replace(/^["']|["']$/g, '');
  }
}

if (envPort) {
  say(C.bold, '[容器内部]');
  say(C.dim, '  environment.PORT  (后端进程监听)  : ' + envPort);
  say(C.dim, '  ports 容器侧(映射到容器)     : ' + (containerPort || '未声明'));
  if (containerPort && envPort !== containerPort) {
    problems.push(
      `容器端口不一致：environment.PORT=${envPort}，但 ports 映射到容器的 ${containerPort} 端口。` +
      `\n    后端会监听 ${envPort}，而请求被转发到 ${containerPort} —— 所有接口都会连不上。`
    );
    say(C.red, 'x 不一致：environment.PORT 必须与 ports 的容器侧相同');
  } else {
    say(C.green, '  v 一致');
  }
  say(C.dim, '');
}

// ---------- 2. 对外暴露端口 ----------
say(C.bold, '[对外暴露]');
if (containerPort) {
  say(C.dim, '  ports 宿主机侧(可改)         : ' + hostPort + (hostPortIsDefault ? '  (默认，写成 ${PORT:-3000})' : '  (已写死)'));
  say(C.dim, '  Nginx proxy_pass 需指向      : 同一个宿主机端口 ' + hostPort);
} else {
  say(C.dim, '  未从 compose 解析到 ports 配置');
}
say(C.dim, '');

// ---------- 3. 本地开发端口 ----------
const localPort = readEnvPort(path.join(ROOT, 'backend', '.env'));
say(C.bold, '[本地开发]');
if (localPort) {
  say(C.dim, '  backend/.env PORT             : ' + localPort);
  say(C.dim, '  Vite 代理自动跟随             : ' + localPort);
} else {
  say(C.dim, '  backend/.env 没有 PORT（或文件不存在），Vite 代理兜底 3000');
  notes.push('本地开发未配置 backend/.env 的 PORT，Vite 会兜底到 3000');
}
say(C.dim, '');

// ---------- 结论 ----------
if (problems.length) {
  say(C.red + C.bold, '发现 ' + problems.length + ' 处问题：');
  problems.forEach((p, i) => {
    console.log('');
    say(C.red, `  ${i + 1}. ` + p);
  });
  console.log('');
  say(C.yellow + C.bold, '改端口时必须同步的两处（都在服务器上）：');
  say(C.yellow, '  1. docker-compose.yml 的 ports 宿主机侧');
  say(C.yellow, '  2. Nginx 的 proxy_pass');
  say(C.dim, '容器内的端口（environment.PORT / ports 容器侧）不要动。');
  console.log('');
  process.exit(1);
}

if (notes.length) {
  say(C.yellow, '提示：');
  notes.forEach((n) => say(C.yellow, '  · ' + n));
  console.log('');
}

say(C.green + C.bold, 'v 配置一致，未发现问题');
say(C.dim, '');
say(C.dim, '  换端口时同步改「服务器 compose 的 ports 宿主机侧」+「Nginx proxy_pass」即可；');
say(C.dim, '  容器内端口固定，不要动。');
say(C.dim, '');
