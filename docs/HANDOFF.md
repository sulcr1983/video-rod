# 钓鱼竿 Video Rod — 交接文档

> 日期：2026-10-24 ｜ 交接时状态：仓库已就位、环境已配好、移动端调研已留档、**资源库方案与原型 v1.3 待评审**
> 用途：下次继续时先读本文，再读 `docs/LIBRARY-PLAN.md`（当前主线）与 `docs/MOBILE-RESEARCH.md`（已封存）

---

## 1. 一句话现状

仓库已完整克隆到 `E:\test\video-rod`（`master`，HEAD `8527dec`），Deploy Key 与本机 git 已配好。**产品代码未改**；
当前主线是**本地资源库**：方案 `docs/LIBRARY-PLAN.md` v1.3 + 可交互原型 `deliverables/prototypes/library-prototype-v1.html` v1.3 已完成，等二次评审。
移动端已按苏哥指示封存（调研留档，不继续投入）。

---

## 2. 本机环境变更（已生效，勿重复安装）

| 项 | 内容 |
|---|---|
| Git | 2.55.0.5，`C:\Program Files\Git\cmd\git.exe`（winget 安装） |
| OpenSSH | 9.5p2（系统自带） |
| Deploy Key 私钥 | `C:\Users\XPENG\.ssh\id_ed25519_video-rod_deploy`（**无口令**） |
| Deploy Key 公钥 | 同名 `.pub`，指纹 `SHA256:cu9oIptg9UnyWeehYkdPK3Y1eQmgFecmDbYi2mR0018` |
| SSH 别名 | `github-video-rod`（`ssh.github.com:443`，仅用此密钥），已写入 `C:\Users\XPENG\.ssh\config` |
| 账号级 key 现状 | `id_ed25519_sunnyauto` 实际是 `sulcr1983/hotnews-local` 的 Deploy Key，**不能**访问 video-rod |

**注意**：`C:\Users\XPENG\AppData\Local\Programs\Git\...` 下还有第二条 git 路径，本次统一用 Program Files 那条，未改系统 PATH。

---

## 3. 仓库状态

| 项 | 值 |
|---|---|
| 位置 | `E:\test\video-rod` |
| 分支 | `master` → `origin/master` |
| HEAD | `75a2d5f docs: 根目录改为系统下载目录下的 video-rod 子目录（零拷贝、不混日常下载）` |
| 文件数 | 174（不含 `.git`）；pack 约 9.2 MiB |
| 完整性 | `git fsck` 退出码 0 |
| 工作区 | **干净**（`git status` 无输出）；`docs/MOBILE-RESEARCH.md` 已于 `3c7f409` 提交 |

---

## 4. 已完成

1. 生成并修复 Deploy Key（曾因 PowerShell 引号把口令写成字面 `""`，已清除口令，密钥对未变）
2. 配置 SSH 别名并验证通过：`Hi sulcr1983/video-rod!`
3. 完整克隆仓库，`git fsck` 通过
4. 项目结构审计（目录、三层架构、构建链、隐私点）
5. 冒烟测试：`node tools/test-naming.js` → **27 通过 / 0 失败**
6. 移动端可行性调研，结论留档 [MOBILE-RESEARCH.md](MOBILE-RESEARCH.md)（**已封存，不继续**）
7. 本地资源库方案 v1.4 + 可交互原型 v1.3（含 8 项开源 UX 落地、视频键盘、删除/回收站/迁移、§12 审计复核、**§13 实现规格：文件清单/签名/数据契约/状态机/S0–S5 切分**）
8. 复用策略确认：**私有库、本机自用、不分发**（上游 GPL-3.0 不产生分发义务）；**开源代码能抄就抄**，按引入成本择优，保留原版权声明（ADR-028）

---

## 5. 未完成 / 待办（按优先级）

