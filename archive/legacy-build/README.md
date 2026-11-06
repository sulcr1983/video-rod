# 遗留构建脚本（已停用）

`justfile` 是早期「产出 .crx/.zip」的构建脚本，**2026-11-06 移入此处归档**。

## 为什么停用

1. **项目零构建**：没有 `package.json`，所有代码是原生 JS，直接「加载已解压的扩展程序」即可用。
2. **`justfile` 依赖不存在的东西**：`npm install`、全局 `crx3`、`build/` 目录都不存在。
3. **项目明确不分发**（`docs/RELEASE-FEASIBILITY.md`：2026-11-04 拍板暂不发布，先自用），
   所以打包链路没有使用场景。

## 如果将来要打包

先读 `docs/RELEASE-FEASIBILITY.md` 的五道关（GPL 开源、大会员/YT 功能裁剪、商店审核、
脱敏、维护成本），再恢复本脚本并补齐 `package.json`。
