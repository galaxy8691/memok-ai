# `openclaw` 仅 devDependencies — 安装验证清单

与常见 OpenClaw 扩展（如 `@tencent-weixin/openclaw-weixin`）一致：**生产安装不装 `openclaw`**，运行时由网关/宿主的 `openclaw` 解析；本仓库仅在 `devDependencies` 中声明 `openclaw` 供开发与 CI。

## 1. 仓库内 CI（已由自动化跑通）

```bash
rm -rf node_modules && npm ci --no-audit --no-fund && npm run ci
```

## 2. 仅生产依赖（模拟「网关只装 dependencies」）

在项目根目录外复制 `package.json` + `package-lock.json` 到临时目录后：

```bash
npm ci --omit=dev --no-audit --no-fund
```

预期：

- `node_modules/openclaw` **不存在**（`openclaw` 仅在 devDependencies，生产安装不会拉取）。
- `node_modules` 总体积远小于完整 `npm ci`（本机一次参考：完整安装约 2.4G 级、仅 prod 约数十 MB 量级，随锁版本会变）。

## 3. 本机 OpenClaw 网关（必做 — 需你人工执行）

1. 将该分支代码放到网关会加载的路径（或 `openclaw plugins install /path/to/memok-ai`）。
2. 在**仅 prod** 树或网关实际使用的安装方式下安装依赖（若网关等价于 `npm install --omit=dev`，则不应在插件目录出现 `openclaw`）。
3. `openclaw gateway restart`（或 `openclaw restart`）。
4. 观察日志：**不得**出现 `Cannot find package 'openclaw'` / `ERR_MODULE_NOT_FOUND` 指向 `openclaw/plugin-sdk`。
5. 最小功能：`openclaw memok setup` 或触发一轮插件注册。

若第 4 步失败：当前网关的模块解析未把宿主 `openclaw` 暴露给插件；需改网关/打包策略，或把 `openclaw` 改回 `dependencies`（会显著增大安装体积）。

## 4. 合入 `main` 前

在 PR 中附上第 2 步的 `du -sh` 与第 3 步的结论（成功 / 失败日志片段）。