| # | 事项 | 说明 |
|---|---|---|
| 1 | **资源库方案二次评审** | 方案 **v1.7** + 原型 v1.3 已就绪；审计手册见 `docs/LIBRARY-PLAN-审计方案.md` |
| 2 | ~~**P0 前置探针**~~ | ✅ **已于 2026-10-24 完成，三项全过**（`file://` 直读 + 视频 seek + `downloads.search` 绝对路径），详见 TESTING §9 |
| 3 | ~~**原型 v1.3 回归测试**~~ | ✅ **2026-10-24 完成：42/42 通过、控制台 0 错误**；截图见 `deliverables/assets/library-v13-*.png`（TESTING §8.3） |
| 4 | 根目录方案已定（v1.7） | 默认 `<Chrome 下载目录>\video-rod`——系统下载目录下的子目录，**零拷贝、不与日常下载混放、不改 Chrome 设置**；自定义目录为 B 模式（`E:\test\video-rod\download` 保留作可选目标） |
| 5 | ~~**S1a**~~ | ✅ **2026-10-24 完成**：三段中文目录落盘 + 设置页「资源库」分区 + 校验落盘；单测 48/48、端到端 17/17（TESTING §10）。实落 `Downloads\video-rod\其他网页\127.0.0.1\视频\test.mp4` |
| 6 | **S1b 待开工** | 迁移（结构 / 改子目录名 / 换根），规格见 LIBRARY-PLAN §4.5、§5.4、§13 |
| 7 | 构建链在本机不可用 | `just / bash / zip / crx3 / openssl` 全缺，且仓库无 `package.json`；当前只能「加载已解压的扩展程序」，无法产出 .crx/.zip |
| 8 | 文档漂移未修 | `DESIGN.md` 规划的 `js/image-scanner.js`、`js/bilibili.js`、`js/youtube.js` 均不存在，能力实际在 `popup-videorod.js` / `x-button.js` |
| 9 | Deploy Key 写权限未知 | 若后续要 push，需在仓库 Settings → Deploy keys 勾选 Allow write access |

> **工作区约定（2026-10-24 起）**：交付物 → `deliverables/`；文档 → `docs/`；可复用脚本 → `tools/`；
> 本机临时件（Chrome profile、测试媒体、草稿）→ `.work/`（不进 git、可整体删除）。仓库外不再散落本项目文件。
> 详见 `deliverables/DELIVERABLES.md` §1.1、`.work/README.md`、ADR-029。

---

## 6. 下次开工的关键命令

```powershell
# 新终端若 git 不在 PATH 里，先补（当前 shell 环境可能仍是安装前的）
$env:Path = 'C:\Program Files\Git\cmd;' + $env:Path

cd E:\test\video-rod
git status
node tools/test-naming.js          # 冒烟测试，应为 27/27
git fetch origin && git log -1 --oneline origin/master
```

> 远程是私有库，`origin` 已固定为 `github-video-rod` 别名。

---

## 7. 踩过的坑（别重犯）

1. **PowerShell 下 `ssh-keygen -N '""'` 会把字面两引号写成口令**。要空口令请用精确 argv 方式（`ProcessStartInfo.ArgumentList`）或生成后用 `-p` 清口令，并验证 `ssh-keygen -y -f <key>` 能直接输出公钥。
2. **不要把 `origin` 改成 `github.com`**，会命中 `hotnews-local` 的 Deploy Key 而报 `Permission denied`。
3. **克隆被中断后**目录会留下残缺 `.git`（`your current branch appears to be broken`），删掉 `.git` 重克隆即可，不要在原 `.git` 上 `git pull`。
4. **m3u8 合并默认走远程服务**（`js/init.js:213`，`ffmpeg.bmmmd.com` / `ffmpeg.94cat.com`），视频分片会离开本机 —— 已记入 ADR-021，属真实隐私点。
5. 私钥无口令，仅本机使用，勿外发。

---

## 8. 建议的下一步顺序

1. 先看方案 v1.3 与原型 v1.3（`docs/LIBRARY-PLAN.md` + `deliverables/prototypes/library-prototype-v1.html`）
2. 做 P0 前置探针（第 5 节 #2）——这是唯一挡在实现前的技术未知项
3. 确认资源库根目录盘符（第 5 节 #4）
4. 评审通过后：P1 目录与命名 → P2 资源库 MVP → P3 增强与迁移
5. 移动端维持封存，不再投入

---

## 9. 恢复上下文提示词（下次直接复制）

```
读 docs/HANDOFF.md 和 docs/LIBRARY-PLAN.md，继续本地资源库。
我的资源库根目录是：<盘符:\路径>。
先做 P0 探针，再按 P1→P2→P3 推进；不要引入第三方源码，交互自己实现。
```
